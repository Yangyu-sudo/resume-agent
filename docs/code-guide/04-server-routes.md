# 04 - HTTP 路由与 SSE

这一章覆盖项目最核心的两个文件：

| 文件 | 行号 |
|---|---|
| `server/src/routes/files.ts` | 1-142 |
| `server/src/routes/chat.ts` | 1-295 |

`files.ts` 负责“文件进入系统”，`chat.ts` 负责“一轮 Agent 运行如何变成聊天记录和实时事件”。

## 1. server/src/routes/files.ts

### 行 1-10：依赖

```ts
import { Router } from "express";
import multer from "multer";
...
import { extractDocument } from "../../../shared/extract";
import { parseResumeText } from "../../../tools/src/resume";
```

这里有一个跨层调用值得注意：

- HTTP 路由直接导入工具层的 `parseResumeText`。

这样做是为了上传后立即返回技能数、经历数、要点数。服务端与 MCP 工具共享同一个纯函数，不会出现两套解析器。

### 行 12-17：文件入口说明

三条职责：

1. 上传并解析。
2. 下载原始文件。
3. 下载生成产物。

### 行 19-28：multer 磁盘存储

```ts
const storage = multer.diskStorage({
  destination: (...) => callback(null, UPLOAD_DIR),
  filename: (...) => {
    const ext = extname(file.originalname)
      .toLowerCase()
      .slice(0, 12);
    callback(null, `${randomUUID()}${ext}`);
  },
});
```

`destination`：

- 每次上传前调用 `ensureDirs()`。
- 固定在 UPLOAD_DIR，不接受客户端指定目录。

`filename`：

- 从原始文件名取扩展名。
- 小写。
- 最多保留前 12 个字符，避免异常超长扩展名。
- 主体使用随机 UUID。

用户原始文件名不会直接用于磁盘路径。这避免了路径穿越和重名覆盖。

### 行 30-38：上传限制

```ts
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: ...,
});
```

限制：

- 单文件最大 20MB。
- 一次只允许 1 个文件。
- 扩展名白名单。

允许：

```text
.pdf .docx .doc .md .txt .markdown
```

注意 `.doc` 在过滤阶段允许，但 `extractDocument()` 随后会拒绝。这是有意保留“文件已落盘并能告诉用户换成 docx”的路径。

`callback(null, allowed.includes(ext))` 对不允许的文件返回 false，不抛错。multer 会跳过该文件，后续 `request.file` 为 undefined，用户收到的是统一的 400 提示。

### 行 40：Router

```ts
export const filesRouter = Router();
```

路由本身没有鉴权，依赖主机绑定 `127.0.0.1`。

### 行 42-47：上传入口

```ts
filesRouter.post(
  "/files",
  upload.single("file"),
  async (request, response) => { ... }
);
```

`upload.single("file")` 要求 multipart 字段名必须是 `file`。

如果文件缺失或过滤未通过：

```ts
response.status(400).json({
  error: "请上传 PDF / DOCX / MD / TXT 简历文件",
});
```

### 行 49-50：扩展名和展示文件名

```ts
const ext = extname(file.originalname).toLowerCase();
const fileName = decodeOriginalName(file.originalname);
```

磁盘名是 UUID，展示名仍是用户原文件名。

### 行 52-58：抽取文本

```ts
let text = "";
try {
  text = (await extractDocument(file.path)).text;
} catch (error) {
  text = "";
  console.warn(...);
}
```

抽取失败不会删除文件，也不会让 HTTP 请求失败。系统仍然登记附件，只是 `text` 为空。

这是一种“先接受上传，再给出可用性信号”的产品选择。

### 行 60-61：扫描件判断

```ts
const needsOcr = ext === ".pdf" && text.length < 80;
```

只在 PDF 且文本少于 80 字符时判定。

这不是 OCR 检测，只是启发式：

- 极短的文字 PDF 可能被误判。
- 扫描件如果带了少量页眉文本，也可能没被判定。

### 行 63-71：构造附件

```ts
const attachment: StoredAttachment = {
  id: randomUUID(),
  name: fileName,
  size: file.size,
  mime: file.mimetype,
  preview: text.slice(0, 4000),
  chars: text.length,
  path: file.path,
};
```

字段含义在 shared 协议章已经解释。

`preview` 最多 4000 字，但 `chars` 是全文长度。前端不能根据 preview.length 推断全文长度。

### 行 72：保存附件索引

```ts
saveAttachment(attachment);
```

磁盘文件与 attachments.json 的路径在这里建立对应关系。

### 行 74：可选 conversationId

```ts
const conversationId =
  typeof request.body?.conversationId === "string"
    ? request.body.conversationId
    : "";
```

multipart 表单里的 conversationId 会出现在 `request.body`。

这里没有验证 conversationId 是否真实存在。`addOriginal()` 只按字符串建 bucket，因此可以为一个不存在的会话创建版本记录。

### 行 76-83：登记原始版

```ts
version = addOriginal(conversationId, {
  path: file.path,
  fileName,
  chars: text.length,
  needsOcr,
});
```

只有显式传入 conversationId 才登记。前端在 `attach(file)` 时传当前会话 id。

### 行 85-98：上传时解析结构

```ts
let structure = null;
if (text !== "" && !needsOcr) {
  try {
    const profile = parseResumeText(text);
    structure = {
      skills: profile.skills.length,
      experience: profile.experience.length,
      bullets: profile.stats.bullets,
    };
  } catch {
    structure = null;
  }
}
```

返回结构统计，不返回完整 profile。

原因：

- 上传接口主要用于快速反馈。
- 完整结构在 Agent 调用 `resume_parse` 时由工具返回。
- 避免把大块 JSON 塞进上传响应。

### 行 100-107：返回公开附件

```ts
const { path: _path, ...visible } = attachment;
response.json({
  attachment: visible,
  chars: attachment.chars,
  needsOcr,
  structure,
  ...(conversationId === "" ? {} : {
    versions: publicVersions(conversationId)
  }),
});
```

这里再次去掉 path。`chars` 同时存在于 visible 和顶层，前者属于 Attachment 协议，后者方便上传调用方直接读。

### 行 110-118：下载原始文件

```ts
const name = basename(request.params.name ?? "");
const target = resolve(join(UPLOAD_DIR, name));
if (!target.startsWith(UPLOAD_DIR + sep) || !existsSync(target)) {
  response.status(404).json({ error: "文件不存在" });
  return;
}
response.download(target, name);
```

安全层次：

1. `basename()` 去掉任何目录成分。
2. `resolve()` 得到绝对路径。
3. `startsWith(UPLOAD_DIR + sep)` 防止目录边界绕过。

为什么必须加 `sep`：

```text
UPLOAD_DIR = C:\workspace\uploads
恶意路径 = C:\workspace\uploads-evil\a.pdf
```

只检查 `startsWith(UPLOAD_DIR)` 会错误放行。加路径分隔符后边界明确。

### 行 120-128：下载产物

逻辑与上传目录相同，只是根目录换成 OUTPUT_DIR。

浏览器下载名使用请求里的 `name`，通常是 UUID 或工具生成的安全文件名。

### 行 130-138：修复中文文件名

```ts
const decoded = Buffer.from(name, "latin1").toString("utf8");
return decoded.includes("\uFFFD") ? name : decoded;
```

某些浏览器/multipart 组合会把 UTF-8 字节当 latin1 字符串交给 Node。重新编码可以恢复中文。

判断逻辑：

- 正常 UTF-8 解码失败会出现替换字符 U+FFFD。
- 如果出现，说明原字符串可能本来已经正确，返回原值。
- 如果没有替换字符，采用重新解码结果。

这是一个启发式修复，不是严格编码探测。

### 行 140-142：fileSize

```ts
export function fileSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}
```

当前仓库没有调用点。它可能是早期或预留的辅助函数。读代码时不要因为它存在就认为主流程使用它。

## 2. server/src/routes/chat.ts

这是全项目最重要的路由文件。

### 行 1-23：依赖

按职责分：

- Express Router。
- UUID。
- 共享类型。
- `runTurn` 和运行时信息。
- EventSink。
- Langfuse。
- 附件解析。
- 版本登记。
- 工具载荷解码。
- 会话存储。

`decodeToolResult` 是版本登记的关键：工具返回的文本必须后缀 JSON 块，服务端才能识别 artifact。

### 行 25：Router

所有路由都在 `/api` 前缀下，因为 `index.ts` 这样挂载。

### 行 27-29：会话列表

```ts
chatRouter.get("/conversations", ...)
```

返回：

```json
{ "conversations": [...] }
```

没有分页。列表按 updatedAt 倒序，由 store 负责。

### 行 31-33：创建会话

返回 HTTP 201，而不是默认 200。客户端 `getJson` 只检查 `response.ok`，所以两种都接受。

### 行 35-42：读取单个会话

找不到返回 404。

### 行 44-47：删除会话

```ts
const removed = deleteConversation(...);
response.json({ ok: removed });
```

即使 id 不存在，HTTP 也是 200，只是 `ok: false`。这和读取接口的 404 不一致，属于当前 API 语义。

### 行 49-56：读取版本

先检查会话存在，再调用 `publicVersions()`。

### 行 58-60：增强健康检查

返回：

```json
{
  "ok": true,
  "runtime": { "...": "..." },
  "observability": true
}
```

这里会调用 `runtimeInfo()`，但不会启动 DSH。`started` 只表示当前进程是否已经创建过 harness 对象。

### 行 62-65：聊天接口说明

SSE 只推增量事件。历史通过 GET 会话单独读取。

### 行 66-71：查找会话

请求路径中的 id 对应 `Conversation.id`，不是 `dshSessionId`。

### 行 73-77：解析 body

```ts
const body = request.body as {
  text?: unknown;
  attachmentIds?: unknown;
};
```

先用 `unknown`，再手动检查。这比直接断言为字符串数组更安全。

文本处理：

```ts
const text =
  typeof body.text === "string" ? body.text.trim() : "";
```

附件 id 只保留字符串元素。

### 行 79-86：输入限制

```ts
if (text === "" && attachmentIds.length === 0) -> 400
if (text.length > 20000) -> 400
```

注意：

- 附件 ID 数量没有上限。
- 只有文本长度限制。
- 附件 ID 是否真实存在尚未检查。

如果传了 100 个不存在的附件 ID，这段校验会通过，后面 `resolveAttachments()` 返回空数组。

### 行 88：解析附件

```ts
const attachments = resolveAttachments(attachmentIds);
```

只有索引存在且磁盘文件仍存在的附件会保留。

边界情况：

```text
text = ""
attachmentIds = ["不存在"]
```

第 79 行看到 attachmentIds.length 是 1，放行。

第 88 行得到 attachments = []。

最终 Agent 收到空 prompt。当前代码没有再次检查解析后的附件数组。

### 行 89-90：判断是否需要恢复 DSH 会话

```ts
const hadHistory = conversation.messages.length > 0;
```

必须在追加当前用户消息之前取值。否则每条新消息都会看到至少一条历史，永远把 resume 设为 true。

### 行 91-100：构造用户消息

```ts
const userMessage: ChatMessage = {
  id: randomUUID(),
  role: "user",
  text,
  attachments: attachments.map(({ path, ...rest }) => rest),
  createdAt: new Date().toISOString(),
};
```

附件只存公开部分，不把绝对路径写入 conversations.json。

### 行 101：先持久化用户消息

```ts
appendMessage(conversation.id, userMessage);
```

顺序很关键。即使后面模型失败、SSE 断开或进程崩溃，用户这次输入仍然在历史中。

### 行 103-109：SSE 响应头

```ts
response.writeHead(200, {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
});
response.flushHeaders?.();
```

逐个解释：

- `text/event-stream`：告诉浏览器这是 SSE。
- `charset=utf-8`：中文 JSON 不依赖浏览器猜测。
- `no-cache`：中间层不要缓存。
- `no-transform`：代理不要压缩或改写流。
- `keep-alive`：长连接语义。
- `x-accel-buffering: no`：防止反向代理攒缓冲。
- `flushHeaders`：尽快把响应头发给客户端。

### 行 111-116：检测客户端断开

```ts
let closed = false;
response.on("close", () => {
  if (!response.writableFinished) closed = true;
});
```

注释解释了核心陷阱：

- `request` 的 close 可能在请求体读完后触发。
- 用它判断会把整轮事件都丢弃。
- `response` 的 close 且尚未正常写完，才表示客户端断开。

### 行 118-125：send

```ts
const send = (event: string, data: unknown): void => {
  if (closed) return;
  try {
    response.write(
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    );
  } catch {
    closed = true;
  }
};
```

SSE 帧格式：

```text
event: ui
data: {"type":"tool_call"}

```

最后一个空行是事件分隔符。

`JSON.stringify` 会把内部换行转义，因此一个 data 可以保持单行。

### 行 127-129：心跳

```ts
const heartbeat = setInterval(() => {
  if (!closed) response.write(": ping\n\n");
}, 15_000);
```

以冒号开头的 SSE 行是注释。浏览器不会把它当事件，但连接会保持活跃，代理也不会判定空闲超时。

### 行 131：收集器

```ts
const collector = new TurnCollector();
```

后面详细解释。

### 行 132-139：开始 Langfuse trace

```ts
const trace = startTurnTrace({
  conversationId: conversation.id,
  sessionId: conversation.dshSessionId,
  messageId: userMessage.id,
  input: text === "" ? "[仅上传文件]" : text,
  model: runtimeInfo().model,
  attachments: attachments.map((item) => item.name),
});
```

没有配置 key 时返回 no-op 对象，后续调用仍然可以安全执行。

### 行 141-156：EventSink

这是路由层与运行时层之间的桥。

```ts
const sink: EventSink = {
  emit(event) {
    collector.apply(event);
    send("ui", event);
  },
  onAssistant(info) { ... },
  onToolCall(info) { ... },
  onToolResult(info) { ... },
};
```

每个 `ui` 事件同时做两件事：

1. 更新最终消息收集器。
2. 推给浏览器。

`onToolResult` 拿到的 output 是完整文本，不是给 UI 的 4000 字截断版本。因此版本登记不会被截断掉 JSON 尾部。

### 行 158-159：计时和错误

```ts
const startedAt = Date.now();
let error: unknown = null;
```

`startedAt` 后来给 `durationMs`，但当前持久化的 ChatMessage 没有 duration 字段，所以这个值最终没有进入公开消息。它仍保留在 collector 中，可能是预留字段。

### 行 161-176：运行 Agent

```ts
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

  collector.text =
    collector.text === "" ? outcome.text : collector.text;
  collector.usage = collector.usage ?? outcome.usage;
  collector.durationMs = Date.now() - startedAt;
} catch (caught) { ... }
```

文本回退规则：

- 如果流事件已经给出 assistant 文本，保留 collector 文本。
- 如果没有任何 assistant 事件，则使用 `result.finalResponse`。

usage 回退类似：事件里有就用事件，否则用 run 返回的 usage。

### 行 177-185：错误分支

```ts
} catch (caught) {
  error = caught;
  trace.failed(caught);
  const message = ...;
  send("ui", { type: "error", message });
  collector.error = message;
} finally {
  clearInterval(heartbeat);
}
```

运行失败不会让 HTTP 响应变成 500，因为 SSE 已经以 200 开始。错误通过事件流表达。

心跳在 Agent 运行结束后停止，即使发生错误。

### 行 187-198：构造并保存助手消息

```ts
const assistantMessage: ChatMessage = {
  id: randomUUID(),
  role: "assistant",
  text: collector.text,
  ...(collector.reasoning === "" ? {} : {
    reasoning: collector.reasoning
  }),
  ...(collector.toolCalls.length === 0 ? {} : {
    toolCalls: collector.toolCalls
  }),
  ...(collector.artifacts.length === 0 ? {} : {
    artifacts: collector.artifacts
  }),
  ...(collector.usage === null ? {} : {
    usage: collector.usage
  }),
  ...(collector.error === undefined ? {} : {
    error: collector.error
  }),
  createdAt: new Date().toISOString(),
};

appendMessage(conversation.id, assistantMessage);
```

这是条件展开模式。字段无意义时不写入 JSON，保持存储简洁。

即使模型失败，也会保存一条 assistant 消息。这样用户刷新页面后仍能看到错误。

### 行 200：saved 事件

```ts
send("saved", {
  userMessage,
  assistantMessage,
  versions: publicVersions(conversation.id),
});
```

为什么再发一次 userMessage：

- 前端先显示的是本地临时 id。
- saved 带了服务端真实 id。
- 前端据此替换本地消息，避免后续重复。

versions 是工具调用注册完成后的最新列表。

### 行 201-203：收尾

```ts
await trace.finish(collector.error ?? collector.text);
send("end", { ok: error === null });
response.end();
```

Langfuse flush 最多等待 2 秒，不会无限拖住聊天。

`end` 是最后的业务事件。前端目前不显式处理它，读取循环靠流关闭结束。

### 行 206-208：注释中的关键约束

```text
必须用完整的工具输出
```

原因：

- UI 的 tool_result 被截断到 4000 字。
- 大 JSON 的 artifacts 在末尾。
- 如果解析截断文本，可能完全看不到 artifact。

### 行 210-237：recordToolArtifacts

```ts
function recordToolArtifacts(
  conversationId,
  toolName,
  ok,
  output
): void {
  if (!ok) return;
  const payload = decodeToolResult(output);
  if (payload === null || !payload.ok) return;

  const name = displayToolName(toolName);
  ...
}
```

第一步过滤：

- 工具执行失败。
- 没有可解码 JSON。
- JSON 里 ok 为 false。

#### resume_rewrite

```ts
const artifact = payload.artifacts?.[0];
if (artifact === undefined) return;
const data = payload.data as { chars?: unknown } | undefined;
addOptimized(conversationId, {
  path: artifact.path,
  fileName: artifact.name,
  chars: typeof data?.chars === "number" ? data.chars : 0,
});
```

只取第一个 artifact。当前工具每次只返回一个 Markdown 文件。

`data.chars` 必须实际是数字，否则写 0。这里没有检查 path 是否真的位于 outputs，因为 path 来自受控工具。

#### pdf_generate

```ts
const data = payload.data as { path?: unknown } | undefined;
if (typeof data?.path === "string") {
  attachPdf(conversationId, data.path);
}
```

PDF 版本关联使用 data.path，而不是 artifacts[0].path。两者当前相同，但代码明确选择 data 字段。

### 行 239-295：TurnCollector

字段：

- `text`
- `reasoning`
- `usage`
- `durationMs`
- `error`
- `calls` Map
- `artifactList`

#### apply：assistant

```ts
if (event.text !== "") this.text = event.text;
if (event.reasoning !== undefined && event.reasoning !== "") {
  this.reasoning = event.reasoning;
}
if (event.usage !== undefined) this.usage = event.usage;
```

空文本不会覆盖已有文本。这很重要，因为某些中间 assistant 事件可能只有工具调用或 usage，没有可见文字。

#### apply：tool_call

```ts
this.calls.set(event.callId, {
  callId: event.callId,
  name: displayToolName(event.name),
  args: event.args,
  status: "running",
});
```

同一个 callId 再次出现会覆盖，避免重复。

#### apply：tool_result

```ts
const existing = this.calls.get(event.callId);
if (existing !== undefined) {
  existing.status = event.ok ? "ok" : "error";
  existing.output = event.output;
}
```

只更新已经见过的 call。没有 call 的 result 被忽略。

#### apply：artifact

```ts
if (!this.artifactList.some((item) => item.url === event.artifact.url)) {
  this.artifactList.push(event.artifact);
}
```

按 URL 去重。不同工具生成同名文件也会因 URL 相同而只保留一个。

#### apply：error

记录最后一条错误消息。

#### getter

```ts
get toolCalls() {
  return [...this.calls.values()];
}

get artifacts() {
  return this.artifactList;
}
```

工具调用保持 Map 插入顺序。artifact 数组按收到事件的顺序。

## 3. SSE 事件总表

| SSE event | data | 用途 |
|---|---|---|
| `ui` | UiEvent | 实时工具、正文、产物、错误 |
| `saved` | 最终消息和版本 | 替换本地消息并完成持久化交接 |
| `end` | `{ ok }` | 表示本轮 SSE 结束 |
| `: ping` | 无 | 15 秒心跳 |

## 4. 客户端断开后会发生什么

当前设计：

1. 浏览器关闭连接。
2. `closed = true`。
3. `send()` 不再写响应。
4. Agent 仍然继续执行。
5. 工具仍可能生成文件。
6. 助手消息仍会写入 conversations.json。
7. Langfuse 仍会完成 trace。

项目没有真正的取消能力。DSH SDK 也没有 wire-level cancel，取消通常只能关闭整个运行时。

## 5. 错误传播的三个层级

### 输入错误

例如空消息、id 不存在、文本过长。

结果：HTTP 4xx JSON。

### Agent 运行错误

例如 DSH 启动失败、模型请求失败、工具运行时异常。

结果：SSE 已开始，发送 `ui error`，保存错误助手消息。

### 进程级错误

例如 JSON 存储写入失败、未捕获的 Express 异常。

结果：可能进入统一错误中间件；如果 SSE 头已发送，无法改状态码。

## 6. 本章完成后应能回答

- 为什么用户消息要在 SSE 头之前落库？
- 为什么 SSE 用 response 的 close，而不是 request 的 close？
- `saved` 为什么要带服务端 userMessage？
- 为什么版本登记使用完整工具输出，而不使用 UI 截断输出？
- 工具失败、JSON 解析失败、payload.ok=false 分别在哪一层被过滤？
- 客户端断开后，模型和工具会停止吗？
