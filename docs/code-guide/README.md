# ResumeAgent 源码精读手册

这套文档的目标不是复述文件名，而是让你能从一次浏览器点击开始，沿着 HTTP、SSE、DSH、MCP、文件系统、Langfuse 和 React 状态更新，一直追到最终落库的每个关键变量。

`逐行`在这里表示：

- 所有手写源码、配置和测试都有明确的行号区段。
- 每个区段都说明它在运行时的作用、输入、输出和容易误解的地方。
- 连续且语义相同的声明会放在一起解释，但区段覆盖文件中每一行。
- 自动生成或依赖产物不逐行讲解，包括 `package-lock.json`、`dist/mcp-server.mjs`、`web/dist/**`、`node_modules/**`。
- 本地数据和用户简历不写入文档，包括 `data/**`、`workspace/**`、`.runtime/**` 中的生成文件。

## 当前代码快照

这份手册对应仓库当前版本 `0.2.0`，阅读时如果源码行号变化，以文件内函数名为锚点。

手写源码规模如下。行数包含空行。

| 层级 | 文件数 | 行数 |
|---|---:|---:|
| 共享协议与抽取 | 3 | 257 |
| 服务端 | 14 | 1,670 |
| MCP 工具 | 4 | 557 |
| 前端源码 | 6 | 1,869 |
| 测试 | 2 | 143 |
| 脚本 | 10 | 754 |
| 合计 | 39 | 5,250 |

前端口径包含 `styles.css` 的 898 行，不包含 `web/dist`。

## 先读顺序

严格按下面顺序读，后面的文件会反复引用前面的类型和状态。

1. [01 - 全局心智模型](01-overview.md)
2. [02 - 共享协议、工具载荷与文本抽取](02-shared.md)
3. [03 - 服务端基础层](03-server-core.md)
4. [04 - HTTP 路由与 SSE](04-server-routes.md)
5. [05 - Agent 运行时与 Langfuse](05-agent.md)
6. [06 - MCP 工具](06-tools.md)
7. [07 - React 前端](07-web.md)
8. [08 - 测试、脚本与构建配置](08-tests-scripts-config.md)
9. [09 - 常见误区、调试路径与练习](09-reading-lab.md)
10. [10 - 项目技术全景](10-technologies.md)

## 四个必须先建立的词

### 1. Conversation

前端侧的一个聊天会话。它保存在 `data/conversations.json`，包含标题、消息数组和 `dshSessionId`。

### 2. DSH session

DeepSeek Harness 运行时内部的会话。`conversation.dshSessionId` 是两边建立对应关系的键。服务端重启后，服务端 JSON 仍然在，DSH 也可能把自己保存的会话恢复出来。

### 3. Turn

用户提交一条消息，Agent 可能进行多次模型调用、多次工具调用，最后返回回复。这一整段过程叫一轮。一个 turn 里可以有多个 step。

### 4. Artifact

工具写到 `workspace/outputs` 的文件，例如优化后的 Markdown 和导出的 PDF。工具返回绝对路径，服务端把它转换成 `/api/outputs/<文件名>` 下载地址。

## 一次请求的全景

```text
浏览器
  |
  | POST /api/conversations/:id/messages
  v
Express chatRouter
  |
  | runTurn(...)
  v
DSH SDK client
  |
  | JSON-RPC over stdio
  v
DeepSeek Harness 子进程
  |
  | MCP over stdio
  v
resume_parse / resume_rewrite / pdf_generate
  |
  v
workspace/uploads 或 workspace/outputs

DSH session.event
  -> normalizeSessionEvent
  -> UiEvent
  -> SSE event: ui
  -> React draft state
  -> 页面实时更新
```

一轮结束时，服务端会额外发送 `saved` 事件，把最终的 `userMessage`、`assistantMessage` 和最新简历版本一起交给前端。前端用这些服务端对象替换本地临时消息。

## 三条独立的数据链

读代码时不要把下面三份状态混在一起。

### 会话消息链

```text
data/conversations.json
  -> server/src/store.ts
  -> routes/chat.ts
  -> web/src/api.ts + web/src/App.tsx
```

决定聊天列表、消息气泡、token 用量和工具调用记录。

### 附件链

```text
workspace/uploads/<uuid>.<ext>
data/attachments.json
  -> server/src/attachments.ts
  -> buildPrompt 中的绝对路径
  -> MCP resume_parse
```

浏览器不会把文件内容再次塞进 JSON。消息只携带 `attachmentId`，服务端查出路径后写入发给 Agent 的 prompt。

### 简历版本链

```text
data/resumes.json
  -> server/src/resumes.ts
  -> /api/conversations/:id/resumes
  -> VersionsDrawer
```

上传文件登记原始版；`resume_rewrite` 登记优化版；`pdf_generate` 把 PDF 挂到最近一个还没有 PDF 的优化版。

## 完整行号覆盖表

本表用于确认没有漏读文件。详细解释位于对应章节。

| 文件 | 总行数 | 主要讲解位置 |
|---|---:|---|
| `shared/protocol.ts` | 101 | 02 |
| `shared/tool-payload.ts` | 50 | 02 |
| `shared/extract.ts` | 106 | 02 |
| `server/src/env.ts` | 31 | 03 |
| `server/src/config.ts` | 57 | 03 |
| `server/src/index.ts` | 66 | 03 |
| `server/src/store.ts` | 113 | 03 |
| `server/src/attachments.ts` | 62 | 03 |
| `server/src/resumes.ts` | 144 | 03 |
| `server/src/routes/files.ts` | 142 | 04 |
| `server/src/routes/chat.ts` | 295 | 04 |
| `server/src/agent/persona.ts` | 16 | 05 |
| `server/src/agent/patch.ts` | 113 | 05 |
| `server/src/agent/mcp-launch.ts` | 16 | 05 |
| `server/src/agent/events.ts` | 166 | 05 |
| `server/src/agent/runtime.ts` | 243 | 05 |
| `server/src/obs/langfuse.ts` | 206 | 05 |
| `tools/src/workspace.ts` | 48 | 06 |
| `tools/src/resume.ts` | 249 | 06 |
| `tools/src/pdf.ts` | 101 | 06 |
| `tools/src/mcp-server.ts` | 159 | 06 |
| `web/src/api.ts` | 122 | 07 |
| `web/src/useTypewriter.ts` | 45 | 07 |
| `web/src/main.tsx` | 13 | 07 |
| `web/src/App.tsx` | 349 | 07 |
| `web/src/components.tsx` | 442 | 07 |
| `web/src/styles.css` | 898 | 07 |
| `tests/tools.test.ts` | 86 | 08 |
| `tests/versions.test.ts` | 57 | 08 |
| `scripts/build-mcp.mjs` | 22 | 08 |
| `scripts/check-langfuse.mjs` | 134 | 08 |
| `scripts/fake-openai-server.mjs` | 69 | 08 |
| `scripts/preview.mjs` | 47 | 08 |
| `scripts/smoke-chat.mjs` | 83 | 08 |
| `scripts/smoke-langfuse.ts` | 66 | 08 |
| `scripts/smoke-mcp.mjs` | 112 | 08 |
| `scripts/smoke-real-flow.mjs` | 84 | 08 |
| `scripts/smoke-real-pdf.mjs` | 56 | 08 |
| `scripts/smoke-versions.mjs` | 81 | 08 |

配置和入口文件：

| 文件 | 总行数 | 主要讲解位置 |
|---|---:|---|
| `package.json` | 55 | 08 |
| `tsconfig.json` | 17 | 08 |
| `vitest.config.ts` | 8 | 08 |
| `web/tsconfig.json` | 14 | 08 |
| `web/vite.config.ts` | 22 | 08 |
| `web/index.html` | 13 | 08 |
| `.env.example` | 26 | 08 |
| `.gitignore` | 10 | 08 |

## 已经验证过的基线

在当前机器上执行过：

```text
npm run typecheck   通过
npm test            2 个测试文件，12 个测试全部通过
npm run build:mcp   成功生成 dist/mcp-server.mjs
```

测试和构建在受限环境中第一次失败的原因是需要启动 `esbuild` 子进程，获得本地进程权限后通过。失败与 TypeScript 代码无关。

## 怎样使用这套文档

每章都有三种信息：

1. `行号地图`：告诉你要打开哪个文件的哪些行。
2. `逐段解释`：解释控制流、数据流和容易看错的语法。
3. `运行时视角`：把静态代码映射到一次真实请求。

第一次阅读不要试图背 API。先能回答下面三个问题，再逐行深入：

- 一条用户消息从浏览器到模型，中间经过哪些对象？
- 模型要求调用工具时，工具的名字和结果如何变成页面上的状态？
- 刷新页面或重启服务后，聊天和简历版本为什么还在？

当你能不打开源码画出这三条链，再进入各章的行号细节。
