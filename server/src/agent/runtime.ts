import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";
import type { HarnessNotification } from "@deepseek-ai/dsh-sdk-client";
import { resolve } from "node:path";
import { DSH, WORKSPACE_DIR } from "../config";
import type { TokenUsage } from "../../../shared/protocol";
import { normalizeSessionEvent, type DshSessionEvent, type EventSink } from "./events";
import { mcpLaunch } from "./mcp-launch";
import { writePatch } from "./patch";
import { PERSONA } from "./persona";

/**
 * DSH 运行时管理：一个进程内只起一个 harness 子进程，按会话 id 复用它。
 *
 * - 启动参数：桌面版 Electron 以 node 模式运行 dsh cli，加载 `sdk` profile，
 *   并叠加 dsh/resume-agent.patch.yml（人设 + MCP 工具 + 关闭无关工具）。
 * - 一个 dsh session 对应前端一个会话，历史存在 DSH_HOME 里，重启后可继续。
 * - 同一会话的轮次串行执行，避免同一 session 上并发 prompt。
 */

export interface AttachmentRef {
  name: string;
  path: string;
  chars: number;
}

export interface TurnInput {
  sessionId: string;
  text: string;
  attachments: AttachmentRef[];
  /** 该会话此前已有轮次：需要在新的运行时进程里先恢复持久化会话 */
  resume?: boolean;
  sink: EventSink;
}

export interface TurnOutcome {
  text: string;
  usage: TokenUsage | null;
  events: number;
}

let harness: DeepSeekHarness | null = null;
let starting: Promise<void> | null = null;
const sessionQueues = new Map<string, Promise<unknown>>();
/** 当前运行时进程里已经打开过的会话；同进程内不必再 resume */
const knownSessions = new Set<string>();

export function runtimeInfo(): {
  model: string;
  provider: string;
  patch: string;
  started: boolean;
  mcp: { command: string; args: string[] };
} {
  const launch = mcpLaunch();
  return {
    model: DSH.model,
    provider: DSH.provider,
    patch: resolve(DSH.patchDir, "resume-agent.patch.yml"),
    started: harness !== null,
    mcp: launch,
  };
}

async function getHarness(): Promise<DeepSeekHarness> {
  if (harness !== null) return harness;

  const launch = mcpLaunch();
  const patchPath = writePatch(resolve(DSH.patchDir, "resume-agent.patch.yml"), {
    mcpCommand: launch.command,
    mcpArgs: launch.args,
    persona: PERSONA,
  });

  const args = ["--expose-internals", DSH.cliPath, "--profile", DSH.profile, "--patch", patchPath];

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    // 工具只经由 MCP 暴露，原生 shell/文件工具已关闭；
    // 用 danger-full-access 避免 Windows 沙箱为工作区做权限授予时失败。
    DSH_PERMISSION_MODE: "danger-full-access",
    ...(DSH.home === undefined ? {} : { DSH_HOME: DSH.home }),
  };
  // 桌面版进程会带着 DSH_PROFILE=desktop 等变量；不清掉会让子进程去加载被 Electron 独占的 profile。
  for (const key of ["DSH_PROFILE", "DSH_PROFILE_DIR", "DSH_SESSION_ID", "DSH_WEB_URL"]) {
    delete childEnv[key];
  }

  harness = new DeepSeekHarness({
    launch: {
      command: DSH.command,
      args,
      cwd: WORKSPACE_DIR,
      env: childEnv,
      // 一轮对话可能包含多次模型调用和工具调用，给足时间
      requestTimeoutMs: 10 * 60 * 1000,
    },
    provider: DSH.provider,
    model: DSH.model,
    cwd: WORKSPACE_DIR,
    maxTokens: DSH.maxTokens,
  });
  if (process.env.RESUME_DEBUG === "1") {
    console.error("[runtime] args:", args);
    console.error(
      "[runtime] DSH env:",
      Object.entries(childEnv).filter(([key]) => key.startsWith("DSH_")),
    );
  }

  starting = harness.start();
  try {
    await starting;
  } catch (error) {
    harness = null;
    starting = null;
    throw error;
  }
  return harness;
}

export async function runTurn(input: TurnInput): Promise<TurnOutcome> {
  const previous = sessionQueues.get(input.sessionId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => execute(input));
  sessionQueues.set(input.sessionId, current);
  try {
    return await current;
  } finally {
    if (sessionQueues.get(input.sessionId) === current) {
      sessionQueues.delete(input.sessionId);
    }
  }
}

async function execute(input: TurnInput): Promise<TurnOutcome> {
  const active = await getHarness();
  const toolNames = new Map<string, string>();
  let usage: TokenUsage | null = null;
  let emitted = 0;

  const sink: EventSink = {
    emit(event) {
      emitted += 1;
      input.sink.emit(event);
    },
    onAssistant(info) {
      input.sink.onAssistant?.(info);
      if (info.usage !== null) usage = info.usage;
    },
    onToolCall(info) {
      input.sink.onToolCall?.(info);
    },
    onToolResult(info) {
      input.sink.onToolResult?.(info);
    },
  };

  const session = active.session(input.sessionId);
  const prompt = buildPrompt(input.text, input.attachments);

  const onNotification = (notification: HarnessNotification): void => {
    if (notification.method !== "session.event") return;
    const event = notification.params.event as DshSessionEvent | undefined;
    if (event === undefined) return;
    const params = notification.params as { sessionId?: string };
    // 只转发根会话事件；子 agent 的事件不进入聊天流
    if (params.sessionId !== undefined && params.sessionId !== input.sessionId) return;
    normalizeSessionEvent(event, { sink, toolNames });
  };

  // 服务重启后运行时是全新进程，而会话已持久化在 DSH_HOME 里：
  // 直接 prompt 会报 "session already exists"，必须先显式 resume。
  // 同一运行时进程内已打开的会话不必再 resume（会返回 "already open"）。
  const resume = async (): Promise<void> => {
    try {
      await active.client.request("session/resume", { sessionId: input.sessionId }, 30_000);
      knownSessions.add(input.sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already open|already exists/i.test(message)) {
        knownSessions.add(input.sessionId);
        return;
      }
      console.warn(`[runtime] resume 未成功（继续尝试 prompt）：${message}`);
    }
  };

  if (input.resume === true && !knownSessions.has(input.sessionId)) await resume();

  const blocks: Array<{ type: "text"; text: string }> = [{ type: "text", text: prompt }];

  let result;
  try {
    result = await session.run(blocks, { onNotification });
  } catch (error) {
    // 上一个运行时进程可能还没完全退出、会话锁未释放：等它释放后重试一次
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists/i.test(message)) throw error;
    await new Promise((done) => setTimeout(done, 1500));
    knownSessions.delete(input.sessionId);
    await resume();
    result = await active.session(input.sessionId).run(blocks, { onNotification });
  }

  knownSessions.add(input.sessionId);

  const text = result.finalResponse.trim();
  return { text, usage, events: emitted };
}

/** 把附件引用写进用户消息：模型据此把绝对路径交给工具。 */
export function buildPrompt(text: string, attachments: AttachmentRef[]): string {
  if (attachments.length === 0) return text;
  const lines = [
    text,
    "",
    "---",
    "[用户随消息上传的文件]",
    ...attachments.map(
      (file) => `- ${file.name}；绝对路径：${file.path}；可读文本约 ${file.chars} 字`,
    ),
    "需要解析、改写或导出时，把上面的绝对路径作为工具入参。",
    "回复用户时只提文件名，不要输出这些路径。",
  ];
  return lines.join("\n");
}

export async function closeRuntime(): Promise<void> {
  const current = harness;
  harness = null;
  starting = null;
  knownSessions.clear();
  if (current !== null) {
    await current.close();
  }
}

process.once("SIGINT", () => {
  void closeRuntime();
});
process.once("SIGTERM", () => {
  void closeRuntime();
});
