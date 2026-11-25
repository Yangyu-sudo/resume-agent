# 09 - 常见误区、调试路径与练习

读完前八章后，用这一章检查自己是否真的建立了调用链理解。

## 1. 十个必须能回答的问题

### 问题 1：为什么一个会话有两个 id？

答案：

- `Conversation.id` 是 ResumeAgent 的 HTTP 和 JSON 主键。
- `dshSessionId` 是 DeepSeek Harness 的上下文主键。

服务端重启时，前者恢复本地消息，后者恢复 Agent 上下文。

### 问题 2：附件为什么只传 id？

浏览器上传后，服务端已经保存了文件和索引。再传二进制或全文会浪费带宽，也会让消息 JSON 过大。

真正路径只由服务端在 `buildPrompt()` 中写给模型。

### 问题 3：工具结果为什么是“摘要 + JSON”？

模型需要自然语言摘要，程序需要结构化 data 和 artifacts。一个文本同时满足两类消费者。

### 问题 4：为什么工具输出不能从 stdout 打印日志？

MCP stdio 的 stdout 是 JSON-RPC 通道。日志写到 stdout 会污染协议。工具日志必须用 stderr。

### 问题 5：为什么 SSE 是 POST？

发消息需要 JSON body，浏览器的原生 `EventSource` 只支持 GET，所以前端使用 `fetch` ReadableStream 手动解析。

### 问题 6：为什么正文不是实时的？

DSH 的工具事件可以实时推送，但 assistant 正文在 `assistant/message` 到达时已经是完整字符串。前端打字机只是回放。

### 问题 7：为什么保存用户消息在 SSE 响应头之前？

为了让用户输入先落地。即使后续模型失败或连接断开，历史仍完整。

### 问题 8：为什么同一会话要排队？

DSH session 是一个有顺序的上下文。并发 prompt 可能让模型状态和工具调用交错，服务端用 `sessionQueues` 串行化。

### 问题 9：为什么服务重启后要 resume？

本地消息和 DSH 的上下文存储是两套状态。新的 DSH 运行时进程需要重新打开旧 session。

### 问题 10：为什么简历版本不直接用工具输出里的 URL？

工具只知道自己写的绝对路径。浏览器不能访问本机绝对路径，因此服务端统一转换成 `/api/outputs/<basename>`。

## 2. 从点击到落库的逐层追踪

以“帮我改简历”为例。

### 点击发送

`Composer.submit()`：

- 检查 canSend。
- 调用 `onSend(value.trim())`。
- 清空输入。

### App.send

- 确保有会话。
- 构造本地 userMessage。
- 立即加入 active.messages。
- 清空 attachments。
- 创建 draft。
- busy = true。
- 调用 `api.streamMessage()`。

### 浏览器 fetch

`POST /api/conversations/:id/messages`

body：

```json
{
  "text": "帮我改简历",
  "attachmentIds": ["..."]
}
```

### chatRouter

- 校验会话。
- 校验 body。
- 解析附件。
- 计算 hadHistory。
- 保存 userMessage。
- 写 SSE 响应头。

### runtime.runTurn

- 在 session 队列中排队。
- getHarness 懒启动 DSH。
- buildPrompt 拼附件路径。
- `session.run()`。

### DSH

- 调用模型。
- 模型决定是否调用 MCP 工具。

### MCP

- 工具读写 workspace。
- 返回摘要 + JSON。

### events.normalizeSessionEvent

- tool/call -> tool_call。
- tool/result -> tool_result + artifact。
- assistant/message -> assistant。
- turn/end -> done。

### chatRouter sink

- collector.apply 汇总。
- send("ui", event) 推给浏览器。
- onToolResult 记录 Langfuse 和版本。

### App.applyUiEvent

- 更新 draft 的工具状态、正文和 artifact。
- React 重渲染。

### 轮次结束

- collector 变成 assistantMessage。
- appendMessage 保存。
- saved 发送最终消息和版本。
- App 替换本地 userMessage，加入 assistantMessage，清空 draft。
- refreshList 更新会话排序。

### trace.finish

- 更新根 span。
- 结束 span。
- 最多 2 秒 flush。

### response.end

浏览器读取器结束 for-await。

## 3. 调试路径

### 页面没有会话

检查顺序：

1. `GET /api/conversations`。
2. `data/conversations.json` 是否可读。
3. `listConversations()` 是否抛错。
4. `App` 初始化 effect 是否执行。

### 上传后没有原始版本

检查：

1. 上传请求 multipart 是否带 `conversationId`。
2. `request.body.conversationId` 是否字符串。
3. `addOriginal()` 是否被调用。
4. `data/resumes.json` 是否有 bucket。

### 上传成功但正文为空

检查：

1. `extractDocument()` 是否抛错。
2. PDF 是否为扫描件。
3. `needsOcr` 是否 true。
4. 是否只有极短文本。

### 模型找不到附件

检查：

1. `resolveAttachments()` 是否返回空。
2. attachments.json 中 path 是否存在。
3. 文件是否仍在 uploads。
4. `buildPrompt()` 是否加入附件块。

### 工具一直不出现

检查：

1. DSH 是否启动成功。
2. patch YAML 是否有 mcp-resume insert。
3. MCP command 是否存在。
4. `dist/mcp-server.mjs` 是否构建。
5. 工具服务 stderr 是否有错误。

### 工具完成但没有下载卡片

检查：

1. 工具 output 末尾是否有合法 JSON 块。
2. `decodeToolResult()` 是否返回 payload。
3. payload.artifacts 是否是数组。
4. `emitArtifacts()` 是否收到完整 output。

### 对话结束但页面一直显示 busy

检查：

1. SSE 是否收到 saved。
2. for-await 是否因异常退出。
3. App 的 finally 是否执行。
4. 服务端 response.end 是否到达。

### 刷新后最后一条回复又打字

这是当前 UI 行为：

```ts
animate={
  message.role === "assistant" &&
  index === messages.length - 1 &&
  draft === null
}
```

最后一条历史助手消息满足条件。

### Langfuse 未接入

检查：

1. `.env` 是否两个 key 都非空。
2. 服务是否重启。
3. `/api/health` 的 observability。
4. `npm run langfuse:check`。
5. host 区域与 key 是否匹配。

### PDF 生成失败

检查：

1. `findBrowser()` 能否找到 Edge/Chrome。
2. `RESUME_BROWSER_PATH` 是否正确。
3. 浏览器是否能无头启动。
4. 中文字体是否存在于系统。
5. OUTPUT_DIR 是否可写。

## 4. 代码里的重要非显然行为

下面不是要求修改，而是读代码时容易被误解的地方。

### 4.1 附件 id 可能在解析后变为空

位置：`server/src/routes/chat.ts` 行 73-88。

输入校验只看原始 `attachmentIds.length`。如果 id 全都过期，解析后的 attachments 是空数组，但请求已经通过。

### 4.2 删除会话不会级联删除

位置：`server/src/store.ts` 行 68-75。

只删除 conversations.json 中的会话。以下状态仍保留：

- attachments.json。
- resumes.json。
- workspace/uploads。
- workspace/outputs。
- DSH_HOME 中的 session。

### 4.3 版本号依赖只增不删

位置：`server/src/resumes.ts` 行 96-115。

`优化版 vN` 来自当前优化版数组长度。未来若增加删除版本功能，要重新设计编号。

### 4.4 attachPdf 不是基于 Markdown 路径匹配

位置：`server/src/resumes.ts` 行 117-124。

它找“最新一个还没有 PDF 的优化版”。多版本交错导出时可能挂错。

### 4.5 运行时启动存在并发窗口

位置：`server/src/agent/runtime.ts` 行 64-65 和 111-113。

`harness` 在 start 完成前已经非 null。并发请求可能直接拿到尚未完成初始化的实例。SDK 内部可能处理，但本地代码没有显式等待 `starting`。

### 4.6 Langfuse 只记录一个 generation

位置：`server/src/obs/langfuse.ts` 行 136-152。

第一次 `modelCompleted()` 后 `generation = null`。一轮多 step 时，后续模型调用没有独立 generation。

### 4.7 PDF 预览脚本依赖 TypeScript 运行能力

位置：`scripts/preview.mjs` 行 24。

它直接 import `.ts`。在 Node 20 环境中可能需要通过 tsx 启动；当前 Node 24 可直接处理部分类型剥离。

### 4.8 旧版 OpenAI 假服务不属于主流程

位置：`scripts/fake-openai-server.mjs`。

当前主流程使用 DSH SDK，没有代码 import 这个脚本。其注释中的命令还指向不存在的 `src/index.ts`。

### 4.9 前端不阻止单独附件空文本

这是故意的产品行为：

- Composer 的 canSend 允许有附件、无文字。
- 服务端允许 `text === ""` 且 `attachmentIds.length > 0`。
- 最终 prompt 只有附件块。

### 4.10 移动端没有会话切换入口

位置：`web/src/styles.css` 行 683-693。

宽度小于等于 860px 时 sidebar `display: none`，没有替代的 drawer 或 menu。会话切换只能通过桌面宽度或 API。

## 5. 动手实验

### 实验 1：观察一次 SSE

启动服务后，在浏览器开发者工具 Network 找到消息请求，查看：

- Response Headers 的 content-type。
- EventStream 中的 event 名。
- ui 事件的 type 顺序。
- saved 事件的版本数组。

### 实验 2：断开 SSE

发送一条耗时请求，然后刷新页面。

预期：

- 当前页面停止接收事件。
- 服务端仍继续执行。
- 刷新后 message 历史里最终仍有助手消息。

### 实验 3：修改 needsOcr 阈值

把 `files.ts` 的 80 改成 500，重新上传短文字 PDF。

观察：

- 返回的 needsOcr。
- 前端提示。
- 是否阻止结构解析。

实验后恢复。

### 实验 4：给工具结果加第二个 artifact

在 `resume_rewrite` 的 artifacts 数组添加一个 Markdown 文件。

观察：

- SSE artifact 是否两次。
- TurnCollector 是否按 URL 去重。
- 版本登记是否只使用第一个。

实验后恢复。

### 实验 5：关闭 Langfuse key

清空 `.env` 的两个 key，重启服务。

观察：

- health.observability。
- 对话是否完全正常。
- `startTurnTrace` 返回 no-op。

### 实验 6：调用不存在或过期的 attachment id

用 curl 或脚本发送：

```json
{
  "text": "",
  "attachmentIds": ["missing-id"]
}
```

观察当前空 prompt 边界。

### 实验 7：生成两个版本后再挂 PDF

连续生成 v1、v2，再过一段时间只为其中一个 Markdown 生成 PDF，查看 `attachPdf()` 的选择结果。

### 实验 8：在 Runtime 里打事件日志

临时在 `normalizeSessionEvent()` 入口打印 `event.type`。

观察一轮完整改简历通常出现：

```text
turn/start
step/start
assistant/message
tool/call
tool/result
...
turn/end
```

不要打印完整附件路径或用户正文到长期日志。

## 6. 如果你想继续读第三方源码

建议顺序：

### DSH SDK

```text
node_modules/@deepseek-ai/dsh-sdk-client/lib/types/api.d.ts
node_modules/@deepseek-ai/dsh-sdk-client/lib/types/types.d.ts
node_modules/@deepseek-ai/dsh-sdk-client/lib/types/client.d.ts
```

重点：

- `DeepSeekHarness.start()`。
- `HarnessSession.run()`。
- `RunResult`。
- JSON-RPC notification。

### MCP SDK

重点：

- `McpServer.registerTool()`。
- `StdioServerTransport`。
- tool result content。

### Langfuse tracing

重点：

- `propagateAttributes()`。
- `startObservation()`。
- `asType: "generation"` / `"tool"`。
- `forceFlush()`。

### React

重点：

- `useState` 函数式更新。
- `useEffect` 清理。
- `useRef` 跨渲染保存值。
- `AsyncGenerator` 与 `for await`。

## 7. 掌握标准

如果你能不打开源码完成下面任务，就已经真正理解了这个项目。

### 任务 1

画出：

```text
Browser -> Express -> DSH -> MCP -> FS -> SSE -> React
```

并标出每一层的输入输出。

### 任务 2

说明以下对象的生命周期：

- Attachment。
- Draft。
- ChatMessage。
- ResumeVersion。
- Langfuse span。

### 任务 3

预测修改下面代码会影响哪里：

```ts
const MAX_TOOL_OUTPUT = 4000;
```

答案应区分：

- UI 工具输出。
- 完整工具回调。
- Langfuse。
- 版本登记。

### 任务 4

解释为什么会话刷新后还在，但运行时进程可能是新的。

### 任务 5

解释为什么同一个工具结果既需要 summary，又需要 JSON。

### 任务 6

从一个错误页面反向找到：

- 前端 catch。
- SSE 事件。
- runtime catch。
- 工具 error。
- Langfuse error span。

能完成这六项，基本就覆盖了这个项目的核心复杂度。
