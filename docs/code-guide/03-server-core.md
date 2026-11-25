# 03 - 服务端基础层

这一章覆盖服务端启动、配置和持久化：

| 文件 | 行号 |
|---|---|
| `server/src/env.ts` | 1-31 |
| `server/src/config.ts` | 1-57 |
| `server/src/index.ts` | 1-66 |
| `server/src/store.ts` | 1-113 |
| `server/src/attachments.ts` | 1-62 |
| `server/src/resumes.ts` | 1-144 |

读完这一章，你应该知道服务启动时创建哪些目录、每个 JSON 文件如何读写，以及为什么有些内部字段不会暴露给浏览器。

## 1. server/src/env.ts

### 行 1-2：依赖

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
```

- `existsSync` 检查 `.env` 是否存在。
- `readFileSync` 一次读完整文件。
- `resolve(process.cwd(), ".env")` 以启动命令的当前工作目录为基准。

这意味着：

```bash
cd D:\projects\resume-agent
npm run dev:server
```

会读取项目根目录的 `.env`。如果你从别的目录直接运行入口文件，就不会读到这里期望的文件。

### 行 4-10：为什么自己解析 .env

Node 自带的环境文件读取没有处理好带 BOM 的 Windows 文件。BOM 会让第一个键名变成：

```text
\uFEFFLANGFUSE_PUBLIC_KEY
```

代码看起来配置了 key，实际 `process.env.LANGFUSE_PUBLIC_KEY` 仍然是空。自己解析可以明确去掉 BOM。

注释还强调入口 import 顺序：`server/src/index.ts` 的第一行必须是 `import "./env";`。ESM 会按静态 import 的声明顺序执行模块副作用。env 模块必须先执行，后面 `config.ts` 读 `process.env` 才能看到值。

### 行 11：envPath

```ts
const envPath = resolve(process.cwd(), ".env");
```

这是绝对路径。`process.cwd()` 不是入口文件目录，而是进程启动目录。

### 行 13-14：读取与去 BOM

```ts
if (existsSync(envPath)) {
  const raw = readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
```

- `utf8` 必须明确，否则可能按系统编码读取。
- 只替换字符串开头的 BOM。

### 行 15-19：逐行扫描

```ts
for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) continue;
  const separator = trimmed.indexOf("=");
  if (separator <= 0) continue;
```

规则：

- 空行跳过。
- `#` 开头的行跳过。
- 没有等号或等号在第一位时跳过。
- `KEY=value` 的 key 必须有内容。

这个解析器故意保持简单。它不支持：

- `export KEY=value`
- 多行引号值
- 转义序列
- shell 变量展开

对于本项目的配置已经够用。

### 行 20-21：拆 key 和 value

```ts
const key = trimmed.slice(0, separator).trim();
let value = trimmed.slice(separator + 1).trim();
```

值里的第一个等号之后内容都保留，所以：

```text
DSH_LAUNCH_COMMAND=C:\path\a=b.exe
```

也能保留 `=`。

### 行 22-27：去引号

只处理完整包裹的成对单引号或双引号。

```text
KEY="abc"   -> abc
KEY='abc'   -> abc
KEY="a'b"   -> a'b
```

不做转义处理，因此值中如果包含与边界相同的引号，需要谨慎。

### 行 28-30：真实环境变量优先

```ts
if (process.env[key] === undefined) process.env[key] = value;
```

优先级：

```text
系统/终端环境变量 > .env 文件
```

这让临时覆盖很方便：

```powershell
$env:PORT=5180; npm run dev:server
```

即使 `.env` 写了 `PORT=5178`，仍是 5180。

## 2. server/src/config.ts

### 行 1-3：路径与 URL 工具

```ts
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
```

- `existsSync` 判断目录。
- `mkdirSync({ recursive: true })` 创建多级目录，已存在时不报错。
- `fileURLToPath` 把 `file:///...` URL 转成本地路径。
- `dirname` 从文件路径取父目录，文件末尾重新导出了它，供其他模块使用。

### 行 5-6：仓库根目录

```ts
export const ROOT = resolve(
  fileURLToPath(new URL("../..", import.meta.url))
);
```

`import.meta.url` 是当前模块的文件 URL：

```text
file:///D:/projects/resume-agent/server/src/config.ts
```

`new URL("../..", import.meta.url)` 从 `server/src/config.ts` 往上两级：

```text
server/src/config.ts
  .. -> server/src/
  ../.. -> repo root
```

这比 `process.cwd()` 稳定。无论从哪个目录启动，ROOT 都指向仓库。

### 行 7-10：数据目录

```ts
export const WORKSPACE_DIR =
  process.env.RESUME_WORKSPACE ?? resolve(ROOT, "workspace");
export const UPLOAD_DIR = resolve(WORKSPACE_DIR, "uploads");
export const OUTPUT_DIR = resolve(WORKSPACE_DIR, "outputs");
export const DATA_DIR =
  process.env.RESUME_DATA_DIR ?? resolve(ROOT, "data");
```

默认结构：

```text
repo/
  workspace/
    uploads/
    outputs/
  data/
```

`RESUME_WORKSPACE` 可以整体移动工作区。`RESUME_DATA_DIR` 主要给测试使用，让测试写到临时目录。

注意 `UPLOAD_DIR` 和 `OUTPUT_DIR` 不能单独通过环境变量覆盖，它们始终基于 WORKSPACE。

### 行 12-13：网络监听

```ts
export const PORT = Number(process.env.PORT ?? 5178);
export const HOST = process.env.HOST ?? "127.0.0.1";
```

`Number()` 是宽松转换：

- 空字符串会变成 0。
- 非数字会变成 `NaN`。

这里没有额外校验。`app.listen(NaN)` 会产生运行错误。

默认 `127.0.0.1` 只接受本机连接，这是 MVP 的安全选择。

### 行 15-35：DSH 配置

```ts
export const DSH = {
  command: ...,
  cliPath: ...,
  profile: ...,
  patchDir: ...,
  mcpServer: ...,
  provider: ...,
  model: ...,
  maxTokens: ...,
  home: ...,
};
```

字段逐个解释：

- `command`：启动 DSH 的可执行文件。默认指向 Windows 桌面版。
- `cliPath`：桌面版 asar 内的 DSH CLI 入口。
- `profile`：加载 `sdk` profile。注释强调不能误用 `DSH_PROFILE`，那是桌面宿主自己的变量。
- `patchDir`：启动时生成的 YAML 补丁放到 `.runtime`。
- `mcpServer`：补丁里会引用的 MCP 打包文件路径。
- `provider`：模型供应方路由。
- `model`：模型名。
- `maxTokens`：单次模型输出上限。
- `home`：DSH 自己的会话存储目录，可选。

`DSH.mcpServer` 在 `runtimeInfo()` 里可以展示，但真正启动 MCP 时 `mcp-launch.ts` 会优先检查这个文件是否存在。

### 行 37-41：Langfuse 配置

```ts
publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? "",
secretKey: process.env.LANGFUSE_SECRET_KEY ?? "",
baseUrl: process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com",
```

两个 key 都非空才启用观测。baseUrl 允许自托管地址。

### 行 43-47：ensureDirs

```ts
for (const dir of [WORKSPACE_DIR, UPLOAD_DIR, OUTPUT_DIR, DATA_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
```

为什么先判断再创建：

- 避免频繁调用 mkdir。
- 但 `recursive: true` 本身也能处理已存在，所以这不是严格必需。

这个函数在服务入口、存储层和上传层都会调用，保证模块单独使用时目录也存在。

### 行 49-55：assertRuntimeConfigured

只检查 `DSH.command` 文件存在。

它没有检查：

- `DSH.cliPath` 是否存在。
- Node 是否能运行桌面版。
- 模型凭据是否有效。

因此这个函数只能挡住最明显的配置错误。当前 `index.ts` 也没有调用它，运行时缺失错误会在第一次对话时暴露。

### 行 57：重新导出 dirname

```ts
export { dirname };
```

有些模块可能想从 config 统一拿路径工具。这是一个小范围的便利导出，不是核心行为。

## 3. server/src/index.ts

### 行 1-9：入口 imports

第一行必须是：

```ts
import "./env";
```

之后才导入 config 和路由。后面的模块在模块初始化时读环境变量，所以顺序很重要。

导入内容：

- Express。
- 文件存在检查。
- 路径 join。
- 服务配置。
- 运行时关闭函数。
- Langfuse 探活。
- 两个 Router。

### 行 11-18：入口注释和目录

服务负责：

- 会话 API。
- 文件 API。
- 生产静态页面。

`ensureDirs()` 在任何请求之前执行。

### 行 20-22：Express 基础配置

```ts
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
```

- 关闭 `X-Powered-By: Express`，减少无意义的指纹。
- 解析 JSON body，例如发消息接口。
- 2MB 限制只作用于 JSON，不作用于 multipart 上传；上传限制在 multer。

### 行 24-25：挂载路由

```ts
app.use("/api", chatRouter);
app.use("/api", filesRouter);
```

两个 Router 都挂在 `/api` 下。它们各自声明完整子路径。

顺序重要。例如两者都有处理冲突时，先注册的 Router 会先处理。

### 行 27-29：简化健康检查

```ts
app.get("/api/health", ...)
```

这里返回 `{ ok: true }`。

但 `chatRouter` 已经注册了 `GET /health`，而它先挂载，因此正常请求实际命中的是 `routes/chat.ts` 里的增强版健康检查。这里是冗余兜底，当前几乎不可达。

### 行 31-41：生产静态资源

```ts
const webDist = join(ROOT, "web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist, { index: false }));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) {
      next();
      return;
    }
    response.sendFile(join(webDist, "index.html"));
  });
}
```

行为：

- `existsSync`：前端没构建时跳过。
- `express.static` 提供 JS、CSS、图片。
- `index: false` 禁止访问 `/` 时自动发送 index.html。
- 后续 SPA fallback 手动发送 index.html。

为什么 SPA fallback 要排除 API：

```text
/api/不存在
```

如果不排除，会返回 HTML 页面而不是 404 JSON，前端难以处理。

为什么只允许 GET：

```text
POST /某个前端路由
```

不应该被当成页面访问。

### 行 43-48：统一错误处理

Express 5 用四参数函数识别错误中间件：

```ts
(error, request, response, next)
```

这里：

- 把未知值转成字符串。
- 打完整错误到服务端日志。
- 如果响应头和 body 已经开始发送，则不能再写 JSON，直接返回。
- 否则发送 500。

SSE 请求中如果已经 `writeHead(200)` 再抛错，`headersSent` 为 true，错误处理不会破坏 SSE；真正的错误会通过 SSE 的 `ui error` 事件发送。

### 行 50-56：启动监听

```ts
const server = app.listen(PORT, HOST, () => { ... });
```

回调里：

- 打印监听地址。
- 如果没构建前端，提示开 Vite。
- 异步探活 Langfuse。

`void verifyLangfuse()` 表示不等待、不把 rejection 传播到启动流程。`verifyLangfuse` 内部捕获错误，所以不会产生未处理 rejection。

### 行 58-66：优雅关闭

```ts
async function shutdown(signal) {
  console.log(...);
  server.close();
  await closeRuntime();
  process.exit(0);
}
```

顺序：

1. 停止接受新 HTTP 连接。
2. 关闭 DSH 子进程。
3. 退出进程。

`server.close()` 不会等待回调返回，这里没有等待现有连接完全结束。`closeRuntime()` 是主要的清理步骤。

只监听一次 `SIGINT` 和 `SIGTERM`，避免重复关闭。

## 4. server/src/store.ts

这个文件管理 `data/conversations.json`。

### 行 1-5：依赖

- `readFileSync`、`writeFileSync`、`renameSync`。
- `randomUUID`。
- `join`。
- 配置和共享类型。

同步 JSON 写入在单用户 MVP 中可以接受。多实例部署时会出现文件竞争。

### 行 7-12：路径和设计说明

```ts
const STORE_PATH = join(DATA_DIR, "conversations.json");
```

消息历史留在服务端。DSH 侧只通过 `dshSessionId` 保存模型上下文。

### 行 14-19：StoreShape 和缓存

```ts
interface StoreShape {
  version: 1;
  conversations: Conversation[];
}

let cache: StoreShape | null = null;
```

`cache` 是进程内单例。第一次读取后，后续请求不再读磁盘。

这带来两个结果：

- 读取很快。
- 外部编辑器修改 JSON 后，正在运行的服务不会看到，除非重启。

### 行 21-35：load

流程：

1. 缓存存在直接返回。
2. 确保目录存在。
3. 文件不存在，创建空结构并缓存。
4. 文件存在，读取并解析。
5. 只信任 `parsed.conversations` 是数组。
6. 任何解析错误都退化为空列表。

注意第 30 行只检查 conversations 数组，不检查每个元素字段：

```ts
cache = {
  version: 1,
  conversations: Array.isArray(parsed.conversations)
    ? parsed.conversations
    : [],
};
```

损坏文件会被静默替换成空缓存，下一次 persist 可能覆盖原文件。当前没有备份策略。

### 行 37-43：persist

```ts
const temp = `${STORE_PATH}.tmp`;
writeFileSync(temp, JSON.stringify(cache, null, 2), "utf8");
renameSync(temp, STORE_PATH);
```

这是原子替换的常见做法：

- 写临时文件时，旧文件仍完整。
- 写完再 rename。
- 同一文件系统上的 rename 通常是原子操作。

没有调用 `fsync`，因此突然断电时仍有极小概率丢失最后写入，但比直接覆盖安全。

### 行 45-47：listConversations

```ts
return [...load().conversations]
  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
```

先复制数组再排序，避免修改缓存里的原始顺序。

ISO 8601 字符串可按字典序比较时间，因此 `localeCompare` 能正确倒序。这里使用 localeCompare 而不是数字减法，因为字段是字符串。

### 行 49-51：getConversation

线性查找。会话数量少时足够，没有索引。

### 行 53-66：createConversation

```ts
id: randomUUID(),
dshSessionId: `session-${randomUUID().replaceAll("-", "")}`,
```

两个 id 分开生成：

- 本地 id 保留 UUID 连字符。
- DSH id 加 `session-` 前缀并去掉连字符。

新会话在内存中 push 后立即 persist。

### 行 68-75：deleteConversation

找到下标后 splice。

返回 boolean：

- 找不到返回 false。
- 删除成功返回 true。

删除范围仅限 conversations.json。附件、版本和 DSH 会话都不会被清理。

### 行 77-86：appendMessage

```ts
conversation.messages.push(message);
conversation.updatedAt = new Date().toISOString();
```

如果标题仍是默认值且这是用户消息，则自动生成标题。

这里没有限制 `message.role`。调用方负责消息结构。

### 行 88-99：updateMessage

```ts
Object.assign(message, patch);
```

浅合并。可更新任意 `ChatMessage` 字段。

如果 messageId 不存在，函数静默返回，不抛错。当前主流程实际上更常用 `appendMessage`，这个函数留给未来增量更新。

### 行 101-107：requireConversation

找不到时抛 `Error`。

错误信息包含 id。路由层通常先 `getConversation` 返回 404，因此不会依赖这个抛错来生成 HTTP 响应。

### 行 109-113：titleFrom

```ts
const clean = text.replace(/\s+/g, " ").trim();
```

把连续空白压成一个空格。

标题规则：

- 空字符串保持“新的对话”。
- 不超过 24 字原样使用。
- 超过 24 字截断并加省略号。

## 5. server/src/attachments.ts

### 行 1-4：依赖

使用 Map 在内存中索引附件，持久化时转成数组。

### 行 6-9：设计说明

浏览器上传时只知道临时文件名。服务端生成稳定 `attachmentId`，后续消息只传 id。

### 行 11-16：StoredAttachment 和缓存

```ts
export interface StoredAttachment extends Attachment {
  path: string;
}
```

扩展了共享 Attachment，额外存绝对路径。

`Map<string, StoredAttachment>` 的键是附件 id，查找是 O(1)。

### 行 18-31：load

流程：

1. 建空 Map。
2. 文件存在则解析 `{ attachments: [] }`。
3. 逐项 set。
4. 解析失败只保留空 Map。

注释“损坏的索引不影响新上传”体现了容错策略。代价是旧附件记录会一起丢失。

### 行 33-39：persist

```ts
JSON.stringify({ attachments: [...cache.values()] }, null, 2)
```

Map 不能直接 JSON.stringify 成期望结构，因此先取 values 再展开为数组。

### 行 41-44：saveAttachment

调用方必须先构造完整 `StoredAttachment`。函数只负责写 Map 和持久化。

### 行 46-48：getAttachment

直接返回内部对象，调用方可以修改它而不再次 persist。当前没有调用方修改。

### 行 50-57：resolveAttachments

对每个 id：

- 查得到。
- 文件仍存在。

才放入结果。

不存在的 id 静默丢弃，不抛错。这个设计让过期附件不会阻断消息，但也让前端很难知道某个附件为什么消失。

### 行 59-62：publicView

```ts
const { path: _path, ...rest } = attachment;
return rest;
```

用剩余对象去掉 path。

这是 JS 的对象解构：

- `path: _path` 把 path 绑定到变量 `_path`。
- `...rest` 收集其余字段。
- 返回 rest。

不会修改原对象。

## 6. server/src/resumes.ts

这个文件管理 `data/resumes.json` 和简历版本语义。

### 行 1-5：依赖

`basename` 用于公开下载地址。版本内部保存绝对路径，但不能把绝对路径直接给浏览器。

### 行 7-12：设计说明

一个会话有：

- 一个或多个原始版本。
- 零个或多个优化版本。
- 优化版本可能关联一个 PDF。

注意代码实际允许同一会话上传多份“原始简历”。UI 标签相同，但 id 不同。

### 行 14-27：StoredVersion

与公开 `ResumeVersion` 的差别：

- 这是内部形状。
- 多了 `path` 和 `pdfPath`。
- 没有 `downloadUrl`、`pdfUrl`，这些在公开转换时生成。

### 行 29-35：StoreShape

```ts
conversations: Record<string, StoredVersion[]>
```

外层键是 ResumeAgent 的 conversation id。值是该会话的版本数组。

### 行 37-54：load

与 conversations 存储类似。

这里额外检查：

```ts
typeof parsed.conversations === "object"
  && parsed.conversations !== null
```

但没有检查它是否不是数组，也没有逐条校验版本字段。

### 行 56-62：persist

临时文件加 rename，同其他 JSON 存储。

### 行 64-69：bucket

```ts
store.conversations[key] ??= [];
return store.conversations[key];
```

`??=` 是逻辑空赋值：

- 左边是 null 或 undefined 时赋值为右边。
- 否则保留原值。

它会在写操作时创建会话 bucket，但不会马上 persist。真正持久化由 add/attach 完成。

### 行 71-73：listVersions

```ts
return [...(load().conversations[conversationId] ?? [])];
```

返回浅拷贝数组。调用方 push/splice 不会改缓存数组，但元素对象仍然共享。

### 行 75-94：addOriginal

```ts
const version = {
  id: randomUUID(),
  kind: "original",
  label: "原始简历",
  ...
  ...(input.needsOcr === true ? { needsOcr: true } : {}),
};
items.unshift(version);
persist();
```

关键点：

- 原始版本使用 `unshift`，最新上传排在前面。
- needsOcr 只在严格为 true 时写入。
- version id 是随机 UUID。
- createdAt 是服务器当前时间。

### 行 96-115：addOptimized

```ts
const count =
  items.filter((item) => item.kind === "optimized").length + 1;
```

编号是“当前优化版数量 + 1”。

这依赖数组不删除优化版。如果未来支持删除版本，编号可能出现重复或跳号。

优化版使用 push，按生成时间从旧到新排列。

### 行 117-124：attachPdf

```ts
const target = [...items]
  .reverse()
  .find(
    (item) =>
      item.kind === "optimized" &&
      item.pdfPath === undefined
  );
```

先复制再反转，避免修改原数组。

查找条件：

- 优化版。
- 还没有 PDF。

从数组尾部往前找，因此优先挂到最新一个未挂 PDF 的优化版。

潜在语义问题：

- 如果先生成 v1 和 v2。
- 再只为 v1 的 Markdown 生成 PDF。
- 当前逻辑会挂到 v2，因为 v2 也是“未挂 PDF 的最新优化版”。

这是文件名没有严格配对带来的限制，读代码时不要误以为它根据 Markdown 路径匹配。

### 行 126-144：publicVersions

```ts
listVersions(conversationId).map((item) => ({
  ...
  downloadUrl:
    item.kind === "original"
      ? `/api/uploads/${encodeURIComponent(basename(item.path))}`
      : `/api/outputs/${encodeURIComponent(basename(item.path))}`,
  ...
}))
```

转换规则：

- 原始版下载走 `/api/uploads/`。
- 优化版下载走 `/api/outputs/`。
- 都用 `basename`，只暴露文件名。
- `encodeURIComponent` 处理中文、空格和特殊字符。
- 有 `pdfPath` 才增加 `pdfUrl`。
- needsOcr 只在 true 时保留。

这里返回的是新对象，不泄露内部路径字段。

## 7. 这一层的关键不变量

### 会话 id 与 DSH id 分离

```text
Conversation.id      本地路由和 JSON 主键
dshSessionId         DSH 上下文主键
```

任何修改恢复逻辑时，不能把两者混用。

### 内存缓存是权威状态

服务运行期间修改 JSON 文件不会自动反哺内存缓存。所有写入应通过导出的函数。

### 公开对象必须去掉路径

`publicView()` 和 `publicVersions()` 是两道数据脱敏边界。

### 三份存储没有事务

上传时会同时写 attachments.json 和 resumes.json。如果第二步失败，可能出现附件存在但版本不存在，或反过来。单用户 MVP 没有跨文件事务。

## 8. 本章完成后应能回答

- `.env` 和真实环境变量谁优先？
- ROOT 为什么比 process.cwd 稳定？
- 为什么 `server/src/index.ts` 的第一行不能随便调整？
- `server.close()` 和 `closeRuntime()` 分别关闭什么？
- conversations、attachments、resumes 三份 JSON 各自负责什么？
- 为什么 `publicVersions()` 不直接返回 StoredVersion？
- `attachPdf()` 的“最近优化版”具体按什么顺序找？
