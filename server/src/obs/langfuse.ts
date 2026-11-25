import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  propagateAttributes,
  startObservation,
  type LangfuseGeneration,
  type LangfuseSpan,
} from "@langfuse/tracing";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { DiagConsoleLogger, DiagLogLevel, diag } from "@opentelemetry/api";
import type { TokenUsage } from "../../../shared/protocol";
import { LANGFUSE } from "../config";

/**
 * Langfuse 可观测（v4 / OpenTelemetry）。
 *
 * Langfuse v4 部署常开 events_only 写入模式：/api/public/ingestion 只收 score，
 * trace/generation 必须走 OTLP。所以这里用官方 @langfuse/otel + @langfuse/tracing。
 *
 * 每轮一条 trace：根 span（resume-agent.turn）+ generation（模型调用）+ 工具 span。
 * 没配 key 时整个模块退化为 no-op，不影响对话。
 */

const enabled = LANGFUSE.publicKey !== "" && LANGFUSE.secretKey !== "";

let processor: LangfuseSpanProcessor | null = null;

function ensureProcessor(): LangfuseSpanProcessor | null {
  if (!enabled) return null;
  if (processor !== null) return processor;

  // 排查上报问题时打开：RESUME_OTEL_DEBUG=1 会把导出失败打到 stderr
  if (process.env.RESUME_OTEL_DEBUG === "1") {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
  }

  processor = new LangfuseSpanProcessor({
    publicKey: LANGFUSE.publicKey,
    secretKey: LANGFUSE.secretKey,
    baseUrl: LANGFUSE.baseUrl,
    environment: process.env.NODE_ENV ?? "development",
    // 单机小流量：尽快上报，避免进程退出前丢 span
    flushAt: 1,
    flushInterval: 1000,
    // 这个 tracer 只产出本应用的 span，不需要额外过滤；
    // 若按名称过滤，会把 deepseek.chat（generation）和 tool:* 一起挡掉。
  });

  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  provider.register();
  return processor;
}

export function observabilityEnabled(): boolean {
  return enabled;
}

/** 启动时探活：确认地址可达，并打印服务端版本（v4 才有 events_only 等模式）。 */
export async function verifyLangfuse(): Promise<void> {
  if (!enabled) return;
  try {
    const response = await fetch(`${LANGFUSE.baseUrl}/api/public/health`, {
      signal: AbortSignal.timeout(8000),
    });
    const body = (await response.json().catch(() => ({}))) as { version?: string };
    if (response.status === 200) {
      console.log(`[langfuse] 已连接 ${LANGFUSE.baseUrl}（version ${body.version ?? "unknown"}）`);
    } else {
      console.warn(`[langfuse] 健康检查返回 HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn(
      `[langfuse] 无法连接 ${LANGFUSE.baseUrl}：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  ensureProcessor();
}

export interface TurnTrace {
  modelStarted(): void;
  modelCompleted(text: string, usage: TokenUsage | null): void;
  toolStarted(callId: string, name: string, args: string): void;
  toolFinished(callId: string, name: string, ok: boolean, output: string): void;
  failed(error: unknown): void;
  finish(output: string): Promise<void>;
}

export interface TurnTraceParams {
  conversationId: string;
  sessionId: string;
  messageId: string;
  input: string;
  model: string;
  attachments: string[];
}

export function startTurnTrace(params: TurnTraceParams): TurnTrace {
  const active = ensureProcessor();
  if (active === null) return noopTrace();

  let root: LangfuseSpan | null = null;
  let generation: LangfuseGeneration | null = null;
  const toolSpans = new Map<string, LangfuseSpan>();
  let usageRecorded: TokenUsage | null = null;

  // propagateAttributes 把 sessionId / traceName 注入上下文，随后创建的 span 都会带上
  void propagateAttributes(
    {
      traceName: "resume-agent.turn",
      userId: "local-user",
      sessionId: params.conversationId,
      tags: ["resume-agent", "web-mvp"],
      metadata: { dshSessionId: params.sessionId, messageId: params.messageId },
    },
    () => {
      root = startObservation("resume-agent.turn", {
        input: params.input,
        metadata: { attachments: params.attachments, model: params.model },
      });
      generation = root.startObservation(
        "deepseek.chat",
        {
          model: params.model,
          input: params.input,
          modelParameters: { provider: "deepseek-official" },
        },
        { asType: "generation" },
      );
    },
  );

  return {
    modelStarted() {
      // generation 在构造时已开始计时
    },

    modelCompleted(text, usage) {
      usageRecorded = usage;
      generation?.update({
        output: text,
        ...(usage === null
          ? {}
          : {
              usageDetails: {
                input: usage.input,
                output: usage.output,
                total: usage.total,
                cache_read_input_tokens: usage.cacheRead,
              },
            }),
      });
      generation?.end();
      generation = null;
    },

    toolStarted(callId, name, args) {
      if (root === null || toolSpans.has(callId)) return;
      const span = root.startObservation(
        `tool:${name.replace(/^mcp__[a-z0-9_]+__/i, "")}`,
        { input: args },
        { asType: "tool" },
      );
      toolSpans.set(callId, span);
    },

    toolFinished(callId, name, ok, output) {
      const span = toolSpans.get(callId);
      if (span === undefined) return;
      span.update({
        output: output.slice(0, 8000),
        ...(ok ? {} : { level: "ERROR", statusMessage: `工具 ${name} 执行失败` }),
      });
      span.end();
      toolSpans.delete(callId);
    },

    failed(error) {
      const message = error instanceof Error ? error.message : String(error);
      root?.update({ level: "ERROR", statusMessage: message.slice(0, 500) });
    },

    async finish(output) {
      root?.update({ output, metadata: { tokenUsage: usageRecorded } });
      root?.end();
      root = null;
      try {
        await Promise.race([
          active.forceFlush(),
          new Promise<void>((done) => setTimeout(done, 2000)),
        ]);
      } catch {
        // 上报失败不影响对话
      }
    },
  };
}

function noopTrace(): TurnTrace {
  return {
    modelStarted() {},
    modelCompleted() {},
    toolStarted() {},
    toolFinished() {},
    failed() {},
    async finish() {},
  };
}
