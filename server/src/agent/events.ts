import { basename } from "node:path";
import type { TokenUsage, UiEvent } from "../../../shared/protocol";
import { decodeToolResult } from "../../../shared/tool-payload";

/**
 * DSH 会话事件 → 前端 UI 事件。
 *
 * 只依赖事件里的公开字段（type/time/data），对未知事件一律忽略：
 * 运行时后续新增事件类型时，服务端不会因此报错。
 */

export interface DshSessionEvent {
  type: string;
  seq: number;
  time: number;
  data: unknown;
}

export interface EventSink {
  emit(event: UiEvent): void;
  onAssistant?(info: { text: string; reasoning: string; usage: TokenUsage | null }): void;
  onToolCall?(info: { callId: string; name: string; args: string }): void;
  onToolResult?(info: { callId: string; name: string; ok: boolean; output: string }): void;
  onUsage?(usage: TokenUsage): void;
}

interface NormalizeOptions {
  sink: EventSink;
  /** callId → 工具名，tool/result 自身不带工具名 */
  toolNames: Map<string, string>;
  /** 触发本次转发的事件时间（用于前端估算耗时，可选） */
  onEventTime?: (time: number) => void;
}

const MAX_TOOL_OUTPUT = 4000;

export function normalizeSessionEvent(event: DshSessionEvent, options: NormalizeOptions): void {
  const { sink, toolNames } = options;
  options.onEventTime?.(event.time);
  const data = asRecord(event.data);

  switch (event.type) {
    case "turn/start": {
      sink.emit({ type: "turn_start", turn: numberOr(data.turn, 1) });
      return;
    }
    case "step/start": {
      sink.emit({ type: "step_start", turn: numberOr(data.turn, 1), step: numberOr(data.step, 1) });
      return;
    }
    case "tool/call": {
      const callId = stringOr(data.callId, "");
      const name = stringOr(data.name, "tool");
      const args = stringOr(data.arguments, "");
      toolNames.set(callId, name);
      sink.emit({ type: "tool_call", callId, name, args });
      sink.onToolCall?.({ callId, name, args });
      return;
    }
    case "tool/result": {
      const message = asRecord(data.message);
      const callId = stringOr(message.toolCallId, "");
      const name = toolNames.get(callId) ?? "tool";
      const output = blocksToText(message.content);
      const ok = message.isError !== true;
      sink.emit({
        type: "tool_result",
        callId,
        name,
        ok,
        output: truncate(output, MAX_TOOL_OUTPUT),
      });
      sink.onToolResult?.({ callId, name, ok, output });
      emitArtifacts(output, sink);
      return;
    }
    case "assistant/message": {
      const message = asRecord(data.message);
      const text = blocksToText(message.content);
      const reasoning = blocksToReasoning(message.content);
      const usage = usageOf(data.usage);
      sink.emit({ type: "assistant", text, reasoning: reasoning || undefined, usage: usage ?? undefined });
      sink.onAssistant?.({ text, reasoning, usage });
      if (usage !== null) sink.onUsage?.(usage);
      return;
    }
    case "job/settled": {
      if (data.status === "failed" && typeof data.detail === "string" && data.detail.trim() !== "") {
        sink.emit({ type: "error", message: `工具执行失败：${data.detail}` });
      }
      return;
    }
    case "turn/end": {
      const reason = asRecord(data.reason);
      sink.emit({ type: "done", finishReason: stringOr(reason.kind, "completed") });
      return;
    }
    default:
      return;
  }
}

function emitArtifacts(output: string, sink: EventSink): void {
  const payload = decodeToolResult(output);
  if (payload?.artifacts === undefined) return;
  for (const artifact of payload.artifacts) {
    sink.emit({
      type: "artifact",
      artifact: {
        name: artifact.name,
        url: `/api/outputs/${encodeURIComponent(basename(artifact.path))}`,
        bytes: artifact.bytes,
      },
    });
  }
}

export function usageOf(value: unknown): TokenUsage | null {
  const usage = asRecord(value);
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) return null;
  return {
    input: numberOr(usage.inputTokens, 0),
    output: numberOr(usage.outputTokens, 0),
    cacheRead: numberOr(usage.cacheReadTokens, 0),
    cacheWrite: numberOr(usage.cacheWriteTokens, 0),
    total: numberOr(usage.totalTokens, 0),
  };
}

function blocksToText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is Record<string, unknown> => isRecord(block) && block.type === "text")
    .map((block) => stringOr(block.text, ""))
    .filter((text) => text !== "")
    .join("\n");
}

function blocksToReasoning(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is Record<string, unknown> => isRecord(block) && block.type === "reasoning")
    .map((block) => stringOr(block.text, ""))
    .filter((text) => text !== "")
    .join("\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
