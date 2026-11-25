import { Router } from "express";
import { randomUUID } from "node:crypto";
import type {
  Artifact,
  ChatMessage,
  TokenUsage,
  ToolCallView,
  UiEvent,
} from "../../../shared/protocol";
import { displayToolName } from "../../../shared/protocol";
import { runTurn, runtimeInfo } from "../agent/runtime";
import type { EventSink } from "../agent/events";
import { observabilityEnabled, startTurnTrace } from "../obs/langfuse";
import { resolveAttachments } from "../attachments";
import { addOptimized, attachPdf, publicVersions } from "../resumes";
import { decodeToolResult } from "../../../shared/tool-payload";
import {
  appendMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
} from "../store";

export const chatRouter = Router();

chatRouter.get("/conversations", (_request, response) => {
  response.json({ conversations: listConversations() });
});

chatRouter.post("/conversations", (_request, response) => {
  response.status(201).json({ conversation: createConversation() });
});

chatRouter.get("/conversations/:id", (request, response) => {
  const conversation = getConversation(request.params.id ?? "");
  if (conversation === undefined) {
    response.status(404).json({ error: "会话不存在" });
    return;
  }
  response.json({ conversation });
});

chatRouter.delete("/conversations/:id", (request, response) => {
  const removed = deleteConversation(request.params.id ?? "");
  response.json({ ok: removed });
});

chatRouter.get("/conversations/:id/resumes", (request, response) => {
  const conversation = getConversation(request.params.id ?? "");
  if (conversation === undefined) {
    response.status(404).json({ error: "会话不存在" });
    return;
  }
  response.json({ versions: publicVersions(conversation.id) });
});

chatRouter.get("/health", (_request, response) => {
  response.json({ ok: true, runtime: runtimeInfo(), observability: observabilityEnabled() });
});

/**
 * 一轮对话：SSE 推送 UI 事件，结束后把完整助手消息落库并回传。
 * 事件流本身不带历史，前端收到的每个事件都是增量的。
 */
chatRouter.post("/conversations/:id/messages", async (request, response) => {
  const conversation = getConversation(request.params.id ?? "");
  if (conversation === undefined) {
    response.status(404).json({ error: "会话不存在" });
    return;
  }

  const body = request.body as { text?: unknown; attachmentIds?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.filter((item): item is string => typeof item === "string")
    : [];

  if (text === "" && attachmentIds.length === 0) {
    response.status(400).json({ error: "消息不能为空" });
    return;
  }
  if (text.length > 20000) {
    response.status(400).json({ error: "消息过长" });
    return;
  }

  const attachments = resolveAttachments(attachmentIds);
  // 先记下有没有历史轮次：决定运行时是否需要恢复持久化会话
  const hadHistory = conversation.messages.length > 0;
  const userMessage: ChatMessage = {
    id: randomUUID(),
    role: "user",
    text,
    attachments: attachments.map((item) => {
      const { path: _path, ...rest } = item;
      return rest;
    }),
    createdAt: new Date().toISOString(),
  };
  appendMessage(conversation.id, userMessage);

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.flushHeaders?.();

  let closed = false;
  // 用 response 的 close 判断客户端断开：req 的 'close' 在请求体读完后就会触发，
  // 会把整轮事件都当成「已断开」而静默丢弃。
  response.on("close", () => {
    if (!response.writableFinished) closed = true;
  });

  const send = (event: string, data: unknown): void => {
    if (closed) return;
    try {
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      closed = true;
    }
  };

  const heartbeat = setInterval(() => {
    if (!closed) response.write(": ping\n\n");
  }, 15_000);

  const collector = new TurnCollector();
  const trace = startTurnTrace({
    conversationId: conversation.id,
    sessionId: conversation.dshSessionId,
    messageId: userMessage.id,
    input: text === "" ? "[仅上传文件]" : text,
    model: runtimeInfo().model,
    attachments: attachments.map((item) => item.name),
  });

  const sink: EventSink = {
    emit(event: UiEvent) {
      collector.apply(event);
      send("ui", event);
    },
    onAssistant(info) {
      trace.modelCompleted(info.text, info.usage);
    },
    onToolCall(info) {
      trace.toolStarted(info.callId, info.name, info.args);
    },
    onToolResult(info) {
      trace.toolFinished(info.callId, info.name, info.ok, info.output);
      recordToolArtifacts(conversation.id, info.name, info.ok, info.output);
    },
  };

  const startedAt = Date.now();
  let error: unknown = null;

  try {
    trace.modelStarted();
    const outcome = await runTurn({
      sessionId: conversation.dshSessionId,
      text,
      resume: hadHistory,
      attachments: attachments.map((item) => ({
        name: item.name,
        path: item.path,
        chars: item.chars,
      })),
      sink,
    });
    collector.text = collector.text === "" ? outcome.text : collector.text;
    collector.usage = collector.usage ?? outcome.usage;
    collector.durationMs = Date.now() - startedAt;
  } catch (caught) {
    error = caught;
    trace.failed(caught);
    const message = caught instanceof Error ? caught.message : String(caught);
    send("ui", { type: "error", message } satisfies UiEvent);
    collector.error = message;
  } finally {
    clearInterval(heartbeat);
  }

  const assistantMessage: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    text: collector.text,
    ...(collector.reasoning === "" ? {} : { reasoning: collector.reasoning }),
    ...(collector.toolCalls.length === 0 ? {} : { toolCalls: collector.toolCalls }),
    ...(collector.artifacts.length === 0 ? {} : { artifacts: collector.artifacts }),
    ...(collector.usage === null ? {} : { usage: collector.usage }),
    ...(collector.error === undefined ? {} : { error: collector.error }),
    createdAt: new Date().toISOString(),
  };
  appendMessage(conversation.id, assistantMessage);

  send("saved", { userMessage, assistantMessage, versions: publicVersions(conversation.id) });
  await trace.finish(collector.error ?? collector.text);
  send("end", { ok: error === null });
  response.end();
});

/**
 * 工具产出落成简历版本：resume_rewrite → 新的优化版；pdf_generate → 挂到最近的优化版上。
 * 必须用完整的工具输出（collector 里存的是截断版），否则大 JSON 会被切掉。
 */
function recordToolArtifacts(
  conversationId: string,
  toolName: string,
  ok: boolean,
  output: string,
): void {
  if (!ok) return;
  const payload = decodeToolResult(output);
  if (payload === null || !payload.ok) return;

  const name = displayToolName(toolName);
  if (name === "resume_rewrite") {
    const artifact = payload.artifacts?.[0];
    if (artifact === undefined) return;
    const data = payload.data as { chars?: unknown } | undefined;
    addOptimized(conversationId, {
      path: artifact.path,
      fileName: artifact.name,
      chars: typeof data?.chars === "number" ? data.chars : 0,
    });
    return;
  }

  if (name === "pdf_generate") {
    const data = payload.data as { path?: unknown } | undefined;
    if (typeof data?.path === "string") attachPdf(conversationId, data.path);
  }
}

class TurnCollector {
  text = "";
  reasoning = "";
  usage: TokenUsage | null = null;
  durationMs = 0;
  error: string | undefined;
  private readonly calls = new Map<string, ToolCallView>();
  private readonly artifactList: Artifact[] = [];

  apply(event: UiEvent): void {
    switch (event.type) {
      case "assistant": {
        if (event.text !== "") this.text = event.text;
        if (event.reasoning !== undefined && event.reasoning !== "") this.reasoning = event.reasoning;
        if (event.usage !== undefined) this.usage = event.usage;
        return;
      }
      case "tool_call": {
        this.calls.set(event.callId, {
          callId: event.callId,
          name: displayToolName(event.name),
          args: event.args,
          status: "running",
        });
        return;
      }
      case "tool_result": {
        const existing = this.calls.get(event.callId);
        if (existing !== undefined) {
          existing.status = event.ok ? "ok" : "error";
          existing.output = event.output;
        }
        return;
      }
      case "artifact": {
        if (!this.artifactList.some((item) => item.url === event.artifact.url)) {
          this.artifactList.push(event.artifact);
        }
        return;
      }
      case "error": {
        this.error = event.message;
        return;
      }
      default:
        return;
    }
  }

  get toolCalls(): ToolCallView[] {
    return [...this.calls.values()];
  }

  get artifacts(): Artifact[] {
    return this.artifactList;
  }
}
