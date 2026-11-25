# 08 - 测试、脚本与构建配置

这一章覆盖仓库的可运行外围：

- 单元测试。
- 构建脚本。
- 冒烟脚本。
- TypeScript、Vite、Vitest 配置。
- 环境变量样例。

自动生成的 `package-lock.json`、`dist/mcp-server.mjs`、`web/dist/**` 不逐行解释。

## 1. tests/tools.test.ts

### 行 1-8：测试准备

```ts
const sample = readFileSync(
  resolve("fixtures/resume.sample.md"),
  "utf8",
);
```

依赖当前工作目录是仓库根目录。Vitest 通常在根目录运行。

### 行 10-38：parseResumeText

#### 行 10-11

在 describe 回调里先解析一次 sample，四个测试共享只读 profile。

#### 行 13-17：基本信息

断言：

- 姓名 `张晨`
- 邮箱
- 地点 `上海`

#### 行 19-25：经历

断言至少两条经历，并检查第一条：

- org 包含公司名。
- period 包含开始时间。
- period 包含“至今”。

#### 行 27-32：技能和量化成果

检查 React、TypeScript 技能，以及含 `3.2s` 的成果。

#### 行 34-37：统计

字符数大于 500，bullet 至少 6 条。

### 行 40-49：renderResumeMarkdown

解析 sample，带 headline 渲染，断言：

- 一级标题。
- 工作经历标题。
- 专业技能标题。
- 求职目标引用。

### 行 51-68：tool payload

测试 1 编码后解码：

- ok
- summary
- artifacts

测试 2 普通文本返回 null。

### 行 70-86：buildPatchYaml

构造：

```ts
{
  filePath: "x.yml",
  mcpCommand: "C:\\node.exe",
  mcpArgs: ["D:\\app\\mcp.mjs"],
  persona: "你是 ResumeAgent。\n第二行",
}
```

断言 YAML 包含：

- 块标量。
- persona 第一行。
- MCP package。
- serverName。
- 转义后的 Windows command。
- 被禁用的 tool-bash。

`filePath` 在生成函数里没有实际作用，但测试仍按接口传入。

## 2. tests/versions.test.ts

### 行 1-4：依赖

临时目录、tmpdir、路径、Vitest。

### 行 6-15：测试环境

```ts
let store: typeof import("../server/src/resumes");

beforeAll(async () => {
  process.env.RESUME_DATA_DIR =
    mkdtempSync(join(tmpdir(), "resume-agent-"));
  store = await import("../server/src/resumes");
});
```

关键顺序：

1. 先设置环境变量。
2. 再动态 import。

`resumes.ts` 间接导入 `config.ts`，`config.ts` 在模块初始化时读取 `RESUME_DATA_DIR`。如果静态 import 写在文件顶部，测试就会读到旧目录。

### 行 17-30：登记原始版

`addOriginal` 返回 internal StoredVersion，但只检查公开语义：

- kind。
- publicVersions 长度。
- label。
- downloadUrl 前缀。

### 行 32-42：优化版编号和 PDF 关联

步骤：

1. 添加 v1。
2. 添加 v2。
3. 第一次 attachPdf 应挂到 v2。
4. 第二次 attachPdf 应挂到 v1。

断言顺序 v1/v2 和各自 pdfUrl。

这验证了“反向找最近未挂 PDF”的语义。

### 行 44-46：会话隔离

另一个 conversation id 返回空数组。

### 行 48-56：扫描件

addOriginal 带 needsOcr true，公开版本保留 needsOcr。

## 3. package.json

### 行 1-10：项目元信息

- name。
- version 0.2.0。
- private，防止误发布 npm。
- `type: module`，`.ts` / `.mjs` 默认按 ESM。
- Node >= 20。

### 行 10-20：scripts

| 脚本 | 行为 |
|---|---|
| `dev` | 同时启后端和前端，`-k` 表示一个退出时杀掉另一个 |
| `dev:server` | 先构建 MCP，再用 tsx watch 跑服务 |
| `dev:web` | 启动 Vite |
| `build:mcp` | 构建单文件 MCP |
| `langfuse:check` | Langfuse 连通性检查 |
| `build` | MCP + Vite 生产构建 |
| `start` | 构建 MCP 后直接启动服务 |
| `typecheck` | 根项目 + web 两套 tsconfig |
| `test` | Vitest 单次运行 |

### 行 21-36：运行时依赖

逐类：

- DSH SDK。
- Langfuse + OpenTelemetry。
- MCP SDK。
- Express。
- Mammoth DOCX。
- marked。
- multer。
- mupdf。
- puppeteer-core。
- unpdf。
- zod。

### 行 37-54：开发依赖

包括类型、React、Vite、esbuild、tsx、TypeScript、Vitest。

React 放在 devDependencies 是因为前端最终由 Vite 打包进静态资源，不需要生产 Node 进程在运行时 require React。

## 4. tsconfig.json

### 行 1-17：服务端/共享工具

关键选项：

- target ES2022。
- lib ES2023。
- module ESNext。
- moduleResolution Bundler。
- Node 类型。
- strict。
- noImplicitOverride。
- noFallthroughCasesInSwitch。
- 文件名大小写一致。
- skipLibCheck。
- resolveJsonModule。
- allowImportingTsExtensions。
- noEmit。

`noEmit` 表示只用 tsc 做类型检查。实际执行由 tsx 或 esbuild。

`include` 覆盖：

```text
server tools shared scripts tests
```

不包含 `web`，因为 web 有独立 tsconfig。

## 5. vitest.config.ts

### 行 1-8

```ts
test: {
  include: ["tests/**/*.test.ts"],
  environment: "node",
}
```

只找 tests 下的 test.ts，不运行 web 组件测试。当前没有 DOM 测试环境。

## 6. web/tsconfig.json

### 行 1-14

差异：

- lib 加 DOM 和 DOM.Iterable。
- jsx: react-jsx。
- types: vite/client。
- include src 和 shared/protocol.ts。

`react-jsx` 表示 JSX 不要求每个文件手动 import React，只要 import 需要的 hooks。

## 7. web/vite.config.ts

### 行 1-3

Vite、React 插件、fileURLToPath。

### 行 5-7：root

```ts
root: fileURLToPath(new URL(".", import.meta.url))
```

把 Vite 根目录设为 `web/`，即使命令在仓库根目录运行。

### 行 8-17：开发 server

```ts
port: 5179,
strictPort: true,
proxy: {
  "/api": {
    target: "http://127.0.0.1:5178",
    changeOrigin: false,
  },
},
```

frontend 5179，API 5178。

`strictPort` 防止端口被占用时悄悄换端口，导致预期 URL 失配。

`changeOrigin: false` 保持原始 Host。本项目只监听本机，没有复杂虚拟主机需求。

### 行 18-21：build

输出到 `web/dist`，每次构建先清空。

## 8. web/index.html

### 行 1-13

- 中文 lang。
- UTF-8。
- viewport。
- theme-color。
- 标题。
- `#root`。
- 入口 `/src/main.tsx`。

Vite 在 build 时把入口脚本转换成带 hash 的资源。

## 9. .env.example

### 行 1-5：服务

- PORT 5178。
- HOST 127.0.0.1。

### 行 7-16：DSH

列出可覆盖路径、profile、provider、model、token 上限和 home。

### 行 18-20：工作区

`RESUME_WORKSPACE`。

### 行 22-26：Langfuse

两个 key 和一个 host。key 留空时观测关闭。

`.env.example` 不是实际秘密文件，实际 `.env` 被 gitignore。

## 10. .gitignore

### 行 1-10

忽略：

- 依赖。
- 构建产物。
- 覆盖率。
- 本地环境变量。
- 运行时补丁。
- 工作区。
- 数据。
- 日志。
- macOS 垃圾文件。

这解释了为什么 conversations、用户附件和真实 key 不应进入仓库。

## 11. scripts/build-mcp.mjs

### 行 1：esbuild

### 行 3-6：目标

把 `tools/src/mcp-server.ts` 和它依赖的项目代码打成：

```text
dist/mcp-server.mjs
```

这样运行时不需要 tsx，也不需要逐个解析项目源码文件。

### 行 7-16：构建参数

- `entryPoints`。
- `outfile`。
- `bundle: true`。
- `platform: node`。
- `format: esm`。
- `target: node20`。
- 不生成 sourcemap。
- 不压缩。

不压缩便于排查打包代码；生产体积不是当前瓶颈。

### 行 17-18：external mupdf

```ts
external: ["mupdf"],
```

mupdf 带 WASM 资产，不能简单内联到单文件。它仍在 `node_modules` 中由运行时解析。

### 行 19-21：banner

```ts
banner: {
  js: "import { createRequire ... } ...",
}
```

有些 CommonJS 依赖会调用 `require`。ESM 单文件没有直接可用的 `require`，这里创建一个。

## 12. scripts/preview.mjs

### 行 1-10：依赖

- 写文件、读文件。
- 路径。
- puppeteer-core。

### 行 12-16：启动浏览器

硬编码：

```text
C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
```

换机器或换浏览器路径时需要修改脚本。正式 PDF 工具支持多个候选路径，预览脚本没有复用 `findBrowser()`。

### 行 18-21：参数和视口

```ts
const [mode, out, input] =
  process.argv.slice(2);
```

示例：

```text
node scripts/preview.mjs ui out.png
node scripts/preview.mjs drawer out.png
node scripts/preview.mjs pdf out.png file.md
```

视口 1440x900，设备像素比 1.5。

### 行 23-27：PDF 模式

```ts
const { renderHtml } =
  await import("../tools/src/pdf.ts");
```

这里直接 import TypeScript 文件。能否运行取决于 Node 版本或是否通过 tsx 启动。

读取 Markdown，setContent，再把视口改成 A4 比例。

### 行 28-40：UI 模式

访问：

```text
http://127.0.0.1:5178/
```

等待网络空闲和额外 800ms。

drawer 模式会点击 `.versions-btn`，等待 600ms。

然后滚到底部。

### 行 42-47：截图和关闭

UI 模式只截当前视口，其他模式 fullPage。最后 finally 关浏览器。

## 13. scripts/fake-openai-server.mjs

这个脚本与当前 ResumeAgent 主流程没有 import 关系。文件注释里的命令还指向不存在的 `src/index.ts`，说明它很可能是早期版本留下的兼容测试脚本。

### 行 1-9：依赖和注释

用原生 HTTP 创建假 OpenAI 兼容服务。

### 行 11：端口

默认 8787。

### 行 13-37：假分析结果

一个固定 JSON：

- score。
- verdict。
- summary。
- matchedKeywords。
- missingKeywords。
- strengths。
- gaps。
- bulletRewrites。

### 行 39-44：路由检查

只接受：

```text
POST .../chat/completions
```

其他路径 404。

### 行 46-56：读取 body 和 model

accumulate 请求体，尝试解析 model。解析失败仍继续。

### 行 57-64：返回 OpenAI 形状

```json
{
  "model": "...",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "<analysis JSON string>"
    }
  }]
}
```

### 行 67-69：监听

只绑定 127.0.0.1。

如果以后清理仓库，这个脚本可以单独评估是否删除；当前文档保留它，避免漏掉手写文件。

## 14. scripts/smoke-mcp.mjs

这是不需要 DSH 模型的 MCP 直连测试。

### 行 1-9：依赖和用法

使用 `spawn`、文件复制和路径。

### 行 11-15：准备 fixture

确保 `workspace/uploads` 存在，把 sample Markdown 复制进去。

### 行 17-20：启动 MCP

```js
spawn(process.execPath, [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    RESUME_WORKSPACE: workspace,
  },
});
```

设置 workspace，让工具边界指向预期目录。

### 行 22-41：读取 JSON-RPC

```js
let buffer = "";
const pending = new Map();
let nextId = 1;
```

MCP stdio 每条 JSON-RPC 以换行分隔。脚本按换行切分，解析后按 id 找 pending Promise。

stderr 原样转发到当前 stderr。

### 行 45-52：request

发送：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {}
}
```

并保存 Promise resolve。

### 行 54-56：notify

通知没有 id，不需要等待响应。

### 行 58-64：initialize

协议版本、capabilities、clientInfo，然后发送 initialized 通知。

### 行 66-70：tools/list

打印工具名。

### 行 72-77：resume_parse

调用 fixture 路径，打印 isError 和摘要前 220 字。

### 行 79-101：resume_rewrite

构造一个最小 profile，调用 rewrite，打印 artifact。

### 行 103-110：pdf_generate

如果 rewrite 返回 path，就以它为输入生成 PDF。

### 行 112：结束子进程

`child.kill()` 没有等待退出回调。脚本主要用于冒烟，不保证清理时序。

## 15. scripts/smoke-chat.mjs

这是真实 HTTP + 真实 DSH + 真实模型的端到端脚本。

### 行 1-12：用法和参数

服务地址默认 `http://127.0.0.1:5178`。prompt 可以从命令行传。

### 行 14-18：jsonFetch

统一检查 HTTP 状态并解析 JSON。

### 行 20-22：创建会话

打印 conversation id 和 DSH session id。

### 行 24-31：上传 fixture

```js
form.append("file", new Blob(...), "张晨-简历.md");
```

注意这里没有 append `conversationId`，所以附件不会登记为原始版本，只进入 attachments 索引。

### 行 33-40：turn 请求

POST 消息，180 秒超时。

### 行 42-48：SSE 解析

使用 ReadableStream、TextDecoder、buffer。

### 行 50-64：事件处理

- 记录事件类型。
- tool_call 打时间。
- error 打印。
- artifact 打印。

### 行 65-72：saved 事件

打印：

- 助手文本前 700 字。
- usage。
- 工具状态。
- artifact。

### 行 74-76：耗时和去重事件种类

### 行 78-83：第二轮

如果环境变量 `FOLLOW_UP` 存在，再跑同一会话，验证上下文。

## 16. scripts/smoke-versions.mjs

### 行 1-9：依赖和 base URL

### 行 11-15：jsonFetch

### 行 17-18：创建会话

### 行 20-29：upload 辅助函数

与普通上传相比，这里显式 append conversationId，因此会登记原始版本。

### 行 31：上传 Markdown

### 行 33-42：尝试上传 PDF

从 `workspace/outputs` 随便找第一个 `.pdf`，再上传。

这会让测试依赖目录里已有的 PDF，不是一个自包含 fixture；也只用于人工冒烟。

### 行 44-52：发改写 + PDF prompt

240 秒超时。

### 行 54-74：读取 SSE

找到 artifact 打印，saved 事件保存 versions。

### 行 76-81：核对两个来源

先打印 saved 内联 versions，再 GET 独立版本接口，验证两者一致。

## 17. scripts/smoke-real-flow.mjs

### 行 1-8：用法

参数是真实 PDF 路径。

### 行 8-10：解析路径和文件名

### 行 12-16：jsonFetch

### 行 18-28：创建会话、上传 PDF、打印抽取统计

会显式传 conversationId，登记原始版本。

### 行 30-68：turn 辅助函数

与 smoke-chat 类似，但额外记录：

- tool_call。
- tool_result。
- artifact。
- error。
- saved 回复。

300 秒超时。

### 行 70：第一轮诊断

要求指出问题和缺失信息，验证 Agent 可能追问。

### 行 72-75：第二轮改写 + PDF

明确要求保留公司/学校，不编数字，然后导出。

### 行 77-84：读取最终版本

打印原始版、优化版、Markdown URL、PDF URL。

这是最接近真实产品流程的手工验收脚本。

## 18. scripts/smoke-real-pdf.mjs

### 行 1-9：用法和路径

### 行 11-15：jsonFetch

### 行 17-22：创建会话并上传 PDF

### 行 23-24：打印 preview

### 行 26-31：发送“解析简历”消息

### 行 33-56：读取 SSE

打印 tool 名称、tool 是否成功、错误、最终回复前 700 字。

脚本没有像 smoke-real-flow 那样完整验证版本和 PDF，只验证抽取和解析对话。

## 19. scripts/smoke-langfuse.ts

### 行 1-9：依赖和 received

本轮测试把所有 HTTP 请求体收集进数组。

### 行 11-23：假 Langfuse

任何请求：

1. 收集 URL 和 body。
2. 返回 207。
3. body 是 `{ successes: [], errors: [] }`。

207 是 OTLP 常见部分成功响应。这里简化成全部接受。

### 行 25-27：设置环境变量

必须在动态 import `obs/langfuse` 之前设置，因为 config 在首次导入时读取 key。

### 行 29：动态 import

### 行 31-40：创建 trace

模拟一轮：

- conversation id。
- session id。
- message id。
- input。
- model。
- attachments。

### 行 42-47：模拟事件

顺序：

1. modelStarted。
2. toolStarted。
3. toolFinished。
4. modelCompleted。
5. finish。

然后等 3 秒，让 OTel 批量发送。

### 行 49：关闭 server

### 行 51-65：解析收到的 batches

解析每个 body 的 `batch` 数组，收集 event.type。

### 行 64-66：输出路径、类型和样本

脚本不自动断言，只打印，适合人工确认。要变成正式测试，需要加 expect。

## 20. scripts/check-langfuse.mjs

### 行 1-9：说明

不启动 ResumeAgent 服务，独立验证：

1. 网络。
2. 鉴权。
3. OTLP 写入。

### 行 10-13：依赖

随机字节用于 trace/span id。

### 行 14-33：再次解析 .env

为什么重复 `env.ts` 的逻辑：

- 脚本不是从服务入口启动。
- 不能依赖 `server/src/env.ts` 的副作用。
- 需要去 BOM。

### 行 35-37：读取配置并去掉末尾斜杠

```ts
const host = (
  process.env.LANGFUSE_HOST ??
  "https://cloud.langfuse.com"
).replace(/\/+$/, "");
```

### 行 39-45：缺少 key 时退出

使用 `process.exit(1)`。

### 行 47：Basic Auth

```ts
Basic base64(publicKey:secretKey)
```

### 行 49-50：打印 host 和脱敏 public key

只显示前 8 个字符和长度。

### 行 52-63：网络 + 版本检查

请求 `/api/public/health`，10 秒超时。

失败退出码 2。

### 行 65-80：鉴权检查

请求 `/api/public/projects`。

401/403 提示 key 与区域不匹配。

失败退出码 3。

### 行 82-113：OTLP payload

最小资源 span：

- service.name。
- scope。
- 16 字节 trace id。
- 8 字节 span id。
- 名称。
- 纳秒时间。
- Langfuse observation/trace 属性。

### 行 115-134：发送 OTLP

请求：

```text
POST /api/public/otel/v1/traces
```

2xx 视为成功，提示去 Traces 查 `resume-agent.connectivity-check`。

失败退出码 4。

## 21. 脚本之间的真实关系

### 不依赖模型

- `build-mcp.mjs`
- `smoke-mcp.mjs`
- `preview.mjs`
- `check-langfuse.mjs`
- `smoke-langfuse.ts`

### 依赖运行中的服务

- `smoke-chat.mjs`
- `smoke-versions.mjs`
- `smoke-real-flow.mjs`
- `smoke-real-pdf.mjs`

这些脚本默认服务已经在 5178 运行。

### 历史或辅助

- `fake-openai-server.mjs`

当前主流程没有引用。

## 22. 本章完成后应能回答

- 为什么 versions 测试必须动态 import？
- `npm run dev:server` 为什么先构建 MCP？
- Vite 如何把 `/api` 请求转到 5178？
- `smoke-mcp` 如何在没有模型的情况下调用工具？
- `smoke-chat` 和 `smoke-versions` 的上传差异是什么？
- Langfuse 自检为什么直接发 OTLP span？
