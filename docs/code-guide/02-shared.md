# 02 - 共享协议、工具载荷与文本抽取

这一章覆盖三个文件：

- `shared/protocol.ts` 1-101
- `shared/tool-payload.ts` 1-50
- `shared/extract.ts` 1-106

它们没有 Express、没有 React，却被前后端和工具共同依赖。先理解这里的类型，后面很多实现会变得直接。

## 1. shared/protocol.ts

### 行 1-4：文件说明

注释说明这个文件的职责：

- 聊天消息。
- 附件。
- 流式事件。
- 产物。

最重要的设计是“前后端共享同一份类型”。服务端返回的对象如果缺字段或写错枚举，TypeScript 会在编译期发现。运行时仍然没有 schema 校验，因此边界输入仍需手动判断。

### 行 6-12：TokenUsage

```ts
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}
```

这是给 UI 和存储使用的简化 token 统计，不是模型供应商原始 usage 对象。

字段含义：

- `input`：本次请求输入 token。
- `output`：模型输出 token。
- `cacheRead`：命中提示词缓存的 token。
- `cacheWrite`：写入缓存的 token。
- `total`：供应商报告的总量。

`interface` 只描述形状，不生成运行时代码。编译成 JavaScript 后这个类型会消失。

### 行 14-22：Attachment

```ts
export interface Attachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  preview: string;
  chars: number;
}
```

浏览器能看到的附件对象。

- `id`：不是文件路径，而是 `attachments.json` 中的索引键。
- `name`：用户看到的原始文件名。
- `size`：字节数。
- `mime`：上传时浏览器报告的 MIME。
- `preview`：抽取文本的前 4000 字，用于上传后的即时反馈和上下文。
- `chars`：完整抽取文本长度，不只是 preview 长度。

真正保存的 `StoredAttachment` 在 `server/src/attachments.ts` 中多一个 `path`，但不会直接发给浏览器。

### 行 24-28：Artifact

```ts
export interface Artifact {
  name: string;
  url: string;
  bytes: number;
}
```

浏览器可下载产物。

- `name`：下载文件名。
- `url`：HTTP 下载地址。
- `bytes`：文件大小。

它不包含服务器绝对路径。MCP 工具内部另有 `ToolArtifact.path`，那是带绝对路径的内部协议。

### 行 30-41：ChatMessage

```ts
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
  attachments?: Attachment[];
  toolCalls?: ToolCallView[];
  artifacts?: Artifact[];
  usage?: TokenUsage;
  createdAt: string;
  error?: string;
}
```

一条聊天消息同时承载多种信息。

- `role` 是字符串字面量联合类型，只允许两个值。
- `text` 必填，工具正在执行时可以暂时是空字符串。
- `reasoning` 可选，是模型思考内容；不是每条模型都提供。
- `attachments` 只通常出现在用户消息。
- `toolCalls` 和 `artifacts` 只通常出现在助手消息。
- `usage` 是助手消息的 token 统计。
- `createdAt` 使用 ISO 8601 字符串，方便 JSON 持久化和排序。
- `error` 存在时表示这轮出现错误，但消息仍会保存。

`?` 表示字段可以不存在，不是“值一定为 null”。项目用 `undefined` 和省略字段表达可选值。

### 行 43-49：ToolCallView

```ts
export interface ToolCallView {
  callId: string;
  name: string;
  args: string;
  status: "running" | "ok" | "error";
  output?: string;
}
```

工具条的 UI 模型。

- `callId`：把 `tool/call` 和 `tool/result` 配对。
- `name`：展示名，例如 `resume_parse`。
- `args`：模型生成的原始 JSON 字符串，不解析成对象，避免 UI 丢失格式或类型信息。
- `status`：三态机。
- `output`：结果文本，仅完成后存在。

服务端保存的工具输出会被截断到 4000 字。完整输出另用于 Langfuse 和版本登记。

### 行 51-58：Conversation

```ts
export interface Conversation {
  id: string;
  title: string;
  dshSessionId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}
```

一个聊天会话。

- `id`：ResumeAgent 自己的 UUID。
- `title`：列表展示标题，首条用户消息后生成。
- `dshSessionId`：DSH 运行时会话 id。
- `messages`：完整消息历史。
- `createdAt`、`updatedAt`：ISO 时间。

这里有两个 id 是有意的：

- `id` 用于 HTTP 路由和本地存储。
- `dshSessionId` 用于恢复 Agent 上下文。

### 行 60-79：ResumeVersion

```ts
export interface ResumeVersion {
  id: string;
  kind: "original" | "optimized";
  label: string;
  fileName: string;
  createdAt: string;
  chars: number;
  source: "upload" | "agent";
  downloadUrl: string;
  pdfUrl?: string;
  needsOcr?: boolean;
}
```

版本抽屉的数据。

- `kind` 决定“原始”还是“优化”标签。
- `label` 是 `原始简历` 或 `优化版 vN`。
- `fileName` 是磁盘上的实际文件名。
- `chars` 是正文规模。
- `source` 表示人工上传还是 Agent 生成。
- `downloadUrl` 是可点击下载地址。
- `pdfUrl` 只在已导出 PDF 时出现。
- `needsOcr` 只对抽不到文字的 PDF 出现。

`ResumeVersion` 比服务端内部的 `StoredVersion` 少掉绝对路径。转换发生在 `publicVersions()`。

### 行 82-90：UiEvent

```ts
export type UiEvent =
  | { type: "turn_start"; turn: number }
  | { type: "step_start"; turn: number; step: number }
  | { type: "tool_call"; ... }
  | { type: "tool_result"; ... }
  | { type: "assistant"; ... }
  | { type: "artifact"; ... }
  | { type: "error"; ... }
  | { type: "done"; finishReason: string };
```

这是一个可辨识联合类型。每个对象都有 `type` 字段，TypeScript 可以据此缩小分支。

当前 UI 实际直接处理：

- `assistant`
- `tool_call`
- `tool_result`
- `artifact`
- `error`

`turn_start`、`step_start`、`done` 会进入 `Switch` 的 `default`，当前不渲染。保留它们是为了以后展示步骤进度或结束原因。

### 行 92-95：displayToolName

```ts
return name.replace(/^mcp__[a-z0-9_]+__/i, "");
```

MCP 客户端通常会把工具名加上服务器前缀：

```text
mcp__resume__resume_parse
```

正则含义：

- `^`：从字符串开头。
- `mcp__`：固定前缀。
- `[a-z0-9_]+`：服务器名，一个或多个小写字母、数字或下划线。
- `__`：分隔符。
- `i`：大小写不敏感。

替换为空后得到 `resume_parse`。

### 行 97-101：TOOL_LABELS

展示名映射：

```ts
resume_parse   -> 解析简历
resume_rewrite -> 改写简历
pdf_generate   -> 生成 PDF
```

`Record<string, string>` 表示任意字符串键都能查询；未知工具会返回 `undefined`，组件再用 `??` 回退。

## 2. shared/tool-payload.ts

### 行 1-5：设计目标

工具给模型返回“自然语言摘要 + JSON 代码块”。这样同一条 MCP 结果同时服务：

- 模型理解。
- 服务端登记版本。
- UI 下载卡片。
- Langfuse 工具输出记录。

### 行 7-13：ToolArtifact

```ts
export interface ToolArtifact {
  name: string;
  path: string;
  bytes: number;
}
```

这是工具内部使用的产物形状，比前端 `Artifact` 多了绝对 `path`，少了 HTTP `url`。

### 行 15-20：ToolPayload

```ts
export interface ToolPayload {
  ok: boolean;
  summary: string;
  data?: unknown;
  artifacts?: ToolArtifact[];
}
```

`data` 故意是 `unknown`。不同工具的 data 形状不同：

- parse 返回 profile 和 rawText。
- rewrite 返回 path、chars、preview。
- pdf 返回 path、bytes。

读取 data 时必须自行检查字段，不能直接信任类型断言。

### 行 22：块提取正则

```ts
const BLOCK_PATTERN = /```json\s*([\s\S]*?)```\s*$/i;
```

逐部分解释：

- ` ```json `：只识别 json 标签。
- `\s*`：允许标签后换行或空格。
- `([\s\S]*?)`：非贪婪捕获任意字符，包括换行。
- ` ``` `：结束围栏。
- `\s*$`：JSON 块必须位于文本末尾，后面只能是空白。
- `i`：标签大小写不敏感。

限定末尾很重要。模型正文里如果也举例写了 JSON 块，服务端应只取工具结果最后那个结构化块。

### 行 24-31：encodeToolResult

```ts
const structured = {
  ok: payload.ok,
  ...(payload.data === undefined ? {} : { data: payload.data }),
  ...(payload.artifacts === undefined ? {} : { artifacts: payload.artifacts }),
};
return `${payload.summary}\n\n\`\`\`json\n${JSON.stringify(structured, null, 2)}\n\`\`\``;
```

这里使用条件展开：

- data 不存在时不输出 `"data": undefined`。
- artifacts 不存在时同理。

`JSON.stringify(value, null, 2)` 第二个参数是 replacer，这里是 null；第三个参数 2 表示两空格缩进。

`summary` 不在 JSON 里。解码时从代码块之前的文本重新切出来，避免重复存储。

### 行 33-50：decodeToolResult

处理顺序：

1. 用正则找最后 JSON 块。
2. 找不到返回 `null`。
3. `JSON.parse`，失败返回 `null`。
4. 检查 `ok` 必须是 boolean。
5. summary 取代码块之前的文本并 trim。
6. artifacts 只有数组才保留。

返回结构不是直接信任 `parsed`，而是重新构造。这样可以防止：

- `summary` 被模型写进 JSON 后覆盖真实摘要。
- `artifacts` 是字符串或对象时进入 UI。

`match.index` 是整个匹配开始的位置，也就是第一个三反引号的下标。用它切片可以得到代码块之前的摘要，同时不会把 ` ```json ` 围栏带进 summary。

## 3. shared/extract.ts

### 行 1-2：同步文件 API

```ts
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
```

- `readFileSync` 同步读取完整文件。
- `basename` 取路径最后一段。
- `extname` 取扩展名。

上传文件最大 20MB，因此同步读取的阻塞时间可控。大文件或高并发场景应改成异步文件 API。

### 行 4-10：为什么 PDF 优先 mupdf

注释记录了真实兼容性问题：

- Word 导出的 PDF 可能使用子集字体。
- 缺少 ToUnicode 映射时，pdfjs 可能丢数字或映射错误汉字。
- mupdf 对这些文件更可靠。
- mupdf 抽出的文本为空时，仍回退 pdfjs。

### 行 12-16：ExtractedDocument

```ts
export interface ExtractedDocument {
  name: string;
  kind: "pdf" | "docx" | "text";
  text: string;
}
```

这里只保留三种逻辑文件类型。`.md` 和 `.txt` 都归为 `text`。

### 行 18-41：extractDocument

进入函数先：

```ts
const ext = extname(path).toLowerCase();
const name = basename(path);
```

统一小写让 `.PDF`、`.Pdf` 都能识别。

分支顺序：

#### 行 22-24：PDF

调用内部 `extractPdfText()`，返回 `pdf` 和文本。

#### 行 26-30：DOCX

动态 `import("mammoth")`：

- 避免服务启动时加载不常用依赖。
- `mammoth.default` 是 CommonJS 默认导出兼容写法。
- `extractRawText` 只抽正文，不保留复杂样式。

#### 行 32-34：DOC

明确拒绝旧 `.doc`。这比让底层库报一个难懂错误更友好。

#### 行 36-38：文本

支持 `.md`、`.markdown`、`.txt`，以 UTF-8 读取并规范化。

#### 行 40：未知类型

扩展名为空时提示 `(无扩展名)`。

### 行 43-63：extractPdfText

先同步读取整个 PDF 为 `Buffer`。

#### 行 46-57：mupdf 主路径

```ts
const doc = mupdf.Document.openDocument(buffer, "application/pdf");
```

逐页循环：

- `countPages()` 返回页数。
- `loadPage(index)` 是按需加载，不一次性打开所有页面资源。
- `pageTextInReadingOrder()` 自己重排文本块。
- 所有页用换行连接。
- normalize 后若非空，直接返回。

mupdf 抛错时会 `console.warn`，继续走 pdfjs。文本为空不算抛错，也会继续。

#### 行 59-62：unpdf 回退

```ts
const pdf = await getDocumentProxy(new Uint8Array(buffer));
const result = await extractText(pdf, { mergePages: true });
```

`Buffer` 本身是 `Uint8Array` 子类，但转成普通 `Uint8Array` 可避免不同库对 Buffer 行为假设不一致。

`mergePages: true` 让所有页按顺序合并成一个字符串。

### 行 65-96：pageTextInReadingOrder

很多 PDF 的内部绘制顺序不等于视觉阅读顺序。项目使用结构化文本中的坐标恢复阅读顺序。

#### 行 70-72：结构化页面形状

函数参数只声明实际会用到的能力：

```ts
{
  toStructuredText: (options: string) => {
    asJSON: () => string;
  }
}
```

这比依赖 mupdf 的完整 Page 类型更容易单测，也说明函数只调用这两个方法。

#### 行 73-79：解析 JSON

`preserve-whitespace` 保留文本布局中的空白。

类型声明允许：

- `blocks` 不存在。
- block 的 `type`、`bbox`、`x`、`y` 缺失。
- line 的 `text` 缺失。

随后用 `??` 提供默认值。

#### 行 81-91：块映射

过滤规则：

```ts
block.type === undefined || block.type === "text"
```

有些版本不返回 type；有 type 时只保留文本块。

每个块得到：

```ts
{ x, y, text }
```

行文本先 trim，去掉空行，再用换行连接。最后过滤空文本块。

#### 行 93-95：排序

```ts
blocks.sort((a, b) =>
  Math.abs(a.y - b.y) > 6 ? a.y - b.y : a.x - b.x
);
```

直观含义：

- 两个块垂直距离超过 6pt，认为不在同一视觉行，按 y 从上到下。
- 距离不超过 6pt，认为同一行，按 x 从左到右。

容差 6pt 用来处理同一行文字基线轻微不一致。

### 行 98-106：normalize

规范化按顺序执行：

1. 删除开头 BOM `\uFEFF`，解决 Windows 文本文件问题。
2. 删除 NUL 字符 `\u0000`，某些 PDF 抽取会出现。
3. CRLF 或单独 CR 统一为 LF。
4. 删除每行末尾空格和 tab。
5. 连续 3 个以上换行压缩成 2 个，即最多保留一个空行。
6. 删除整体首尾空白。

这种“稳定文本形状”对后续正则解析很重要。如果不先统一换行，简历分段会不稳定。

## 4. 这一层的测试价值

`tests/tools.test.ts` 覆盖了：

- 工具载荷编码解码。
- 简历解析和模板渲染。
- 补丁 YAML。

`shared/extract.ts` 没有单元测试，主要靠真实 PDF 冒烟脚本验证。这是当前测试覆盖的实际空缺，也是修改 PDF 抽取逻辑时最应该手动回归的地方。

## 5. 本章完成后应能回答

- `Attachment` 和 `StoredAttachment` 为什么不是同一个类型？
- 工具结果为什么不能只返回 JSON？
- `BLOCK_PATTERN` 为什么要求 JSON 块在末尾？
- mupdf 抽取失败和抽取为空分别会发生什么？
- PDF 文本块为什么需要按坐标重新排序？
- `normalize()` 的每一步分别防止什么问题？
