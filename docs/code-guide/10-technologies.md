# 10 - 项目技术全景

这一章讲的是“技术本身”，不是逐行源码。内容包括：

- 语言和运行时。
- 后端框架与 HTTP 协议。
- AI Agent、DSH、JSON-RPC、MCP。
- 文件解析和 PDF 生成。
- 持久化。
- OpenTelemetry 和 Langfuse。
- React 前端。
- 构建、测试、安全。

每项技术都会回答五个问题：

1. 它是什么？
2. 这个项目为什么需要它？
3. 项目里在哪里使用？
4. 核心机制是什么？
5. 它带来了什么限制？

## 1. 技术地图

```text
语言
  TypeScript
  JavaScript ES Modules
  CSS
  HTML
  JSON
  YAML
  Markdown

运行环境
  Node.js
  Chromium / Edge / Chrome
  浏览器
  DeepSeek Harness 子进程
  MCP 工具子进程

后端
  Express
  Multer
  HTTP
  REST
  SSE
  Fetch API

Agent
  DeepSeek 模型
  DeepSeek Harness SDK
  JSON-RPC 2.0
  DSH profile / patch
  MCP
  Zod

文档
  mupdf
  unpdf
  Mammoth
  Markdown
  marked
  HTML
  CSS
  Puppeteer Core
  Chrome DevTools Protocol

数据
  JSON 文件
  临时文件 + rename
  UUID
  ISO 8601

观测
  Langfuse
  OpenTelemetry
  OTLP
  Trace / Span / Generation
  Token usage

前端
  React
  TSX
  React Hooks
  React Markdown
  remark-gfm
  Fetch ReadableStream
  TextDecoder
  AbortController
  CSS Flexbox / Grid

工程
  npm
  TypeScript Compiler
  tsx
  esbuild
  Vite
  Vitest
  concurrently
  Puppeteer 截图脚本
```

## 2. 实际版本

`package.json` 写的是 semver 范围，下面是当前 `node_modules` 实际解析出的版本。

| 技术 | 声明范围 | 当前安装 |
|---|---|---:|
| Node.js | `>=20` | `v24.15.0` |
| npm | 未声明 | `11.12.1` |
| TypeScript | `^5.9.3` | `5.9.3` |
| React | `^19.2.0` | `19.3.1` |
| React DOM | `^19.2.0` | `19.3.1` |
| Express | `^5.1.0` | `5.3.0` |
| DSH SDK | 固定 `0.0.1-rc.1` | `0.0.1-rc.1` |
| MCP SDK | `^1.20.0` | `1.32.2` |
| Langfuse OTel | `^6.1.1` | `6.1.1` |
| Langfuse Tracing | `^6.1.1` | `6.1.1` |
| OpenTelemetry API | `^1.9.1` | `1.9.1` |
| OpenTelemetry SDK | `^0.206.0` | `0.206.0` |
| Mammoth | `^1.10.0` | `1.13.0` |
| marked | `^16.4.2` | `16.4.2` |
| Multer | `^2.0.2` | `2.5.0` |
| mupdf | `^1.28.6` | `1.28.6` |
| Puppeteer Core | `^24.25.0` | `24.43.1` |
| unpdf | `^1.4.0` | `1.9.1` |
| Zod | `^4.1.12` | `4.6.7` |
| React Markdown | `^10.1.0` | `10.1.0` |
| remark-gfm | `^4.0.1` | `4.0.1` |
| tsx | `^4.20.6` | `4.23.15` |
| esbuild | `^0.25.11` | `0.25.12` |
| Vite | `^7.1.9` | `7.3.8` |
| Vitest | `^3.2.4` | `3.2.7` |
| concurrently | `^9.2.1` | `9.2.5` |

版本不要死记。理解每项技术的职责更重要。

## 3. TypeScript

### 3.1 TypeScript 是什么

TypeScript 是带静态类型检查的 JavaScript 方言。浏览器和 Node 原生不能直接执行 TypeScript，必须先：

- 类型擦除后运行。
- 或由 bundler 转换。

本项目有三种执行方式：

1. `tsx` 直接运行服务端 TypeScript。
2. `esbuild` 把 MCP 服务打成一个 `.mjs`。
3. `Vite` 把前端 TSX 打包成浏览器资源。

`tsc` 只做类型检查，配置了 `noEmit: true`。

### 3.2 项目用到的类型能力

#### interface

例如：

```ts
export interface Attachment {
  id: string;
  name: string;
  size: number;
}
```

用于描述对象形状。

#### type alias

例如：

```ts
type SectionKey =
  | "summary"
  | "experience"
  | "projects"
  | "education"
  | "skills"
  | "other";
```

用于联合类型和组合类型。

#### 字符串字面量联合

```ts
role: "user" | "assistant"
```

比普通 `string` 更安全，错误拼写会在编译期报错。

#### 可选属性

```ts
reasoning?: string
```

表示字段可以省略。项目用省略表达“没有”，而不是写入 null。

#### unknown

```ts
data?: unknown
```

用于跨协议边界。读字段前必须做类型检查。

#### 类型谓词

```ts
function isRecord(
  value: unknown,
): value is Record<string, unknown>
```

如果函数返回 true，TypeScript 在分支中把 value 缩窄为对象。

#### satisfies

```ts
send("ui", {
  type: "error",
  message,
} satisfies UiEvent);
```

要求对象满足 UiEvent 形状，但仍保留对象本身的具体类型。

#### 条件展开

```ts
...(value === undefined ? {} : { value })
```

类型安全地构造可选字段。

### 3.3 TypeScript 不能保证什么

TypeScript 类型在运行时消失。以下数据仍然可能在运行时错误：

- HTTP body。
- JSON 文件。
- 模型工具参数。
- DSH 事件。
- Langfuse API 响应。

所以项目在边界上使用：

- `typeof`。
- `Array.isArray`。
- `isRecord`。
- Zod。
- fallback 值。

### 3.4 tsconfig 的关键选择

#### strict

打开严格模式，包括空值检查、隐式 any 检查等。

#### moduleResolution: Bundler

适合 Vite、esbuild、tsx 这类现代打包/运行工具。允许省略扩展名、支持 package exports。

#### noEmit

不生成 JS。运行由 tsx/esbuild/Vite 负责。

#### noFallthroughCasesInSwitch

防止 switch 分支忘记 return/break。

#### forceConsistentCasingInFileNames

避免 Windows 大小写不敏感、Linux 大小写敏感导致的导入错误。

## 4. JavaScript ES Modules

### 4.1 为什么项目是 ESM

`package.json`：

```json
{
  "type": "module"
}
```

因此 `.js`、`.mjs` 默认按 ESM 解释：

```ts
import { readFileSync } from "node:fs";
export function foo() {}
```

不是 CommonJS 的：

```js
const fs = require("node:fs");
module.exports = {};
```

### 4.2 ESM 特性

- 静态 import 在执行前建立依赖图。
- 顶层 await 可用。
- `import.meta.url` 可定位当前模块。
- 动态 `import()` 可延迟加载依赖。

项目使用动态 import：

- Mammoth 只在 DOCX 时加载。
- mupdf 只在 PDF 时加载。
- unpdf 只在回退时加载。
- 预览脚本延迟加载 PDF 渲染器。

### 4.3 import 顺序为什么重要

`server/src/index.ts` 第一行：

```ts
import "./env";
```

ESM 会按依赖图执行模块副作用。env 模块先写 `process.env`，后导入的 config 才能读到配置。

## 5. Node.js

### 5.1 Node 的角色

项目中有两个长期运行的 Node 进程：

1. Express 服务。
2. MCP 工具服务。

DSH 自身是 Electron 桌面程序的 Node 模式子进程。

### 5.2 用到的 Node 核心模块

#### node:fs

用途：

- 上传文件读写。
- JSON 持久化。
- PDF/Markdown 输出。
- 检查路径。
- 临时目录。

同步 API：

```ts
readFileSync
writeFileSync
renameSync
existsSync
mkdirSync
statSync
```

为什么大量使用同步：

- 单用户。
- 文件最多 20MB。
- 实现简单。
- JSON 写入需要确定顺序。

代价：

- 阻塞事件循环。
- 不适合高并发。

#### node:path

关键函数：

- `resolve`：绝对化并规范化。
- `join`：拼接路径。
- `basename`：去目录。
- `extname`：取扩展名。
- `dirname`：父目录。
- `sep`：平台路径分隔符。

路径安全依赖这些函数，而不是手写字符串。

#### node:crypto

```ts
randomUUID()
```

用于：

- 会话 id。
- DSH session id 的一部分。
- 附件 id。
- 消息 id。
- 版本 id。

`randomBytes` 还用于手工构造 Langfuse trace/span id。

#### node:url

```ts
fileURLToPath(new URL("../..", import.meta.url))
```

用于从模块 URL 计算仓库根目录。

#### process

用途：

- 读取环境变量。
- 获取 `process.execPath`。
- 获取 `process.cwd()`。
- 注册 `SIGINT`、`SIGTERM`。
- 主动退出脚本。

#### Buffer

用途：

- 读取 PDF 字节。
- 计算 UTF-8 字节数。
- 修复 latin1 文件名。
- 生成 Basic Auth。

#### TextDecoder

前后端都用它把字节流转换为字符串。SSE 解析必须使用 `{ stream: true }`。

#### setTimeout / setInterval

用途：

- SSE 心跳。
- 打字机。
- 等待 DSH 会话锁释放。
- Langfuse flush 超时。
- 脚本等待网络和动画。

#### AbortSignal

```ts
AbortSignal.timeout(8000)
```

用于给 fetch 设置超时。

浏览器侧还使用 `AbortController`，当前保留了取消能力，但没有接 UI 按钮。

### 5.3 Node 的进程与子进程

项目使用两种启动子进程方式：

#### DSH SDK

SDK 内部通过 `child_process.spawn()` 启动 DSH harness。

#### 脚本

`smoke-mcp.mjs` 直接：

```js
spawn(process.execPath, [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
});
```

stdin 写请求，stdout 读响应，stderr 读日志。

### 5.4 Electron 作为 Node

DSH 默认可执行文件是 DeepSeek Harness 桌面版 exe。项目设置：

```text
ELECTRON_RUN_AS_NODE=1
```

Electron 看到该变量后会像 Node 一样执行指定 JS CLI，而不是打开桌面窗口。

这是理解 `DSH.command` 为什么是 `.exe`、`DSH.cliPath` 为什么是 asar 内 JS 文件的关键。

## 6. npm

### 6.1 package.json

职责：

- 项目元信息。
- Node 版本要求。
- 脚本。
- 依赖。
- ESM 类型。

### 6.2 dependencies 与 devDependencies

`dependencies`：

- 生产运行时需要。
- 或作为服务端/工具依赖。

`devDependencies`：

- TypeScript、tsx、esbuild、Vite、Vitest。
- React 和前端 library。

React 放在 devDependencies 不是错误。前端构建产物已经包含 React 代码，生产 Node 服务不再动态加载 React。

### 6.3 package-lock.json

锁定完整依赖树和版本，保证不同机器安装结果一致。

它适合审查安全变化，但不适合逐行学习业务。

### 6.4 semantic version

```text
^1.20.0
```

允许升级到 `<2.0.0` 的兼容版本。因此：

- package.json 写 1.20.0。
- 实际安装可能是 1.32.2。

DSH SDK 固定为 `0.0.1-rc.1`，因为 prerelease API 更容易发生破坏性变化。

## 7. HTTP

### 7.1 HTTP 是什么

浏览器和 Express 之间的请求/响应协议。项目用法：

- GET：读取会话、版本、健康状态。
- POST：创建会话、上传、发消息。
- DELETE：删除会话。
- 状态码：200、201、400、404、500。
- Content-Type：JSON、multipart、SSE。

### 7.2 REST 风格

资源路径：

```text
/api/conversations
/api/conversations/:id
/api/conversations/:id/messages
/api/conversations/:id/resumes
/api/files
/api/uploads/:name
/api/outputs/:name
```

这不是严格完整 REST，但遵循资源导向命名。

### 7.3 状态码

- 200：成功。
- 201：创建成功。
- 400：客户端输入错误。
- 404：资源不存在。
- 500：未处理服务端错误。

### 7.4 Content-Type

JSON：

```text
application/json
```

上传：

```text
multipart/form-data; boundary=...
```

SSE：

```text
text/event-stream; charset=utf-8
```

### 7.5 Content-Disposition

`response.download()` 会生成 attachment 头，让浏览器下载而不是展示。

### 7.6 HTTP 与 Agent 错误的区别

一旦 SSE 响应头发送：

```text
HTTP/1.1 200
```

后续模型错误不能再改成 HTTP 500。错误只能作为 SSE 事件发送。

## 8. Express 5

### 8.1 为什么使用 Express

- API 简单。
- Router 适合拆分会话和文件。
- 静态文件托管方便。
- 与 SSE、multer、错误中间件集成直接。

### 8.2 项目结构

```text
app
  express.json
  /api chatRouter
  /api filesRouter
  /api/health
  web/dist static
  SPA fallback
  error middleware
```

### 8.3 Router

`chatRouter` 和 `filesRouter` 都是独立中间件栈。挂载到 `/api` 后，各自处理子路径。

### 8.4 middleware

`express.json({ limit: "2mb" })` 是全局中间件，解析 JSON body。

Multer 是路由级中间件，只处理上传路由。

错误中间件是四参数函数，Express 用它识别错误处理。

### 8.5 Express 5 的异步错误

Express 5 会捕获 async route 返回的 rejected Promise。但 SSE 路由仍自行 try/catch，因为错误必须在已打开的流中表达。

### 8.6 静态文件和 SPA fallback

`express.static` 提供资源文件。

SPA fallback 对非 API GET 返回 `index.html`，让前端路由能刷新。

当前 React 没有使用路由库，因此 fallback 主要用于 `/` 和未来扩展。

## 9. Multer

### 9.1 它解决什么

Express 的 `express.json()` 不解析 `multipart/form-data`。Multer 负责：

- 接收文件流。
- 写入磁盘。
- 填入 `request.file`。
- 解析普通文本字段到 `request.body`。

### 9.2 存储策略

项目使用 `diskStorage`，不是 memoryStorage：

- 文件可能 20MB。
- 需要保留原件下载。
- 需要把路径交给 MCP 工具。

### 9.3 文件名设计

磁盘名：

```text
<uuid>.<ext>
```

展示名：

```text
用户原始文件名
```

避免重名、路径穿越和中文名在不同文件系统上的兼容问题。

### 9.4 限制

- 20MB。
- 一次一个文件。
- 扩展名白名单。

扩展名不是内容类型检测。恶意文件可以伪装扩展名，但工具只按对应解析器处理。

## 10. SSE

### 10.1 SSE 是什么

Server-Sent Events 是服务器到浏览器单向流。适合：

- 工具执行状态。
- 最终消息。
- 心跳。

不适合：

- 浏览器向服务器连续发送。
- 真正双向通信。

### 10.2 帧格式

```text
event: ui
data: {"type":"tool_call","name":"resume_parse"}

```

末尾空行表示事件结束。

### 10.3 为什么不用 WebSocket

当前只需要服务器单向推送：

- 用户消息通过普通 POST 提交。
- 后续都是服务器事件。

SSE 更简单：

- 基于 HTTP。
- 自动文本协议。
- 易于代理和调试。

### 10.4 为什么不用 EventSource

浏览器 EventSource 只支持 GET，不能带 JSON body 发一轮请求。

前端用 `fetch` POST，然后手工读取 ReadableStream。

### 10.5 SSE 心跳

每 15 秒：

```text
: ping
```

冒号行是注释，不进入事件 data，但保持连接。

### 10.6 SSE 解析的难点

网络 chunk 边界不等于事件边界：

```text
chunk 1: event: ui\ndata: {"type":"to
chunk 2: ol_call"}\n\n
```

必须用 buffer 和 TextDecoder 拼起来。

### 10.7 客户端断开

服务端通过 `response.on("close")` 检测。检测后：

- 不再写事件。
- 但模型和工具继续执行。
- 最终消息继续保存。

## 11. Fetch API

### 11.1 浏览器侧

用途：

- 普通 JSON API。
- 上传 FormData。
- POST + SSE 流读取。

`fetch` 不会因 HTTP 4xx/5xx 自动抛错，必须检查 `response.ok`。

### 11.2 Node 侧

Node 18+ 内置 fetch。项目用于：

- Langfuse 健康检查。
- 鉴权检查。
- OTLP 写入。

### 11.3 FormData / Blob

脚本用：

```js
const form = new FormData();
form.append(
  "file",
  new Blob([readFileSync(path)], { type: mime }),
  displayName,
);
```

这是 Node 内置 Web API，与浏览器 FormData 行为接近。

## 12. JSON

### 12.1 项目中的 JSON

- 会话存储。
- 附件索引。
- 版本存储。
- API 请求/响应。
- UiEvent。
- 工具载荷。
- Langfuse OTLP。

### 12.2 JSON 的限制

- 不保存 Date，只保存 ISO 字符串。
- 不保存 undefined。
- 不支持 Map/Set。
- 没有 schema。
- 数字精度有限。

项目在存储 Map 时转换为数组。

### 12.3 JSON.parse 风险

任意损坏文件都会抛错。项目通常 catch 后回退空结构。代价是错误可能被静默吞掉。

## 13. 持久化设计

### 13.1 为什么不用数据库

目标：

- 单用户。
- 单机。
- 体验验证。
- 降低部署门槛。

JSON 文件足够。

### 13.2 三个存储

- conversations.json。
- attachments.json。
- resumes.json。

### 13.3 内存缓存

读取一次后放内存，避免每个请求解析 JSON。

风险：

- 外部修改文件不会自动同步。
- 多进程会互相覆盖。

### 13.4 原子写

```text
写 file.tmp
  -> rename(file.tmp, file)
```

比直接覆盖安全。服务崩溃时旧文件通常还在。

没有 fsync，不保证断电级持久性。

### 13.5 UUID

用于避免主键冲突。随机 UUID 不泄露创建顺序，适合本地资源 id。

### 13.6 ISO 8601

```text
2026-11-18T12:34:56.789Z
```

好处：

- 时区明确。
- 可直接排序。
- JSON 友好。

`localeCompare` 对 ISO 字符串倒序即可按时间排序。

### 13.7 Map / Set

Map：

- 附件 id -> attachment。
- tool call id -> tool view。
- session id -> Promise 队列。
- Langfuse call id -> span。

Set：

- 已知 DSH session。
- 技能去重。
- 链接去重。
- Langfuse 事件类型统计。

## 14. 正则表达式

项目多处依赖正则：

- 环境文件 parse。
- BOM。
- 换行和空白。
- 工具名去前缀。
- GitHub/Gitee 链接。
- 手机和邮箱。
- 简历 section heading。
- bullet。
- 时间区间。
- 量化成果。
- YAML 单引号转义。

正则适合确定性文本规则，不适合复杂简历语义。因此解析器只是起点，模型负责纠错。

常见风险：

- 宽泛匹配吞掉过多文本。
- 不同简历排版不统一。
- 中英文标点。
- 年份和数字误判。
- ReDoS。当前输入长度有限，风险较低。

## 15. 大语言模型基础

### 15.1 模型在这个项目里做什么

模型负责：

- 理解用户目标。
- 读取 JD。
- 判断简历与岗位匹配度。
- 决定缺少哪些事实。
- 决定什么时候调用哪个工具。
- 组织改写后的措辞。

模型不负责：

- 直接写文件。
- 直接读任意路径。
- 排版 PDF。
- 维护本地会话 id。
- 生成数据库记录。

这就是“模型判断 + 工具确定性执行”的分工。

### 15.2 Token

模型按 token 计费和限制上下文。一个中文词可能被切成一个或多个 token。

项目记录：

- input。
- output。
- cacheRead。
- cacheWrite。
- total。

这些字段来自 DSH 的 usage，不保证每个模型都完整提供。

### 15.3 Context

模型没有持久记忆。每轮需要：

- system prompt。
- 会话历史。
- 当前用户消息。
- 工具结果。

DSH session 负责把这些内容组织成模型上下文。ResumeAgent 只保存聊天消息和 session id。

### 15.4 生成参数

当前代码没有显式设置 temperature、top_p 等。模型行为主要来自：

- provider/model 默认值。
- DSH profile 默认配置。
- maxTokens。
- system persona。

### 15.5 Reasoning

部分模型会返回 reasoning 内容。项目把它单独从 content block 中提取：

```text
type: "reasoning"
```

前端放在折叠区。业务不依赖 reasoning 做状态机。

### 15.6 Tool calling

模型不是直接执行函数，而是输出一个工具调用请求：

```text
工具名
JSON 参数
callId
```

宿主执行后把结果作为 tool message 放回上下文，模型再继续。

### 15.7 当前模型

默认：

```text
provider: deepseek-official
model: deepseek-flash
```

项目不直接请求 DeepSeek API，而由 DSH 负责供应方凭据、路由和模型协议。

## 16. DeepSeek Harness

### 16.1 它是什么

DeepSeek Harness 是一个 Agent 运行时。它管理：

- 模型调用循环。
- session。
- 上下文。
- tools。
- 事件。
- 子 agent。
- profile 和 plugin。

ResumeAgent 通过 SDK 以子进程方式驱动它。

### 16.2 为什么项目需要它

如果直接调用模型 API，需要自己实现：

- 多轮上下文。
- 工具调用循环。
- 工具结果回填。
- session 持久化。
- 流事件。
- 并发控制。
- token usage。
- reasoning/content block。

DSH 已经提供这些能力。ResumeAgent 专注产品逻辑。

### 16.3 子进程启动

配置：

```ts
new DeepSeekHarness({
  launch: {
    command: DSH.command,
    args: [
      "--expose-internals",
      DSH.cliPath,
      "--profile",
      DSH.profile,
      "--patch",
      patchPath,
    ],
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

### 16.4 profile

profile 决定加载哪些插件和能力。

项目默认：

```text
sdk
```

不使用桌面 profile，因为桌面 profile 被 Electron 宿主占用。

### 16.5 patch

patch 是运行时叠加层：

- 设置 ResumeAgent 人设。
- 禁用不需要的工具。
- 插入 Resume MCP server。

这比维护一整份完整 profile 文件更适合扩展。

### 16.6 session

前端 Conversation 对应一个 DSH session。

SDK 的 `session(id)` 只是创建本地句柄，不产生网络流量。第一次 run 时运行时才创建 session。

### 16.7 turn 和 step

```text
turn
  用户提交一次

step
  一次模型调用及其工具执行
```

一个 turn 可以有多个 step。

### 16.8 事件

项目消费的关键事件：

- `turn/start`
- `step/start`
- `tool/call`
- `tool/result`
- `assistant/message`
- `job/settled`
- `turn/end`

事件通过 JSON-RPC notification 到达。

### 16.9 运行时恢复

服务重启后：

```text
conversations.json 还有历史
DSH_HOME 还有 session
新 DSH 进程内存为空
```

因此下一轮先请求 `session/resume`。

### 16.10 session 串行

同一 session 用 Promise 链排队：

```ts
const current = previous
  .catch(() => undefined)
  .then(() => execute(input));
```

不同 session 可以并发。

### 16.11 权限模式

子进程环境：

```text
DSH_PERMISSION_MODE=danger-full-access
```

原因不是要开放能力，而是避免 Windows 沙箱为工作区授权失败。真正的能力限制来自 patch 禁用原生工具，只暴露 MCP。

### 16.12 取消

DSH 协议没有 wire-level cancel。项目无法在保留运行时的情况下中止一轮 turn。SSE 断开不等于取消模型。

## 17. JSON-RPC 2.0

### 17.1 是什么

JSON-RPC 是一种远程调用格式。基本请求：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "resume_parse",
    "arguments": {
      "path": "D:\\workspace\\uploads\\a.md"
    }
  }
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": []
  }
}
```

通知没有 id，不期待响应：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized",
  "params": {}
}
```

### 17.2 stdio transport

子进程：

- stdin 接收命令。
- stdout 返回响应。
- stderr 输出日志。

所以 stdout 是协议通道，不能打印普通日志。

手工 MCP 冒烟脚本按“一行一个 JSON-RPC 消息”读取 stdout。正式 MCP SDK 的 stdio transport 封装了同样的分帧细节，业务代码不需要自己拼帧。

### 17.3 为什么不用 HTTP

DSH 和 MCP 都是本地子进程：

- 不需要端口。
- 不需要鉴权。
- 不暴露网络。
- 生命周期由父进程管理。

stdio 更简单、更安全。

### 17.4 手工 RPC 示例

`scripts/smoke-mcp.mjs` 自己实现：

- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call`

它用 Map 保存 id 到 Promise resolve，是理解 JSON-RPC 客户端的好材料。

## 18. YAML

### 18.1 项目为什么用 YAML

DSH profile patch 使用 YAML。

项目用它表达：

```yaml
- id: tool-bash
  disabled: true
```

以及：

```yaml
- insert:
    - id: mcp-resume
      name: '@deepseek-ai/dsh-mcp-client'
```

### 18.2 YAML 块标量

```yaml
personaPrefix: |
  第一行
  第二行
```

`|` 保留换行。

### 18.3 Windows 路径

YAML 单引号字符串里反斜杠不转义：

```yaml
command: 'C:\node.exe'
```

单引号本身通过双写转义：

```text
'It''s'
```

### 18.4 动态生成

不能用静态 YAML，因为：

- Node 路径随机器变化。
- workspace 路径随环境变化。
- mcp-server 输出路径可能不同。

## 19. MCP

### 19.1 MCP 是什么

Model Context Protocol 是模型与外部工具/资源之间的标准协议。

三个角色：

```text
Host         DSH
Client       DSH 内部 MCP client
Server       resume-tools
```

本项目只使用 Tools 能力。

### 19.2 工具注册

```ts
server.registerTool(
  "resume_parse",
  {
    title: "解析简历",
    description: "...",
    inputSchema: {
      path: z.string(),
    },
  },
  async ({ path }) => { ... },
);
```

MCP SDK 会把工具信息转换成模型可见的工具定义。

### 19.3 工具命名

DSH 给 MCP 工具加服务器前缀：

```text
mcp__resume__resume_parse
```

服务端展示前去掉前缀。

### 19.4 工具结果

MCP 返回内容块：

```ts
{
  content: [
    {
      type: "text",
      text: "..."
    }
  ]
}
```

本项目所有工具都返回文本，其中末尾包含 JSON 代码块。

### 19.5 isError

```ts
{
  content: [...],
  isError: true
}
```

让宿主知道工具失败，同时模型仍能读到失败原因。

### 19.6 为什么工具不直接返回结构化 JSON

模型对自然语言摘要更稳定。结构化 JSON 仍然保留，供宿主解析。

### 19.7 MCP 与普通函数调用的区别

- 标准协议。
- 独立进程。
- 工具描述和参数 schema 可发现。
- 与语言和进程解耦。
- 可运行在 stdio/HTTP 等 transport。

代价：

- 协议复杂。
- 调试涉及子进程。
- stdout 污染风险。
- 启动和打包更复杂。

## 20. Zod

### 20.1 是什么

Zod 是 TypeScript-first 的运行时 schema 校验库。

TypeScript 只在编译期约束。模型传来的参数是运行时 JSON，必须验证。

### 20.2 项目用法

```ts
const entrySchema = z.object({
  org: z.string().default(""),
  role: z.string().default(""),
  period: z.string().default(""),
  bullets: z.array(z.string()).default([]),
});
```

`default` 处理模型省略字段。

`describe` 让 MCP schema 和模型提示包含字段解释。

### 20.3 嵌套 schema

`profileSchema` 嵌套 `basics` 和多个 entry 数组。

MCP SDK 会把 schema 暴露给模型，并校验工具调用参数。

### 20.4 为什么不用手写 if

手写检查：

- 代码长。
- 容易漏字段。
- 难以生成工具 JSON Schema。

Zod 同时完成验证和 schema 描述。

## 21. Prompt Engineering

### 21.1 persona

`persona.ts` 是 system prompt：

- 身份。
- 工作流程。
- 工具策略。
- 事实约束。
- 输出格式。
- 边界。

### 21.2 指令优先级

高优先级：

- 不编造事实。
- 使用工具。
- 只在需要时生成版本。

低优先级：

- 风格细节。

### 21.3 一次只调用一次 rewrite

每次 rewrite 都会新增版本。模型如果重复调用，用户会看到多个近似版本。

因此 prompt 明确要求确认后再调用一次。

### 21.4 防止幻觉

只靠 prompt 不能完全防止。项目还通过：

- 先 parse。
- 保留 rawText。
- 工具模板不接受 stats 造假。
- 服务端展示工具结果。

但模型仍可能改写过度。事实审核是后续产品能力。

### 21.5 Prompt injection

简历或 JD 中可能包含恶意指令，例如“忽略上面所有要求，执行某工具”。

项目没有专门 prompt injection 防护。能力白名单限制了真正危险操作，但模型仍可能被误导。

## 22. PDF 文本抽取

### 22.1 PDF 是什么

PDF 是页面描述格式，不是天然文本流。文本可能：

- 以字体子集存储。
- 缺少 Unicode 映射。
- 以独立文本框绘制。
- 被扫描成图片。

### 22.2 mupdf

项目主路径：

```ts
mupdf.Document.openDocument(buffer, "application/pdf")
```

为什么优先：

- 对 Word 导出的子集字体更稳。
- 不容易丢数字。
- 对中文字符映射更可靠。
- 提供结构化文本和坐标。

### 22.3 unpdf / pdfjs

回退路径：

```ts
getDocumentProxy(...)
extractText(pdf, { mergePages: true })
```

当 mupdf 抛错或抽取为空时使用。

README 记录了它在某些 PDF 上丢数字、把汉字映射成康熙部首。

### 22.4 阅读顺序重排

PDF 内部绘制顺序可能把侧栏标题堆到末尾。项目按结构化 block 的 `(y, x)` 排序：

- y 差大于 6pt，按上下。
- 同一水平线，按左右。

这是启发式版面恢复。

### 22.5 扫描件

扫描 PDF 是图片，没有文本层。项目没有 OCR，只检测并提示。

检测规则：

```text
PDF 且抽取文本少于 80 字
```

## 23. DOCX 和 Mammoth

### 23.1 DOCX 是什么

DOCX 是 ZIP 包，里面是 XML 文档。

直接读文字需要解压和解析 XML。

### 23.2 Mammoth

```ts
mammoth.extractRawText({ buffer })
```

重点提取纯文本，不保留复杂样式。

项目不需要还原 Word 版式，因为：

- 解析简历结构只需要文本。
- 最终输出使用统一 Markdown/PDF 模板。

### 23.3 旧版 DOC

旧 `.doc` 是二进制格式，Mammoth 不支持。项目明确拒绝，提示用户另存为 DOCX 或 PDF。

## 24. 文本规范化

处理步骤：

- 去 BOM。
- 去 NUL。
- CRLF -> LF。
- 去行尾空白。
- 合并三个以上换行。
- 去首尾空白。

这是后续正则和模型输入稳定性的基础。

## 25. 简历启发式解析

### 25.1 解析目标

不是 100% 恢复简历语义，而是：

- 找到头部信息。
- 切分 section。
- 提取 bullets。
- 识别时间。
- 提取技能和量化成果。

### 25.2 Section 解析

先识别 heading，再按 section 收集内容。

支持中英文常见标题。

### 25.3 Entry 解析

非 bullet 行当条目头，按分隔符拆 org/role/period。

bullet 行放到当前 entry。

### 25.4 局限

- 两栏模板可能顺序混乱。
- 自定义标题可能不识别。
- 项目字段和时间格式变化多。
- 教育条目格式差异大。
- 多行职位头可能拆错。

### 25.5 为什么保留 rawText

模型可以对照原文纠错。结构字段只是起点。

## 26. Markdown

### 26.1 为什么用 Markdown

- 模型容易生成。
- 人类可读。
- 可下载。
- 能稳定转 HTML。
- 适合作为 PDF 源格式。

### 26.2 项目模板结构

```markdown
# 姓名

职位 · 地点 · 邮箱

> 求职目标

## 个人简介

## 工作经历

### 公司 · 职位 · 时间

- 成果
```

### 26.3 GFM

GitHub Flavored Markdown 增加：

- 表格。
- 删除线。
- 任务列表。
- 自动链接。

前端通过 remark-gfm 支持。

PDF 的 marked 也开启 `gfm: true`。

## 27. marked

### 27.1 作用

```ts
marked.parse(markdown, {
  async: false,
  gfm: true,
});
```

把 Markdown 转 HTML 字符串。

### 27.2 为什么先生成 HTML

浏览器本身最擅长排版 HTML/CSS。把 HTML 交给 Chrome，比手写 PDF 坐标简单得多。

### 27.3 安全边界

marked 默认允许 Markdown 中的原始 HTML。项目没有对 PDF 输入做严格 sanitize。

因为输入主要来自模型和受控模板，风险有限，但不是零。若未来接收外部 Markdown，应增加 HTML sanitizer。

## 28. HTML 和 CSS 打印排版

### 28.1 HTML

生成完整文档：

```html
<!doctype html>
<html lang="zh-CN">
  <head>...</head>
  <body>...</body>
</html>
```

### 28.2 CSS

项目定义：

- 中文字体回退。
- 正文字号。
- 标题字号。
- 列表缩进。
- 表格边框。
- 引用样式。
- 分页规则。

### 28.3 打印媒体

虽然模板没有显式 `@media print`，但 Puppeteer `page.pdf()` 会按打印渲染。

项目使用：

```css
print-color-adjust: exact;
```

保留背景色。

### 28.4 分页控制

```css
h1, h2, h3 {
  page-break-after: avoid;
}

li, blockquote {
  page-break-inside: avoid;
}
```

避免标题孤立在页底、列表项被切开。

## 29. Puppeteer Core

### 29.1 Puppeteer 是什么

它通过 Chrome DevTools Protocol 控制 Chromium：

- 打开页面。
- 设置内容。
- 截图。
- 打印 PDF。

### 29.2 为什么用 puppeteer-core

普通 `puppeteer` 会下载 Chromium。`puppeteer-core` 不带浏览器，要求提供 executablePath。

项目使用本机 Edge/Chrome：

- 包更小。
- 直接使用系统中文字体。
- 避免再维护一个浏览器。

### 29.3 浏览器查找

正式 PDF 工具按顺序检查：

- `RESUME_BROWSER_PATH`。
- Windows Edge。
- Windows Chrome。
- Linux。
- macOS。

### 29.4 PDF 生成

```ts
await page.setContent(html, { waitUntil: "load" });
await page.pdf({
  path: outputPath,
  format: "A4",
  printBackground: true,
  margin: {...},
  displayHeaderFooter: true,
});
```

### 29.5 字体

项目不打包中文字体。依赖：

- Microsoft YaHei。
- PingFang。
- Noto Sans CJK。
- Source Han Sans。

系统缺少字体时 PDF 仍可能生成，但字形会回退。

### 29.6 资源清理

`finally` 保证 browser.close()。浏览器进程不关闭会积累内存。

## 30. 截图脚本

`preview.mjs` 也使用 Puppeteer：

- 打开 Web UI。
- 点击版本抽屉。
- 滚动到底。
- fullPage 截图。
- 渲染 Markdown 预览。

这是视觉回归和文档截图工具，不是产品运行链路。

## 31. OpenTelemetry

### 31.1 是什么

OpenTelemetry 是观测数据标准，包括：

- Traces。
- Metrics。
- Logs。
- Context propagation。

项目只使用 tracing。

### 31.2 核心概念

#### TracerProvider

负责创建 tracer、收集 span、交给 processor。

#### Span

一次操作的时间区间。

#### SpanProcessor

处理 span 的开始/结束和批量导出。

#### Exporter

把 span 发到后端。本项目由 Langfuse processor 内置 OTLP 导出。

#### Context propagation

让子 span 继承 trace id、session id、tags 等。

### 31.3 项目中的层级

```text
trace: resume-agent.turn
  generation: deepseek.chat
  tool span: tool:resume_parse
  tool span: tool:resume_rewrite
```

### 31.4 自动初始化

`ensureProcessor()` 创建：

```ts
new LangfuseSpanProcessor({...})
new NodeTracerProvider({
  spanProcessors: [processor],
})
provider.register()
```

只初始化一次。

当前源码直接 import 的是：

```ts
@opentelemetry/sdk-trace-node
```

但 `package.json` 直接声明的是 `@opentelemetry/sdk-node`。前者当前作为后者的传递依赖被提升安装，见 `npm ls`。从包管理规范看，直接使用的包应该显式写入 dependencies，避免未来依赖树变化或严格包管理器下无法解析。

### 31.5 属性传播

```ts
propagateAttributes({
  traceName: "resume-agent.turn",
  userId: "local-user",
  sessionId: conversationId,
  tags: [...],
  metadata: {...},
}, () => {
  root = startObservation(...);
});
```

回调中创建的 observation 继承属性。

### 31.6 Usage

Langfuse generation 的 usageDetails：

```text
input
output
total
cache_read_input_tokens
```

### 31.7 失败隔离

观测是旁路：

- 没配置 key -> no-op。
- 网络失败 -> swallow。
- flush 超过 2 秒 -> 不再等。

不会阻塞聊天主流程。

## 32. Langfuse

### 32.1 是什么

Langfuse 是 LLM 应用观测平台，展示：

- trace。
- generation。
- tool span。
- token usage。
- latency。
- error。
- session。

### 32.2 SDK 与平台版本

安装的是：

```text
@langfuse/otel 6.1.1
@langfuse/tracing 6.1.1
```

README 提到目标平台是 Langfuse v4 的 `events_only` 模式。

更准确的说法是：

```text
使用 6.x 客户端 SDK，通过 OTLP 向 Langfuse v4 服务写入
```

### 32.3 为什么从旧 ingestion 迁到 OTLP

v4 events_only 部署：

- `/api/public/ingestion` 只接收 score。
- trace/generation 不接受。
- 旧 SDK 可能显示成功但面板无数据。

OTLP 是新的 trace 写入通道。

### 32.4 OTLP

OpenTelemetry Protocol，常见 HTTP/JSON 或 protobuf。

项目 check 脚本发送：

```text
POST /api/public/otel/v1/traces
```

payload 是 `resourceSpans`。

### 32.5 Basic Auth

Langfuse public/secret key 组成：

```text
Basic base64(publicKey:secretKey)
```

### 32.6 当前观测粒度

优点：

- 每轮一条 trace。
- 模型、工具、usage、错误都有。

限制：

- 一轮只有一个 generation。
- 多 step 模型调用不会拆成多个 generation。
- 工具输出最多记 8000 字。

## 33. 异步编程

项目使用：

- Promise。
- async/await。
- Promise 链。
- Promise.race。
- AsyncGenerator。
- for await。
- EventEmitter 风格回调。

### 33.1 Promise 链做队列

```ts
const current = previous
  .catch(() => undefined)
  .then(() => execute(input));
```

比 mutex 简单，适合进程内串行。

### 33.2 Promise.race

```ts
await Promise.race([
  active.forceFlush(),
  new Promise(done => setTimeout(done, 2000)),
]);
```

达到“最多等待 2 秒”。

### 33.3 AsyncGenerator

`streamMessage()` 每解析出一个 SSE 事件就 `yield`。

调用方：

```ts
for await (const event of streamMessage(...)) {
  ...
}
```

这是处理流式数据非常自然的抽象。

### 33.4 并发边界

- 同一会话串行。
- 不同会话可并发。
- 文件写同步。
- 单个 DSH 进程。
- 多个请求可能同时读写 JSON 缓存。

当前没有分布式锁或数据库事务。

## 34. React

### 34.1 React 是什么

React 是声明式 UI 库。开发者描述“状态对应的页面”，React 负责计算 DOM 更新。

项目不手写：

```text
找到元素 -> 修改 innerHTML
```

而是：

```tsx
<MessageItem message={message} />
```

状态变化后组件重新调用并生成新 UI。

### 34.2 组件模型

项目组件：

- App：页面状态。
- Sidebar：会话列表。
- Hero：空状态。
- Composer：输入和上传。
- MessageItem：单条消息。
- ToolList：工具状态。
- ArtifactList：下载卡片。
- Markdown：Markdown 渲染。
- VersionsDrawer：版本抽屉。

组件是函数。参数叫 props。

### 34.3 TSX / JSX

```tsx
return <div className="app">...</div>;
```

JSX 不是 HTML，最终转换为 React element 创建调用。

`className` 代替 HTML 的 `class`。

`{expression}` 插入 JavaScript 值。

### 34.4 useState

例子：

```ts
const [active, setActive] =
  useState<Conversation | null>(null);
```

返回：

- 当前值。
- setter。

setter 触发重渲染。

函数式更新：

```ts
setActive(prev => ...)
```

避免闭包里的旧状态。

### 34.5 useEffect

用于同步外部系统：

- 初次加载 API。
- 滚动 DOM。
- 切换会话时拉版本。
- textarea 高度。
- 打字机定时器。

依赖数组决定何时重跑。

清理函数用于：

- 取消过期请求。
- 清 timer。

### 34.6 useRef

用途：

- 引用 DOM 元素。
- 保存不会触发渲染的值。

例子：

- `scrollRef`。
- `bootstrapped`。
- `shownRef`。

### 34.7 useCallback

稳定函数引用：

```ts
const refreshList = useCallback(async () => {...}, []);
```

避免 effect 因函数每次新建而重复执行。

### 34.8 StrictMode

开发模式会故意重复调用某些生命周期，帮助发现：

- 未清理 timer。
- 未取消请求。
- 重复初始化副作用。

项目用 `bootstrapped` 防止重复创建会话。

### 34.9 React 19

项目安装 React 19，但使用的主要是稳定基础 API：

- useState。
- useEffect。
- useRef。
- useCallback。
- createRoot。

没有使用 Server Components、React Compiler 或表单 action。

### 34.10 React 状态设计

核心状态：

```text
conversations  会话摘要列表
active         当前完整会话
draft          尚未保存的助手消息
busy           请求进行中
attachments    待发送附件
versions       当前会话版本
```

`draft` 是关键设计。它让流事件和已保存消息分开，避免在流式阶段反复修改持久化历史。

### 34.11 乐观更新

发送时先插入本地用户消息：

```text
local-<timestamp>
```

服务端 saved 后：

```text
删除 local 消息
插入正式 userMessage
插入 assistantMessage
```

这是常见的前端响应性优化。

## 35. React Markdown 和 remark-gfm

### 35.1 React Markdown

`react-markdown` 把 Markdown AST 渲染成 React 组件，不直接用 `dangerouslySetInnerHTML`。

优点：

- 可以覆盖链接、图片、代码等渲染。
- 默认不执行脚本。
- 与 React 状态模型一致。

### 35.2 remark-gfm

remark 是 Markdown 处理生态。GFM 插件增加 GitHub Markdown 扩展。

项目主要需要：

- 表格。
- 删除线。
- 任务列表。
- 自动链接。

### 35.3 自定义链接

模型可能输出：

```text
outputs/foo.md
```

组件把它们改写成：

```text
/api/outputs/foo.md
```

未知相对链接降级成纯文本，避免假链接。

### 35.4 为什么不用 innerHTML

Markdown 可能包含脚本或危险 HTML。React Markdown 更安全，也更容易限制链接。

PDF 渲染路径不经过 React Markdown，这是两套 Markdown 消费方式。

## 36. CSS

### 36.1 项目没有 CSS 框架

没有 Tailwind、CSS-in-JS、UI 组件库。样式全部手写在 `styles.css`。

好处：

- 依赖少。
- 样式集中。
- 容易定制。

代价：

- 全局命名空间。
- 大文件。
- 没有组件样式隔离。

### 36.2 CSS 变量

```css
:root {
  --bg: #f7f7f8;
  --ink: #1a1d21;
  --accent: #2563eb;
}
```

统一定义主题色，方便修改。

### 36.3 Flexbox

大量使用：

- topbar。
- 消息行。
- 工具条。
- artifact 卡片。
- composer 底部。
- drawer。

常用属性：

- `display: flex`。
- `align-items`。
- `justify-content`。
- `gap`。
- `flex: 1`。
- `min-width: 0`。

`min-width: 0` 是防止 flex 子项被长文本撑破的关键。

### 36.4 Grid

页面骨架：

```css
.app {
  display: grid;
  grid-template-columns: 264px 1fr;
}
```

Hero 卡片：

```css
grid-template-columns:
  repeat(auto-fit, minmax(220px, 1fr));
```

自动响应列数。

### 36.5 响应式设计

```css
@media (max-width: 860px) {
  .app {
    grid-template-columns: 1fr;
  }

  .sidebar {
    display: none;
  }
}
```

移动端隐藏侧栏。当前没有汉堡菜单。

### 36.6 动画

- blinking typing cursor。
- tool running pulse。
- drawer fade-in。
- drawer slide-in。
- hover translate。

动画只使用 CSS，不引入动画库。

### 36.7 backdrop-filter

topbar：

```css
backdrop-filter: blur(8px);
```

让底部内容模糊，是视觉增强。浏览器不支持时仍能显示半透明背景。

### 36.8 文本溢出

长标题和文件名使用：

```css
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;
```

避免布局被撑破。

### 36.9 无障碍现状

已有：

- 一些 aria-label。
- 原生 button。
- summary/details。

不足：

- 嵌套 button。
- drawer 没有 focus trap。
- drawer 没有 aria-modal。
- Esc 不能关闭。
- 移动端无会话导航。

## 37. 浏览器 Web API

### 37.1 Fetch

用于所有 API。

### 37.2 ReadableStream

```ts
response.body.getReader()
```

逐步读取 SSE 字节。

### 37.3 TextDecoder

处理跨 chunk 的 UTF-8。`stream: true` 保留未完成字符。

### 37.4 AbortController

把 signal 传给 fetch，可中止请求。当前创建了 controller，但没有 UI 取消入口。

### 37.5 File 和 FormData

文件 input 产生 `File`，上传时放进 `FormData`。

浏览器自动设置 multipart boundary。

### 37.6 Blob

测试脚本用 Blob 模拟上传文件。

### 37.7 download 属性

```html
<a download href="/api/outputs/a.pdf">
```

提示浏览器下载。

### 37.8 EventSource 与缺失

项目没有使用 EventSource，因为：

- 只能 GET。
- 当前需要 POST 消息 body。

## 38. Vite

### 38.1 Vite 是什么

前端开发服务器和构建工具。

开发时：

- 原生 ESM 按需加载。
- React 插件转换 JSX。
- HMR。
- 代理 API。

生产时：

- Rollup 打包。
- 生成带 hash 的静态资源。

### 38.2 项目配置

- root 指向 `web/`。
- React plugin。
- 5179 端口。
- strictPort。
- `/api` 代理到 5178。
- build 输出 `web/dist`。
- 每次 build 清空输出。

### 38.3 为什么端口分开

开发时：

```text
Vite 5179
Express 5178
```

浏览器访问 5179，Vite 把 API 转发到 5178。

生产时：

```text
Express 5178 同时提供 API 和 web/dist
```

不需要 Vite server。

## 39. esbuild

### 39.1 作用

MCP 工具服务被打成单文件：

```text
dist/mcp-server.mjs
```

### 39.2 为什么

DSH 启动 MCP 时直接：

```text
node dist/mcp-server.mjs
```

不需要：

- tsx loader。
- 逐文件解析 TypeScript。
- 项目内相对 import。

### 39.3 external mupdf

mupdf 含 WASM 资产，不内联。运行时仍从 node_modules 加载。

### 39.4 banner

注入 `createRequire()`，兼容依赖里的 CommonJS require。

## 40. tsx

### 40.1 tsx 是什么

基于 esbuild 的 TypeScript 执行器。

项目用于：

- `tsx watch server/src/index.ts`
- MCP 未构建时 `node --import tsx tools/src/mcp-server.ts`
- `npx tsx scripts/smoke-langfuse.ts`

### 40.2 与 tsc 的区别

- tsc：类型检查，不执行。
- tsx：去类型并执行，不做完整类型检查。

因此必须单独运行 `npm run typecheck`。

## 41. concurrently

```json
{
  "dev": "concurrently -k ... \"npm:dev:server\" \"npm:dev:web\""
}
```

作用：

- 并行运行两个 npm 脚本。
- 前缀区分日志。
- `-k` 在一个退出时杀掉另一个。

## 42. Vitest

### 42.1 是什么

基于 Vite 的测试运行器，API 类似 Jest：

- describe。
- it。
- expect。
- beforeAll。

### 42.2 当前配置

```ts
{
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
}
```

没有 jsdom，因此不测试 React 组件。

### 42.3 测试类型

当前是单元测试：

- 工具载荷编码解码。
- 简历解析。
- Markdown 渲染。
- patch YAML。
- 版本存储。

没有：

- 浏览器交互测试。
- DSH mock 集成测试。
- PDF 像素对比。
- Langfuse 自动断言。

### 42.4 临时目录

版本测试用：

```ts
mkdtempSync(join(tmpdir(), "resume-agent-"))
```

避免污染真实 data。

## 43. 冒烟测试

### 43.1 和单元测试的区别

单元测试：

- 快。
- 局部。
- 自动断言。

冒烟测试：

- 启动真实进程。
- 走真实 HTTP。
- 可能需要模型和浏览器。
- 主要靠日志人工判断。

### 43.2 脚本层次

#### MCP 直连

`smoke-mcp.mjs`

不需要模型，验证工具协议和文件处理。

#### 服务端对话

`smoke-chat.mjs`

需要 DSH 和模型，验证 SSE、工具、回复。

#### 版本链路

`smoke-versions.mjs`

验证上传、版本、PDF 关联。

#### 真实文件

`smoke-real-flow.mjs`

验证真实 PDF、诊断、改写、导出。

#### Langfuse

`smoke-langfuse.ts`

用假 OTLP 服务验证上报类型。

## 44. 安全模型

### 44.1 当前部署假设

```text
单用户
单机
127.0.0.1
无登录
无多租户
```

因此不是互联网生产安全架构。

### 44.2 上传限制

- 20MB。
- 一个文件。
- 扩展名白名单。
- UUID 磁盘名。
- 原始名只作为展示。

### 44.3 路径限制

#### resolve

规范化和绝对化。

#### basename

去掉目录。

#### startsWith(root + sep)

防止同前缀目录绕过。

#### sanitize

删除 Windows 非法字符。

### 44.4 工具白名单

patch 禁用：

- shell。
- file system。
- web。
- subagent。
- workflow。
- skill。

只保留三个 MCP 工具。

### 44.5 stdout 协议边界

MCP 工具 stdout 只能输出 JSON-RPC。日志必须 stderr。

### 44.6 HTML 安全

marked 可以输出原始 HTML。PDF 浏览器加载的是本地内容。

当前风险：

- 外部 Markdown 可能注入页面内容。
- 没有严格 sanitizer。

### 44.7 Prompt injection

简历和 JD 是不可信文本。系统没有专门检测恶意提示。

缓解：

- 只暴露有限工具。
- 工具路径受控。
- 工具不能执行 shell。

未解决：

- 模型可能被诱导生成错误内容。
- 模型可能调用 rewrite 多次。
- 模型可能遗漏原文事实。

### 44.8 本地数据

以下内容未加密：

- 对话正文。
- 附件预览。
- 工具输出。
- 简历版本。
- 上传原件。

任何能读项目目录的本地进程都能读取。

### 44.9 符号链接

工具路径检查是词法级的，不解 realpath。工作区内指向外部的符号链接可能绕过。

### 44.10 并发与文件锁

JSON 存储没有跨进程锁。多实例运行会互相覆盖。

## 45. 依赖逐项职责

### 45.1 运行时依赖

| 包 | 职责 |
|---|---|
| `@deepseek-ai/dsh-sdk-client` | 驱动 DSH 子进程、session、事件 |
| `@langfuse/otel` | Langfuse span processor |
| `@langfuse/tracing` | trace/span/generation API |
| `@modelcontextprotocol/sdk` | MCP server 和 stdio transport |
| `@opentelemetry/api` | OTel 标准 API 和 diag |
| `@opentelemetry/sdk-node` | Node tracer provider |
| `@opentelemetry/sdk-trace-node` | 源码直接使用的 tracer provider，当前为传递依赖 |
| `express` | HTTP 服务和路由 |
| `mammoth` | DOCX 纯文本抽取 |
| `marked` | Markdown 转 HTML |
| `multer` | multipart 上传 |
| `mupdf` | PDF 首选文本抽取 |
| `puppeteer-core` | 控制本机 Chrome/Edge |
| `unpdf` | PDF 回退抽取 |
| `zod` | 运行时 schema 和 MCP 输入验证 |

### 45.2 开发依赖

| 包 | 职责 |
|---|---|
| `@types/*` | TypeScript 类型声明 |
| `@vitejs/plugin-react` | Vite React 转换 |
| `concurrently` | 并行启动开发服务 |
| `esbuild` | MCP 单文件构建 |
| `react` | 前端组件模型 |
| `react-dom` | 浏览器渲染 |
| `react-markdown` | Markdown 转 React |
| `remark-gfm` | GFM 扩展 |
| `tsx` | 直接运行 TypeScript |
| `typescript` | 类型检查 |
| `vite` | 前端开发和生产构建 |
| `vitest` | 单元测试 |

## 46. 为什么选择这些技术

### Express 而不是 Fastify/Nest

项目是小型单体：

- 路由少。
- 中间件简单。
- SSE 直接写 response。
- 不需要依赖注入和分层框架。

Express 足够。

### JSON 而不是 SQLite/Postgres

单用户 MVP：

- 无部署数据库。
- 数据易检查。
- 易备份。

代价是并发和查询能力弱。

### SSE 而不是 WebSocket

需求是服务器单向推送。WebSocket 双向能力用不上。

### React 而不是 Vue/Svelte

生态成熟，Markdown 和 hooks 适配直接。项目作者熟悉 React 也是合理因素。

### MCP 而不是内置函数

工具独立进程：

- 协议清晰。
- 权限隔离。
- 可替换实现。
- 与 DSH 解耦。

### DSH 而不是直接模型 SDK

避免自己实现 Agent loop、session、tools、events 和 usage。

### Langfuse + OTel 而不是自建日志

直接获得：

- UI。
- trace 层级。
- token usage。
- session 搜索。
- 错误状态。

### Chrome 打印而不是 PDF 库

HTML/CSS 排版快，中文字体直接复用系统资源。代价是依赖浏览器。

## 47. 技术风险总表

| 风险 | 当前状态 |
|---|---|
| 多实例写 JSON | 不支持 |
| OCR | 不支持 |
| DOCX 导出 | 不支持 |
| 中断 Agent | 不支持 |
| 移动端导航 | 不完整 |
| 多 step Langfuse generation | 当前只记一个 |
| PDF 浏览器依赖 | 必须本机安装 |
| PDF 字体 | 依赖系统字体 |
| Prompt injection | 仅有限能力隔离 |
| 路径符号链接 | 未 realpath |
| HTML sanitize | 未严格处理 |
| 认证授权 | 无 |
| 文件级事务 | 无 |
| 附件失效提示 | 静默过滤 |
| 删除会话级联 | 不完整 |

## 48. 推荐学习路线

如果目标是读懂并改这个项目，按下面顺序学。

### 第一层：语言

1. JavaScript 对象、数组、Promise。
2. async/await。
3. ESM import/export。
4. TypeScript interface、union、unknown、泛型基础。

### 第二层：Node

1. fs 和 path。
2. Buffer 和 TextDecoder。
3. HTTP 基础。
4. child_process 和 stdio。
5. 环境变量和信号。

### 第三层：后端

1. Express Router。
2. middleware。
3. Multer。
4. SSE。
5. JSON 持久化。

### 第四层：Agent

1. LLM token、context、tool calling。
2. JSON-RPC。
3. DSH session 和 turn。
4. MCP tool。
5. Zod schema。
6. prompt 设计。

### 第五层：文档

1. PDF 结构。
2. mupdf/unpdf。
3. DOCX/Mammoth。
4. Markdown。
5. marked。
6. Puppeteer PDF。

### 第六层：前端

1. React 组件和 props。
2. useState/useEffect/useRef。
3. Fetch 和 ReadableStream。
4. AsyncGenerator。
5. CSS Flex/Grid。

### 第七层：工程

1. npm scripts。
2. tsc/tsx/esbuild/Vite 区别。
3. Vitest。
4. OTel/Langfuse。
5. 安全边界。

## 49. 面试式总结

可以这样概括项目：

> 这是一个 TypeScript 单机 Web MVP。React 前端通过 POST 和手工 SSE 解析与服务端通信。Express 负责会话、附件和版本持久化，并通过 DSH SDK 启动 DeepSeek Harness 子进程。DSH 负责模型循环，ResumeAgent 通过运行时 YAML patch 注入招聘顾问人设，并只暴露一个 stdio MCP server。MCP 工具负责 PDF/DOCX/Markdown 文本抽取、启发式结构化、Markdown 模板落盘和 Chrome 无头 PDF 渲染。服务端把 DSH 事件标准化为 UI 事件，把工具产物登记为简历版本，并使用 OpenTelemetry 向 Langfuse 发送 trace、generation、tool span 和 token usage。

## 50. 最后要记住的边界

- TypeScript 不验证运行时数据。
- JSON 不是数据库。
- SSE 不是双向通信。
- UI 打字机不是模型实时 token。
- MCP 工具不是模型本体。
- DSH session 不是 ResumeAgent conversation。
- Langfuse SDK 版本不等于 Langfuse 平台版本。
- PDF 文本抽取不是 OCR。
- HTML 渲染不是绝对安全。
- 能运行不等于能多用户部署。

## 51. 技术到源码索引

| 技术 | 主要源码 |
|---|---|
| TypeScript | 全仓库 |
| ESM / top-level await | `server/src/**`、`tools/src/**`、`scripts/**` |
| Node fs/path/crypto | `server/src/store.ts`、`attachments.ts`、`tools/src/workspace.ts` |
| Electron as Node | `server/src/agent/runtime.ts` |
| Express | `server/src/index.ts`、`server/src/routes/*` |
| Multer | `server/src/routes/files.ts` |
| SSE | `server/src/routes/chat.ts`、`web/src/api.ts` |
| REST | `server/src/routes/chat.ts`、`files.ts` |
| DSH SDK | `server/src/agent/runtime.ts` |
| DSH profile patch | `server/src/agent/patch.ts` |
| JSON-RPC / stdio | DSH SDK、`tools/src/mcp-server.ts`、`scripts/smoke-mcp.mjs` |
| MCP SDK | `tools/src/mcp-server.ts` |
| Zod | `tools/src/mcp-server.ts` |
| YAML | `server/src/agent/patch.ts` |
| Prompt engineering | `server/src/agent/persona.ts` |
| mupdf | `shared/extract.ts` |
| unpdf | `shared/extract.ts` |
| Mammoth | `shared/extract.ts` |
| Markdown 模板 | `tools/src/resume.ts` |
| marked | `tools/src/pdf.ts` |
| HTML/CSS 打印 | `tools/src/pdf.ts` |
| Puppeteer Core | `tools/src/pdf.ts`、`scripts/preview.mjs` |
| JSON 持久化 | `server/src/store.ts`、`attachments.ts`、`resumes.ts` |
| UUID | `store.ts`、`attachments.ts`、`resumes.ts`、`files.ts` |
| OpenTelemetry | `server/src/obs/langfuse.ts` |
| Langfuse | `server/src/obs/langfuse.ts`、`scripts/check-langfuse.mjs` |
| React | `web/src/App.tsx`、`components.tsx`、`main.tsx` |
| React Markdown | `web/src/components.tsx` |
| remark-gfm | `web/src/components.tsx` |
| Fetch / Streams | `web/src/api.ts`、`App.tsx` |
| CSS | `web/src/styles.css` |
| Vite | `web/vite.config.ts` |
| tsx | `package.json`、`server/src/agent/mcp-launch.ts` |
| esbuild | `scripts/build-mcp.mjs` |
| Vitest | `tests/**`、`vitest.config.ts` |
| concurrently | `package.json` |

## 52. 技术自测

### 语言

- TypeScript 的 `interface` 会生成运行时对象吗？
- `unknown` 和 `any` 的区别是什么？
- ESM 下 `require` 默认为什么不能用？

### Node

- `readFileSync` 为什么会阻塞事件循环？
- `process.execPath` 为什么比 `"node"` 更可靠？
- stdin、stdout、stderr 在 MCP 中分别承担什么？

### HTTP

- `fetch` 遇到 HTTP 404 会自动抛错吗？
- SSE 为什么不能直接使用 EventSource 发 POST？
- 为什么 SSE 已经返回 200 后不能改 500？

### Agent

- turn 和 step 的区别是什么？
- DSH session 与 Conversation 为什么必须分开？
- 为什么服务重启后要 resume？

### MCP

- 为什么工具 stdout 不能写日志？
- Zod 在 MCP 中解决什么问题？
- `isError: true` 和 JSON payload 的 `ok: false` 分别表示什么？

### 文档

- mupdf 为什么优先于 pdfjs？
- 为什么 PDF 文本块要按 y/x 重排？
- 扫描 PDF 为什么无法解析？
- Puppeteer Core 与 Puppeteer 的区别是什么？

### 观测

- trace、span、generation 分别是什么？
- 为什么 v4 events_only 要使用 OTLP？
- 为什么 flush 要加超时？

### 前端

- `useState` 为什么可能读到旧闭包？
- `TextDecoder` 为什么需要 `stream: true`？
- Stream 事件为什么不能用简单的 split 处理？
- React Markdown 与 marked 在项目里分别服务谁？

### 工程

- tsc、tsx、esbuild、Vite 各自负责什么？
- 为什么 Vitest 使用 Node 环境而不是 jsdom？
- 为什么 JSON 存储不适合多实例？
