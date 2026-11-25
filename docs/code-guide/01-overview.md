# 01 - 全局心智模型

这一章先不追每一行，而是回答：项目启动后有哪些进程，哪些状态分别放在哪里，一次对话经过哪些边界。

## 1. 这是一个三层系统

### 浏览器层

React 负责：

- 左侧会话列表。
- 中间消息流。
- 底部输入框和附件上传。
- 工具执行状态。
- Markdown 和下载卡片渲染。
- 简历版本抽屉。

浏览器只相信服务端返回的 `Conversation`、`ChatMessage`、`ResumeVersion` 和 `UiEvent`。这些类型的唯一来源是 `shared/protocol.ts`。

### Node 服务层

Express 负责：

- 会话 CRUD。
- 上传文件并抽取文本。
- 把浏览器消息转换成 Agent prompt。
- 管理 DSH 运行时子进程。
- 把 DSH 事件转换成 SSE。
- 把工具产物登记成简历版本。
- 提供下载路由。
- 可选地向 Langfuse 上报 trace。

服务层同时是安全边界。模型不能直接用操作系统工具；补丁禁用了 shell、文件、web、subagent 等能力，只留下三个 MCP 工具。

### DSH 与 MCP 层

DSH 是一个独立子进程，通过 stdio 和 Node 服务通信。它负责模型循环：

```text
接收 prompt
  -> 调用模型
  -> 模型可能请求工具
  -> 调用 MCP 工具
  -> 把工具结果交回模型
  -> 继续下一个 step
  -> 最终返回
```

MCP 工具服务又是 DSH 的子进程。它不接触模型 API，只做确定性的文件操作、文本解析、模板渲染和 PDF 生成。

## 2. 进程图

生产模式下只有一个对外 Node 进程，但它会启动子进程：

```text
浏览器
  |
  | HTTP / SSE
  v
Node server
  | pid A
  |
  +---- stdio JSON-RPC ----> DeepSeek Harness
  |                           pid B
  |                             |
  |                             +---- stdio MCP ----> resume-tools
  |                             |                       pid C
  |                             |
  |                             +---- HTTPS ---------> DeepSeek 模型
  |
  +---- HTTPS ----------------------------------------> Langfuse（可选）
```

重要事实：

- Node 服务在第一次真正需要 Agent 时才启动 DSH，见 `getHarness()`。
- 整个 Node 服务只复用同一个 `DeepSeekHarness` 实例。
- 多个前端会话通过不同的 `sessionId` 复用这个实例。
- MCP 服务由 DSH 的 MCP client 启动。
- 服务退出时，`closeRuntime()` 关闭 DSH，DSH 再负责它自己的子进程。

## 3. 三份持久化状态

### conversations.json

保存聊天会话：

```ts
{
  version: 1,
  conversations: [
    {
      id,
      title,
      dshSessionId,
      messages,
      createdAt,
      updatedAt
    }
  ]
}
```

主要读写文件是 `server/src/store.ts`。

关键点：

- 第一次用户消息会触发自动标题。
- 助手消息在整轮结束后才追加。
- `dshSessionId` 从第一轮开始就固定。
- 删除会话只删除这里的记录，不删除 DSH 自己保存的 session，也不删除上传文件或版本记录。

### attachments.json

保存上传索引：

```ts
{
  attachments: [
    {
      id,
      name,
      size,
      mime,
      preview,
      chars,
      path
    }
  ]
}
```

浏览器拿到的是去掉 `path` 的公开视图。绝对路径只在服务端和提示词中流转。

### resumes.json

保存每个会话的简历版本：

```ts
{
  version: 1,
  conversations: {
    [conversationId]: [
      {
        id,
        kind,
        label,
        fileName,
        path,
        pdfPath?,
        createdAt,
        chars,
        source,
        needsOcr?
      }
    ]
  }
}
```

三份 JSON 都使用“先写 `.tmp`，再 `rename`”的方式持久化。这样进程在写文件途中崩溃时，原文件通常仍保持完整。

## 4. 类型是怎样跨层传递的

```text
shared/protocol.ts
  |
  +--> server routes 返回 JSON
  +--> runtime 构造 UiEvent
  +--> web/api.ts 接受 SSE
  +--> web/App.tsx 管理 Draft
  +--> web/components.tsx 渲染
```

`shared/tool-payload.ts` 是另一条独立协议：

```text
MCP tool
  -> summary + fenced json
  -> events.ts 解析 artifacts
  -> chat.ts 解析版本信息
  -> UI 显示下载卡片
```

这是整个项目最容易漏掉的设计。工具结果不是纯 JSON，而是：

```text
给模型看的一句话摘要

```json
{
  "ok": true,
  "data": {},
  "artifacts": []
}
```
```

原因：

- 模型最需要自然语言摘要。
- 服务端和前端需要结构化字段。
- Markdown 代码块既便于模型阅读，也能被正则稳定提取。

## 5. 上传链

入口：`POST /api/files`。

```text
multer 接收文件
  -> 写入 workspace/uploads/<uuid>.<ext>
  -> extractDocument 抽文本
  -> 判断 needsOcr
  -> saveAttachment
  -> 如果带 conversationId，则 addOriginal
  -> parseResumeText 生成统计
  -> 返回 Attachment + versions
```

浏览器随后只保存 `attachment.id`。发送消息时，服务端执行：

```text
attachmentIds
  -> resolveAttachments
  -> StoredAttachment[]
  -> buildPrompt
  -> 把绝对路径和字符数加入用户 prompt
```

Agent 看见的是路径，不是文件二进制。

## 6. 一轮对话的完整状态变化

### 浏览器先乐观更新

`App.send()` 立刻把一条本地用户消息加入当前会话，并创建空 `Draft`。页面马上显示用户消息和“思考中”。

### 服务端先落用户消息

`chatRouter.post()` 解析文本和附件，追加真实用户消息到 `conversations.json`，然后开始 SSE。

### DSH 持续发事件

`runtime.ts` 收到 `session.event`，`events.ts` 将它变成：

| DSH 事件 | UiEvent | 页面效果 |
|---|---|---|
| `turn/start` | `turn_start` | 当前没有单独 UI，但用于流顺序 |
| `step/start` | `step_start` | 当前没有单独 UI |
| `tool/call` | `tool_call` | 新增“执行中”工具条 |
| `tool/result` | `tool_result` | 工具条改为完成或失败 |
| `assistant/message` | `assistant` | 更新助手文本与 token |
| `turn/end` | `done` | 表示模型循环结束 |

工具结果末尾若包含 artifact，会额外产生 `artifact` 事件，页面立即显示下载卡片。

### 服务端收集最终消息

`TurnCollector` 把增量 UiEvent 汇总成一个完整 `ChatMessage`：

- 最终文本。
- reasoning。
- 工具调用数组。
- artifacts。
- token usage。
- error。

这个最终消息追加到 `conversations.json`。

### saved 事件完成交接

服务端发送：

```text
event: saved
data: {
  userMessage,
  assistantMessage,
  versions
}
```

前端删除乐观生成的本地用户消息，替换成服务端正式消息，并设置最终版本列表。`Draft` 置空。

### end 事件关闭流

服务端发送 `event: end`，然后 `response.end()`。

## 7. 工具怎样产生简历版本

### resume_rewrite

模型给出结构化 `profile` 和 `headline`。工具：

1. `renderResumeMarkdown()` 生成统一模板。
2. `resolveOutput()` 生成安全且带时间戳的文件名。
3. 写入 `workspace/outputs/*.md`。
4. 返回 artifact。

服务端在 `recordToolArtifacts()` 里识别 `resume_rewrite`：

```text
tool output
  -> decodeToolResult
  -> artifact.path
  -> addOptimized
  -> resumes.json
```

### pdf_generate

模型传入 Markdown 路径。工具：

1. `resolveReadable()` 验证路径位于 workspace 内。
2. 读取 Markdown。
3. 生成 HTML。
4. 用本机 Edge/Chrome 无头模式打印 A4 PDF。
5. 写回 `workspace/outputs/*.pdf`。

服务端识别 `pdf_generate` 后：

```text
data.path
  -> attachPdf
  -> 找到最近一个还没有 PDF 的优化版
```

注意“最近”不是“与 Markdown 文件名严格配对”。这是当前 MVP 的简化语义。

## 8. 流式回复的真实边界

DSH 的工具调用和步骤事件是实时到达的。

但助手正文存在一个产品层限制：

- DSH 在 `assistant/message` 提交时才携带完整文本。
- 服务端没有逐 token 的推送接口。
- 前端 `useTypewriter()` 在整段文本到达后按 18ms 一帧播放。

因此页面上的打字机效果是视觉回放，不是模型生成时的实时 token 流。

这也是 README 特意声明“不伪装正文实时性”的原因。

## 9. 并发模型

### 同一会话

`runtime.ts` 用 `sessionQueues` 实现串行：

```text
turn 1 完成
  -> turn 2 才开始
```

即使浏览器误发两个请求，DSH 同一 session 也不会并发 prompt。

### 不同会话

不同 `sessionId` 的队列互相独立，可以同时对同一个 DSH 运行时执行。

### 服务启动

`getHarness()` 懒启动。第一次请求才付出启动成本和模型握手成本。

### 服务和 DSH 的恢复

Node 服务重启后，`conversations.json` 还有历史，但内存里的 `knownSessions` 为空。下一轮会先调用：

```text
session/resume
```

让 DSH 重新打开它持久化的 session。同一进程里已经打开过的会话不会重复 resume。

## 10. 边界与安全

### Express

- 默认绑定 `127.0.0.1`，不是公网服务。
- 没有登录和权限系统。
- JSON body 限制 2MB。
- 上传限制 20MB，一次一个文件。

### 文件路径

MCP 工具只允许读取 `WORKSPACE_DIR` 内部的文件，只允许写 `OUTPUT_DIR`。

`resolveReadable()` 先 `resolve()`，再用 `startsWith(root + sep)` 做边界判断。

### Agent 能力

`patch.ts` 禁用大量默认工具。模型只剩：

- `resume_parse`
- `resume_rewrite`
- `pdf_generate`

这是一个“能力白名单”设计。

### 数据隐私

项目会把完整对话、附件文本预览和工具输出写入本地 JSON。它不是隐私安全产品，只是单机 MVP。

## 11. 理解源码时的三个陷阱

### 陷阱一：把 `attachmentId` 当作文件内容

不是。服务端根据 id 查路径，再把路径交给模型。

### 陷阱二：以为工具直接返回给浏览器

不是。工具结果先回到模型上下文，同时被服务端事件层解析。前端看到的 artifact 是服务端从工具文本里二次解析出来的。

### 陷阱三：以为页面上的助手消息是边生成边累积

不是。工具状态实时，正文在 `assistant/message` 到达后才是完整字符串，打字机由前端单独回放。

## 12. 下一章

现在先读 `shared/`。那里定义的字段会贯穿后面所有模块。
