# 05 - Agent 运行时与 Langfuse

这一章覆盖从“服务端下决心启动模型”到“把 DSH 事件翻译成 UI 状态”的全部核心逻辑：

| 文件 | 行号 |
|---|---|
| `server/src/agent/persona.ts` | 1-16 |
| `server/src/agent/patch.ts` | 1-113 |
| `server/src/agent/mcp-launch.ts` | 1-16 |
| `server/src/agent/events.ts` | 1-166 |
| `server/src/agent/runtime.ts` | 1-243 |
| `server/src/obs/langfuse.ts` | 1-206 |

## 1. server/src/agent/persona.ts

### 行 1：注释

这个人设会替换 DSH `sdk` profile 默认的 coding persona。ResumeAgent 不希望模型回答“怎么写代码”，而是以招聘顾问身份工作。

### 行 2-16：完整人设

人设包含四类约束：

#### 目标澄清

“先弄清目标岗位、职级、现状；信息不足只问一个最关键的问题。”

这避免模型一次抛出十几个问题，降低多轮体验的摩擦。

#### 工具使用顺序

- 上传简历后先 `resume_parse`。
- 改写前先把结构和措辞确定。
- 一次只调用一次 `resume_rewrite`。
- 用户需要 PDF 时才 `pdf_generate`。

这些规则直接影响运行时事件数量和版本数量。

#### 事实约束

“不得编造公司、项目、数字或技术栈。”

简历 Agent 最大的产品风险是模型为了显得专业而虚构量化成果。这里把“缺数据时告诉用户补哪里”写成明确策略。

#### 输出风格与边界

- 结论先行。
- 中文。
- 直接但尊重。
- 只做简历和求职。
- 不承诺面试结果。
- 不评价人格。

这段字符串通过 YAML 块标量注入 `system-prompt`，不是作为每轮用户消息重复发送。

## 2. server/src/agent/patch.ts

### 行 1-3：依赖

```ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ROOT, WORKSPACE_DIR, UPLOAD_DIR, OUTPUT_DIR } from "../config";
```

补丁文件需要在运行时生成，因为 Node 可执行文件路径随机器变化。

### 行 5-10：为什么不写静态 YAML

如果写死：

```text
command: C:\Program Files\node.exe
```

换机器或换 Node 安装就会失效。

当前代码在每次启动 DSH 时调用 `writePatch()`，把当前 `process.execPath` 和脚本路径写进去。

### 行 12-19：PatchOptions

```ts
export interface PatchOptions {
  filePath: string;
  mcpCommand: string;
  mcpArgs: string[];
  persona: string;
}
```

`filePath` 在 `writePatch()` 里用于确定落盘位置。`buildPatchYaml()` 接收它但没有真正读取，这是当前接口里一个轻微冗余。

### 行 21-56：DISABLED_ENTRIES

补丁会禁用大量 DSH 默认能力。分类理解：

- 插件管理器。
- shell 和 PowerShell。
- 文件系统。
- skill。
- subagent。
- workflow。
- todo、goal、plan。
- web 和定时任务。
- ask-user。
- present、commands。
- 依赖上述服务的派生插件。

目的不是“模型更聪明”，而是缩小能力面：

- 避免模型绕过三个受控工具直接改文件。
- 避免 coding profile 的工具干扰简历任务。
- 减少运行时启动时的 pending 警告和上下文噪音。

### 行 58-66：生成人设补丁

```ts
lines.push(
  "- id: system-prompt",
  "  config:",
  `    personaPrefix: ${blockScalar(options.persona, 6)}`,
  "",
);
```

YAML 结果：

```yaml
- id: system-prompt
  config:
    personaPrefix: |
      你是 ResumeAgent...
```

`blockScalar()` 负责给每一行加缩进。

### 行 64-66：禁用项

每个项写成：

```yaml
- id: tool-bash
  disabled: true
```

这是 DSH profile 的 patch/override 语义。不是删除源码，而是让运行时忽略这些 entry。

### 行 68-84：插入 MCP client

```yaml
- insert:
    - id: mcp-resume
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: resume
        transport: stdio
        command: '<node>'
        args:
          - '<mcp-server>'
        cwd: '<repo>'
        env:
          RESUME_WORKSPACE: '<workspace>'
          RESUME_UPLOAD_DIR: '<uploads>'
          RESUME_OUTPUT_DIR: '<outputs>'
          NODE_ENV: production
```

`serverName: resume` 决定工具名前缀：

```text
mcp__resume__resume_parse
```

`transport: stdio` 表示 DSH 和工具服务通过标准输入输出交换 JSON-RPC。

环境变量把工具侧路径边界固定到服务端当前使用的目录。尤其是测试或自定义 `RESUME_WORKSPACE` 时，不能使用工具进程自己的默认目录。

### 行 86：返回 YAML

末尾补换行，避免 YAML 文件最后一行没有终止符。

### 行 89-94：writePatch

```ts
const target = resolve(filePath);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, buildPatchYaml({ ...options, filePath: target }), "utf8");
return target;
```

步骤：

1. 目标转绝对路径。
2. 创建父目录。
3. 生成 YAML。
4. 同步写入。
5. 返回路径给 DSH 启动参数。

这里不是原子写，但补丁在启动前写一次，失败会直接抛错，风险低于会话 JSON。

### 行 96-98：patchExists

简单存在检查。当前运行时主要用 `writePatch`，这个函数是辅助 API。

### 行 100-103：quote

```ts
return `'${value.replaceAll("'", "''")}'`;
```

YAML 单引号字符串里，单引号需要写成两个单引号。反斜杠保持原样，因此特别适合 Windows 路径。

### 行 105-113：blockScalar

```ts
const body = text
  .split("\n")
  .map((line) => (line === "" ? "" : `${padding}${line}`))
  .join("\n");
return `|\n${body}`;
```

结果：

- `|` 表示保留换行。
- 非空行统一缩进。
- 空行不插入空格，避免尾随空白。

## 3. server/src/agent/mcp-launch.ts

### 行 1-3：依赖

只用到文件检查和路径解析。

### 行 5-9：设计说明

优先使用 esbuild 产出的单文件：

```text
dist/mcp-server.mjs
```

未构建时回退：

```text
node --import tsx tools/src/mcp-server.ts
```

这让开发环境即使忘记 build 也能工作。

### 行 10-16：mcpLaunch

```ts
if (existsSync(bundled)) {
  return {
    command: process.execPath,
    args: [bundled],
  };
}
return {
  command: process.execPath,
  args: [
    "--import",
    "tsx",
    resolve(ROOT, "tools/src/mcp-server.ts"),
  ],
};
```

`process.execPath` 是当前 Node 的绝对路径，不使用字符串 `"node"`。这样 MCP 子进程和服务端使用同一个 Node 安装。

## 4. server/src/agent/events.ts

这是一层纯翻译器。它不启动进程，不访问文件，只把 DSH 事件转成 UiEvent。

### 行 1-3：依赖

- `basename`：从 artifact 绝对路径生成下载文件名。
- `decodeToolResult`：识别工具产物。
- 共享类型。

### 行 5-10：设计原则

只依赖事件里的公开字段：

```ts
type, seq, time, data
```

未知事件忽略。DSH 以后新增事件时，服务端不会因为 switch 没有分支而崩溃。

### 行 12-17：DshSessionEvent

```ts
export interface DshSessionEvent {
  type: string;
  seq: number;
  time: number;
  data: unknown;
}
```

项目没有直接导入 DSH 的完整 SessionEvent 泛型，而是用结构类型。这样事件字段演进时兼容性更强。

### 行 19-25：EventSink

```ts
emit(event): void;
onAssistant?(...): void;
onToolCall?(...): void;
onToolResult?(...): void;
onUsage?(...): void;
```

`emit` 是发给 UI 的主通道。

回调是给服务端副作用的：

- Langfuse 记录。
- 版本登记。

`?` 表示调用方可以不实现。

### 行 27-33：NormalizeOptions

```ts
toolNames: Map<string, string>
```

因为 `tool/call` 有工具名，`tool/result` 只有 `toolCallId`。必须缓存 callId 到 name 的映射。

`onEventTime` 当前没有调用方使用。

### 行 35：MAX_TOOL_OUTPUT

```ts
const MAX_TOOL_OUTPUT = 4000;
```

只限制发给 UI 的 output。完整 output 仍传给 `onToolResult`。

### 行 37-40：入口

```ts
const data = asRecord(event.data);
```

后续所有字段读取都不会因为 data 是 null、数组或字符串而崩。

### 行 42-45：turn/start

```ts
sink.emit({
  type: "turn_start",
  turn: numberOr(data.turn, 1),
});
```

这是模型循环开始。当前 UI 不展示。

### 行 47-49：step/start

一个 turn 可以有多个 step，每个 step 通常是一次模型调用及其工具执行。

### 行 51-58：tool/call

```ts
const callId = stringOr(data.callId, "");
const name = stringOr(data.name, "tool");
const args = stringOr(data.arguments, "");
toolNames.set(callId, name);
sink.emit({ type: "tool_call", callId, name, args });
sink.onToolCall?.({ callId, name, args });
```

所有字段都有 fallback：

- 缺 callId 变成空字符串。
- 缺 name 变成 `tool`。
- 缺 args 变成空字符串。

先存映射再发事件，保证后续 result 能找到名字。

### 行 60-75：tool/result

```ts
const message = asRecord(data.message);
const callId = stringOr(message.toolCallId, "");
const name = toolNames.get(callId) ?? "tool";
const output = blocksToText(message.content);
const ok = message.isError !== true;
```

关键点：

- 只把严格等于 true 视为错误。缺失 isError 视为成功。
- output 从内容块数组中拼出所有 text block。

随后：

```ts
sink.emit({
  type: "tool_result",
  callId,
  name,
  ok,
  output: truncate(output, MAX_TOOL_OUTPUT),
});
sink.onToolResult?.({
  callId,
  name,
  ok,
  output,
});
emitArtifacts(output, sink);
```

顺序：

1. UI 得到截断结果。
2. 服务端副作用得到完整结果。
3. 完整结果再解析 artifact。

### 行 77-86：assistant/message

```ts
const text = blocksToText(message.content);
const reasoning = blocksToReasoning(message.content);
const usage = usageOf(data.usage);
sink.emit({
  type: "assistant",
  text,
  reasoning: reasoning || undefined,
  usage: usage ?? undefined,
});
sink.onAssistant?.({ text, reasoning, usage });
if (usage !== null) sink.onUsage?.(usage);
```

可见正文和 reasoning 分开提取。

`reasoning || undefined` 把空字符串变成省略字段，减少 JSON 噪音。

### 行 87-92：job/settled

这是一个可能由插件产生的后台任务事件：

```ts
if (
  data.status === "failed" &&
  typeof data.detail === "string" &&
  data.detail.trim() !== ""
) {
  sink.emit({
    type: "error",
    message: `工具执行失败：${data.detail}`,
  });
}
```

只有失败且有非空 detail 才显示错误。

### 行 93-97：turn/end

```ts
const reason = asRecord(data.reason);
sink.emit({
  type: "done",
  finishReason: stringOr(reason.kind, "completed"),
});
```

当前 UI 不直接处理 done。

### 行 98-101：未知事件

```ts
default:
  return;
```

这是兼容性设计，不是遗漏。

### 行 103-116：emitArtifacts

```ts
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
```

内部 artifact 的绝对 path 被转换为 HTTP URL。浏览器看不到磁盘路径。

### 行 118-128：usageOf

```ts
if (
  usage.inputTokens === undefined &&
  usage.outputTokens === undefined
) {
  return null;
}
```

两个核心字段都不存在时视为没有 usage。

否则映射：

```text
inputTokens      -> input
outputTokens     -> output
cacheReadTokens  -> cacheRead
cacheWriteTokens -> cacheWrite
totalTokens      -> total
```

### 行 130-137：blocksToText

```ts
content
  .filter(block => isRecord(block) && block.type === "text")
  .map(block => stringOr(block.text, ""))
  .filter(text => text !== "")
  .join("\n");
```

只保留 text 类型内容块，多个文本块用换行连接。

### 行 139-146：blocksToReasoning

同样逻辑，只保留 `type === "reasoning"`。

### 行 148-154：asRecord / isRecord

```ts
isRecord(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}
```

排除数组很重要，因为 `typeof [] === "object"`。

### 行 156-162：stringOr / numberOr

`stringOr` 只接受字符串。

`numberOr` 额外要求 `Number.isFinite`，排除：

- NaN
- Infinity
- -Infinity

### 行 164-166：truncate

超长时保留前 max 个字符并追加省略号。注意结果总长度是 `max + 1`，不是严格不超过 max。

## 5. server/src/agent/runtime.ts

这个文件是服务端和 DSH SDK 的适配层。

### 行 1-9：依赖

```ts
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";
import type { HarnessNotification } from "@deepseek-ai/dsh-sdk-client";
```

`DeepSeekHarness` 负责：

- 启动 DSH 子进程。
- 完成 initialize 握手。
- 管理 session 句柄。
- 接收 JSON-RPC 通知。

本地模块负责：

- 生成补丁。
- 决定 MCP 启动方式。
- 把事件标准化。
- 控制同一 session 的串行。
- 恢复持久化 session。

### 行 11-18：设计说明

三个关键点：

1. 一个 Node 进程只启动一个 DSH。
2. 一个 DSH session 对应一个前端会话。
3. 同一 session 的 turn 串行。

### 行 20-24：AttachmentRef

```ts
export interface AttachmentRef {
  name: string;
  path: string;
  chars: number;
}
```

这是发给 Agent prompt 的附件信息，比公开 Attachment 少，只保留模型需要的三项。

### 行 26-33：TurnInput

```ts
sessionId
text
attachments
resume?
sink
```

`resume` 表示该会话此前有历史，可能需要 DSH 恢复。

### 行 35-39：TurnOutcome

```ts
text
usage
events
```

`events` 是实际转发的事件数量，主要用于调试，当前路由没有持久化它。

### 行 41-45：模块级状态

```ts
let harness: DeepSeekHarness | null = null;
let starting: Promise<void> | null = null;
const sessionQueues = new Map<string, Promise<unknown>>();
const knownSessions = new Set<string>();
```

逐个解释：

- `harness`：惰性创建的单例。
- `starting`：保存 start Promise。
- `sessionQueues`：每个 DSH session 一条 Promise 链。
- `knownSessions`：当前运行时进程里已经打开或恢复过的 session。

`knownSessions` 只存在内存，服务重启后清空。

### 行 47-62：runtimeInfo

```ts
const launch = mcpLaunch();
return {
  model: DSH.model,
  provider: DSH.provider,
  patch: resolve(DSH.patchDir, "resume-agent.patch.yml"),
  started: harness !== null,
  mcp: launch,
};
```

这是给 `/api/health` 和 Langfuse 元数据用的。

注意 `started` 只表示对象是否创建，不保证 `start()` 已成功完成。

### 行 64-119：getHarness

#### 快速路径

```ts
if (harness !== null) return harness;
```

避免每个 turn 都重新创建。

这里存在一个并发启动窗口：

- 第一个请求把 harness 赋值为对象。
- 然后 `await harness.start()`。
- 在此期间第二个请求看到 harness 非 null，会直接返回，而没有等待 `starting`。

DSH SDK 内部可能对 session.run 的启动顺序有保护，但单从本地代码看，`starting` 没有被快速路径使用。

#### 生成补丁

```ts
const launch = mcpLaunch();
const patchPath = writePatch(
  resolve(DSH.patchDir, "resume-agent.patch.yml"),
  {
    mcpCommand: launch.command,
    mcpArgs: launch.args,
    persona: PERSONA,
  },
);
```

每次新 harness 启动时重写补丁，确保 Node 路径和 MCP 路径是当前机器的真实路径。

#### 启动参数

```ts
const args = [
  "--expose-internals",
  DSH.cliPath,
  "--profile",
  DSH.profile,
  "--patch",
  patchPath,
];
```

含义：

- 以 Electron 的 Node 模式运行 CLI。
- 加载 sdk profile。
- 叠加 ResumeAgent 补丁。

#### 子进程环境

```ts
const childEnv = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: "1",
  DSH_PERMISSION_MODE: "danger-full-access",
  ...(DSH.home === undefined ? {} : { DSH_HOME: DSH.home }),
};
```

解释：

- 复制父进程环境，保留模型凭据。
- `ELECTRON_RUN_AS_NODE` 让桌面版 exe 按 Node 运行。
- `danger-full-access` 避免 Windows 工作区授权失败。
- DSH_HOME 可选，用来隔离桌面版会话存储。

然后删除宿主环境：

```ts
for (const key of [
  "DSH_PROFILE",
  "DSH_PROFILE_DIR",
  "DSH_SESSION_ID",
  "DSH_WEB_URL",
]) {
  delete childEnv[key];
}
```

如果不清掉，子进程可能继承桌面宿主自己的 profile，加载错误的运行模式。

#### 创建 SDK 实例

```ts
harness = new DeepSeekHarness({
  launch: {
    command: DSH.command,
    args,
    cwd: WORKSPACE_DIR,
    env: childEnv,
    requestTimeoutMs: 10 * 60 * 1000,
  },
  provider: DSH.provider,
  model: DSH.model,
  cwd: WORKSPACE_DIR,
  maxTokens: DSH.maxTokens,
});
```

10 分钟超时给“模型多次调用 + 多次工具执行”的一轮留空间。

#### 调试输出

```ts
if (process.env.RESUME_DEBUG === "1") {
  console.error("[runtime] args:", args);
  console.error(
    "[runtime] DSH env:",
    Object.entries(childEnv)
      .filter(([key]) => key.startsWith("DSH_")),
  );
}
```

只打印 DSH 环境变量，避免把完整进程环境里的其他密钥打出来。不过 DSH 环境里本身可能含凭据，调试时应小心。

#### 启动

```ts
starting = harness.start();
try {
  await starting;
} catch (error) {
  harness = null;
  starting = null;
  throw error;
}
return harness;
```

启动失败时清空单例，允许下一次请求重新尝试。

### 行 122-133：runTurn

```ts
const previous =
  sessionQueues.get(input.sessionId) ?? Promise.resolve();

const current = previous
  .catch(() => undefined)
  .then(() => execute(input));

sessionQueues.set(input.sessionId, current);
```

Promise 链的含义：

- 如果同一 session 已有 turn，等它结束。
- 前一个 turn 失败也不能阻断后一个。
- `.catch(() => undefined)` 把失败转成已解决。
- 新 turn 只在前一个 settle 后执行。

```ts
try {
  return await current;
} finally {
  if (sessionQueues.get(input.sessionId) === current) {
    sessionQueues.delete(input.sessionId);
  }
}
```

只有当前 Promise 仍是队列尾部时才删除。这样不会误删后来排队的新 turn。

### 行 135-139：execute 初始化

```ts
const active = await getHarness();
const toolNames = new Map<string, string>();
let usage: TokenUsage | null = null;
let emitted = 0;
```

每个 turn 新建 `toolNames`，因为 callId 只在本轮内有意义。

### 行 141-156：包装 sink

运行时再包一层 EventSink：

- `emit` 计数。
- `onAssistant` 转发并保存最后一个 usage。
- `onToolCall` 转发。
- `onToolResult` 转发。

为什么不转发 `onUsage`：

- `events.ts` 会在 `onAssistant` 后单独调用 `onUsage`。
- 这里已经通过 `onAssistant(info.usage)` 保存 usage。
- 当前没有额外需求再实现 `onUsage`。

### 行 158-159：session 与 prompt

```ts
const session = active.session(input.sessionId);
const prompt = buildPrompt(input.text, input.attachments);
```

`active.session()` 只是创建本地句柄，不产生网络请求。真正创建 session 发生在第一次 `run`。

### 行 161-169：onNotification

```ts
if (notification.method !== "session.event") return;
const event =
  notification.params.event as DshSessionEvent | undefined;
if (event === undefined) return;

const params =
  notification.params as { sessionId?: string };

if (
  params.sessionId !== undefined &&
  params.sessionId !== input.sessionId
) {
  return;
}

normalizeSessionEvent(event, { sink, toolNames });
```

只处理 `session.event` JSON-RPC 通知。

过滤 session：

- 没有 sessionId 时放行。
- 有且等于当前 session 时放行。
- 其他 session 或子 agent 事件丢弃。

### 行 171-186：resume

```ts
const resume = async (): Promise<void> => {
  try {
    await active.client.request(
      "session/resume",
      { sessionId: input.sessionId },
      30_000,
    );
    knownSessions.add(input.sessionId);
  } catch (error) {
    const message = ...;
    if (/already open|already exists/i.test(message)) {
      knownSessions.add(input.sessionId);
      return;
    }
    console.warn(...);
  }
};
```

为什么需要显式 resume：

- 服务端重启后 DSH 可能是新进程。
- conversations.json 还有历史。
- DSH_HOME 里也还有 session。
- 直接 prompt 可能被 DSH 认为“session already exists”。

容错：

- `already open` 或 `already exists` 视为已恢复。
- 其他错误只警告，仍继续尝试 prompt。

### 行 188：何时 resume

```ts
if (
  input.resume === true &&
  !knownSessions.has(input.sessionId)
) {
  await resume();
}
```

只有已有历史，且当前进程没见过该 session 时才做。

### 行 190-194：运行

```ts
const blocks = [{
  type: "text",
  text: prompt,
}];

let result;
try {
  result = await session.run(blocks, { onNotification });
} catch (error) { ... }
```

DSH SDK 的 `HarnessSession.run()` 会：

1. 把 prompt 排入 session。
2. 观察 session 事件直到下一次 idle。
3. 返回 finalResponse、events、notifications。

### 行 195-203：already exists 重试

```ts
const message =
  error instanceof Error ? error.message : String(error);
if (!/already exists/i.test(message)) throw error;

await new Promise((done) => setTimeout(done, 1500));
knownSessions.delete(input.sessionId);
await resume();
result = await active.session(input.sessionId).run(
  blocks,
  { onNotification },
);
```

这是针对“上一个运行时进程尚未完全退出，会话锁还没释放”的补偿。

只重试一次，且只匹配 already exists。

### 行 205-208：完成

```ts
knownSessions.add(input.sessionId);
const text = result.finalResponse.trim();
return { text, usage, events: emitted };
```

trim 去掉首尾空白。usage 是最后一个 assistant/message 的 usage。

### 行 211-226：buildPrompt

没有附件时直接返回原文本。

有附件时构造：

```text
<用户文本>

---
[用户随消息上传的文件]
- 文件名；绝对路径：...；可读文本约 N 字
需要解析、改写或导出时，把上面的绝对路径作为工具入参。
回复用户时只提文件名，不要输出这些路径。
```

为什么要强调“回复只提文件名”：

- 绝对路径对用户无意义。
- 暴露本机目录不友好。
- 下载和版本展示由 UI 负责。

### 行 228-236：closeRuntime

```ts
const current = harness;
harness = null;
starting = null;
knownSessions.clear();
if (current !== null) await current.close();
```

先把模块状态清空，再关闭当前实例。

如果 close 失败，harness 已经是 null，下一次请求会尝试创建新实例。

### 行 238-243：信号处理

```ts
process.once("SIGINT", () => void closeRuntime());
process.once("SIGTERM", () => void closeRuntime());
```

`index.ts` 也注册了信号处理器，并调用同一个 `closeRuntime()`。两个处理器都会触发，但第二次看到 harness 为 null，基本是 no-op。

## 6. server/src/obs/langfuse.ts

Langfuse 是可选观测，不影响主流程。

### 行 1-11：依赖

- Langfuse OTel span processor。
- Langfuse tracing API。
- OpenTelemetry provider。
- OpenTelemetry 诊断日志。
- 共享 usage 类型。
- 配置。

### 行 13-21：为什么用 OTel

Langfuse v4 的 `events_only` 部署只通过 OTLP 接收 trace/generation，旧 ingestion 路径可能“成功但面板无数据”。

因此：

- 使用 `@langfuse/otel`。
- 使用 OpenTelemetry 标准 tracer provider。

### 行 23：enabled

```ts
const enabled =
  LANGFUSE.publicKey !== "" &&
  LANGFUSE.secretKey !== "";
```

两个 key 都非空才启用。

### 行 25-51：ensureProcessor

```ts
if (!enabled) return null;
if (processor !== null) return processor;

processor = new LangfuseSpanProcessor({
  publicKey,
  secretKey,
  baseUrl,
  environment: process.env.NODE_ENV ?? "development",
  flushAt: 1,
  flushInterval: 1000,
});

const provider = new NodeTracerProvider({
  spanProcessors: [processor],
});
provider.register();
```

参数含义：

- `flushAt: 1`：有一条 span 就触发上报，适合小流量。
- `flushInterval: 1000`：最多等 1 秒。
- `environment`：开发/生产区分。

`RESUME_OTEL_DEBUG=1` 会打开 OpenTelemetry 诊断日志。

### 行 53-55：observabilityEnabled

返回 key 配置状态，不检查网络。

### 行 57-76：verifyLangfuse

```ts
fetch(`${LANGFUSE.baseUrl}/api/public/health`, {
  signal: AbortSignal.timeout(8000),
})
```

启动时做一次健康检查：

- 成功打印版本。
- 非 200 打印警告。
- 网络失败打印警告。

最后调用 `ensureProcessor()`，即使健康检查失败也初始化 processor，后续 flush 失败由 catch 吞掉。

### 行 78-94：接口与参数

`TurnTrace` 是路由使用的抽象：

```ts
modelStarted()
modelCompleted()
toolStarted()
toolFinished()
failed()
finish()
```

`TurnTraceParams` 包含 conversation、session、message、input、model、attachments。

### 行 96-104：no-op 与状态

```ts
const active = ensureProcessor();
if (active === null) return noopTrace();
```

未配置时路由代码完全不用写条件分支。

状态：

- `root`：整轮 trace。
- `generation`：模型调用。
- `toolSpans`：callId 到工具 span。
- `usageRecorded`：最终 usage。

### 行 105-129：创建 trace 和 generation

```ts
void propagateAttributes({
  traceName: "resume-agent.turn",
  userId: "local-user",
  sessionId: params.conversationId,
  tags: ["resume-agent", "web-mvp"],
  metadata: {
    dshSessionId: params.sessionId,
    messageId: params.messageId,
  },
}, () => {
  root = startObservation("resume-agent.turn", {...});
  generation = root.startObservation(
    "deepseek.chat",
    {...},
    { asType: "generation" },
  );
});
```

`propagateAttributes` 把 trace 级属性注入 OpenTelemetry 上下文。回调里的根 span 和 generation 会继承这些属性。

`sessionId` 用的是前端 conversation id，不是 DSH session id。DSH session 放在 metadata。

### 行 131-134：modelStarted

空实现。generation 在创建时已经开始计时。

### 行 136-153：modelCompleted

```ts
usageRecorded = usage;
generation?.update({
  output: text,
  ...(usage === null ? {} : {
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
```

第一次完成后结束 generation 并置空。

当前一轮如果包含多个模型 step，只有第一次 `assistant/message` 会落到这个 generation。后面的 assistant 消息会更新 `usageRecorded`，但不会创建新的 generation。这是当前观测粒度的限制。

### 行 155-163：toolStarted

```ts
if (root === null || toolSpans.has(callId)) return;
const span = root.startObservation(
  `tool:${name.replace(/^mcp__[a-z0-9_]+__/i, "")}`,
  { input: args },
  { asType: "tool" },
);
toolSpans.set(callId, span);
```

按 callId 去重。工具名去掉 MCP 前缀。

### 行 165-174：toolFinished

```ts
span.update({
  output: output.slice(0, 8000),
  ...(ok ? {} : {
    level: "ERROR",
    statusMessage: `工具 ${name} 执行失败`,
  }),
});
span.end();
toolSpans.delete(callId);
```

输出最多记录 8000 字。失败标记 ERROR。

### 行 176-179：failed

```ts
root?.update({
  level: "ERROR",
  statusMessage: message.slice(0, 500),
});
```

只标根 span，不自动结束。finish 仍会执行。

### 行 181-193：finish

```ts
root?.update({
  output,
  metadata: { tokenUsage: usageRecorded },
});
root?.end();
root = null;

await Promise.race([
  active.forceFlush(),
  new Promise((done) => setTimeout(done, 2000)),
]);
```

`Promise.race` 的重点：

- 正常 flush 完成就继续。
- 最多等 2 秒。
- 超时 Promise 不会取消 flush，只是不再等待。

catch 吞掉上报异常，保证聊天不被观测系统拖垮。

### 行 197-206：noopTrace

所有方法为空。

`async finish() {}` 返回已解决的 Promise，路由可以统一 await。

## 7. 这一层的两个重要限制

### Langfuse 一轮只有一个 generation

一次 Agent turn 可能包含多个模型 step。当前 UI 事件可以收到多个 assistant/message，但观测层只创建了一个 generation。

### 运行时没有取消

DSH SDK 文档明确没有 wire-level cancel。SSE 断开只停止发 UI 事件，不终止模型或工具。

## 8. 本章完成后应能回答

- 为什么补丁文件必须运行时生成？
- MCP 工具为什么在 YAML 里用当前 Node 绝对路径启动？
- `toolNames` Map 在事件翻译中解决什么问题？
- UI 输出和 Langfuse/版本登记为什么拿到不同长度的工具结果？
- 同一会话如何保证 turn 串行？
- 服务重启后为什么需要 `session/resume`？
- Langfuse 没有配置时，主流程为什么不需要写分支？
