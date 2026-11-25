# 07 - React 前端

这一章覆盖浏览器端的全部手写代码：

| 文件 | 行号 |
|---|---|
| `web/src/api.ts` | 1-122 |
| `web/src/useTypewriter.ts` | 1-45 |
| `web/src/main.tsx` | 1-13 |
| `web/src/App.tsx` | 1-349 |
| `web/src/components.tsx` | 1-442 |
| `web/src/styles.css` | 1-898 |

## 1. web/src/api.ts

### 行 1-3：依赖与职责

这里没有引入 axios，而是使用浏览器原生 `fetch`。API 客户端负责：

- 会话 CRUD。
- 上传。
- 版本读取。
- POST + SSE 手工解析。

### 行 5-10：SavedPayload 和 ChatMessageLike

```ts
export interface SavedPayload {
  userMessage: ChatMessageLike;
  assistantMessage: ChatMessageLike;
}

export type ChatMessageLike =
  Conversation["messages"][number];
```

`ChatMessageLike` 是索引访问类型：从 Conversation 的 messages 数组取元素类型。

这避免再手写一遍 `ChatMessage`。`SavedPayload` 当前没有被 App 直接导入，App 使用了内联类型；它是协议辅助类型。

### 行 12-19：readError

```ts
try {
  const payload = await response.json() as { error?: string };
  return new Error(
    payload.error ??
      `请求失败（HTTP ${response.status}）`,
  );
} catch {
  return new Error(`请求失败（HTTP ${response.status}）`);
}
```

优先读取服务端的 `{ error }`。如果响应不是 JSON，回退成状态码消息。

### 行 21-24：getJson

```ts
if (!response.ok) throw await readError(response);
return (await response.json()) as T;
```

`fetch` 本身不会因 4xx/5xx 抛错，因此必须显式检查 `response.ok`。

### 行 26-36：会话列表和创建

两者都用 `getJson` 解包。

创建：

```ts
fetch("/api/conversations", { method: "POST" })
```

没有 body。服务端不要求。

### 行 38-40：删除

```ts
await fetch(`/api/conversations/${id}`, {
  method: "DELETE",
});
```

这里没有检查 `response.ok`，也没有解析 `ok: false`。删除失败时前端仍会刷新列表，最终以列表结果为准。

### 行 42-47：UploadResult

与上传路由响应对应：

- `attachment`
- `needsOcr`
- `structure`
- 可选 `versions`

### 行 49-56：uploadFile

```ts
const form = new FormData();
form.append("file", file);
if (conversationId !== undefined && conversationId !== "") {
  form.append("conversationId", conversationId);
}
return getJson<UploadResult>(
  await fetch("/api/files", {
    method: "POST",
    body: form,
  }),
);
```

不要把 `FormData` 手动设置 `Content-Type`。浏览器会自动加 boundary。

### 行 58-63：fetchVersions

调用：

```text
GET /api/conversations/:id/resumes
```

### 行 65-68：StreamEvent

```ts
export interface StreamEvent {
  event: string;
  data: unknown;
}
```

SSE 的 data 是 JSON 解析后的未知值，调用方按 event 名称断言。

### 行 70-81：streamMessage 开始

```ts
export async function* streamMessage(
  conversationId,
  body,
  signal,
): AsyncGenerator<StreamEvent> {
  const response = await fetch(..., {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
```

为什么手写 SSE：

- 浏览器 `EventSource` 只支持 GET。
- 发消息需要 POST body。
- 项目使用 `fetch` 的 ReadableStream。

`signal` 允许未来取消请求。当前 App 创建了 AbortController，但没有用户触发 abort 的入口。

### 行 83-88：初始化和读取器

```ts
if (!response.ok) throw await readError(response);
if (response.body === null) throw new Error(...);

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
```

`TextDecoder` 处理跨 chunk 的多字节 UTF-8。

### 行 90-103：读取循环

```ts
const { done, value } = await reader.read();
if (done) break;
buffer += decoder.decode(value, { stream: true });

let boundary = buffer.indexOf("\n\n");
while (boundary >= 0) {
  const block = buffer.slice(0, boundary);
  buffer = buffer.slice(boundary + 2);
  const parsed = parseBlock(block);
  if (parsed !== null) yield parsed;
  boundary = buffer.indexOf("\n\n");
}
```

SSE 事件以两个 LF 分隔。服务器固定发 `\n\n`。

`stream: true` 告诉 decoder 当前 chunk 可能只包含一个字符的一部分，不要急着替换成 U+FFFD。

重要边界：

- 一个网络 chunk 可以包含半个事件。
- 也可以包含多个完整事件。
- buffer 保证只处理完整块。

### 行 106-120：parseBlock

```ts
let event = "message";
const dataLines: string[] = [];

for (const line of block.split("\n")) {
  if (line.startsWith(":")) continue;
  if (line.startsWith("event:")) {
    event = line.slice(6).trim();
  } else if (line.startsWith("data:")) {
    dataLines.push(line.slice(5).trimStart());
  }
}
```

行为：

- 冒号开头是心跳/注释，跳过。
- event 字段取事件名。
- 多行 data 收集后拼接。
- JSON 解析失败返回 null。

第 112 行使用 `trimStart()` 而不是 `trim()`，保留 data 内容尾部空格。SSE 规范规定只去掉冒号后一个可选空格，这里近似实现。

### 行 122：重新导出 UiEvent

让组件可以只从 api 模块导入这个类型。当前 App 实际直接从 shared 导入，不影响行为。

## 2. web/src/useTypewriter.ts

### 行 1：React Hooks

### 行 3-6：设计说明

DSH 在消息完成时才提交整段文本。这个 Hook 在客户端按帧回放打字机效果。

### 行 7-9：初始状态

```ts
const [shown, setShown] =
  useState(enabled ? "" : target);
const shownRef = useRef(enabled ? "" : target);
```

为什么同时需要 state 和 ref：

- state 触发 React 重渲染。
- ref 让定时器回调读到最新已显示长度，不受闭包旧值影响。

### 行 11-16：disabled 分支

```ts
if (!enabled) {
  shownRef.current = target;
  setShown(target);
  return;
}
```

不需要动画时立即显示全文。

### 行 17-21：目标变化保护

```ts
if (!target.startsWith(shownRef.current)) {
  shownRef.current = "";
  setShown("");
}
if (shownRef.current === target) return;
```

如果新 target 不是当前显示内容的前缀，说明消息被替换而不是追加，重置从头播放。

### 行 23-25：取消标记和 timer

```ts
let cancelled = false;
let timer = 0;
```

用于清理。

### 行 26-35：tick

```ts
const remaining =
  target.length - shownRef.current.length;
if (remaining <= 0) return;

const step = Math.max(
  1,
  Math.ceil(remaining / 18),
);
shownRef.current = target.slice(
  0,
  shownRef.current.length + step,
);
setShown(shownRef.current);
timer = window.setTimeout(tick, 18);
```

节奏：

- 每 18ms 一帧。
- 剩余越多，单帧字符越多。
- 大约在 18 帧内追上目标，视觉上不像逐字等太久。

### 行 37-41：首次 tick 和 cleanup

```ts
tick();
return () => {
  cancelled = true;
  window.clearTimeout(timer);
};
```

React 对 target/enabled 变化会清理上一次 effect，避免多个定时器同时推进。

### 行 44：返回值

```ts
return enabled ? shown : target;
```

disabled 时不等待 state 同步，直接返回目标。

## 3. web/src/main.tsx

### 行 1-4：React 入口

`StrictMode` 在开发模式会故意重复执行部分 effect，帮助发现副作用问题。

### 行 6-7：root

```ts
const container =
  document.getElementById("root");
if (container === null) {
  throw new Error("缺少 #root 容器");
}
```

没有 root 时立即失败，避免静默空白页。

### 行 9-13：render

```tsx
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

## 4. web/src/App.tsx

### 行 1-13：imports

App 负责页面级状态，不负责低层渲染。组件在 components.tsx。

### 行 15-21：Draft

```ts
interface Draft {
  text: string;
  reasoning?: string;
  toolCalls: ToolCallView[];
  artifacts: Artifact[];
  error?: string;
}
```

这是“正在生成、尚未 saved”的助手消息。

### 行 23-26：Health

只声明实际使用的字段：

```ts
runtime.model
runtime.started
observability
```

### 行 28：EMPTY_DRAFT

每个新 Draft 展开它，避免共享引用：

```ts
setDraft({ ...EMPTY_DRAFT });
```

注意展开是浅拷贝：`toolCalls` 和 `artifacts` 数组仍会被新对象引用，但后续总是通过新数组创建，不直接 push。

### 行 30-43：状态与 ref

状态：

- conversations：左侧列表。
- active：当前会话。
- draft：流式助手状态。
- busy：是否有 turn 运行。
- uploading：上传中。
- attachments：待发送附件。
- input：输入框。
- health：运行时信息。
- versions：版本抽屉。
- drawerOpen。
- notice。

refs：

- scrollRef：消息滚动容器。
- bootstrapped：防止开发模式重复初始化。

### 行 45-49：refreshList

```ts
const refreshList = useCallback(async () => {
  const list = await api.listConversations();
  setConversations(list);
  return list;
}, []);
```

`useCallback` 保持函数引用稳定，供 effect 依赖。

### 行 51-78：首次启动 effect

```ts
if (bootstrapped.current) return;
bootstrapped.current = true;
```

防止 StrictMode 第二次 effect 重复创建会话。

会话启动：

1. 拉列表。
2. 空列表创建一个会话。
3. 非空选择第一个。

健康检查并行执行：

```ts
fetch("/api/health")
```

失败时 health 设 null，页面仍可运行，只是 badge 显示默认值。

### 行 80-84：滚动到底

```ts
element.scrollTop = element.scrollHeight;
```

依赖：

- `active?.messages`
- `draft`

每次消息数组或草稿变化都自动滚到底。

### 行 86-105：切换会话时读取版本

```ts
let cancelled = false;
void api.fetchVersions(conversationId)
  .then(items => {
    if (!cancelled) setVersions(items);
  })
  .catch(() => {
    if (!cancelled) setVersions([]);
  });
return () => {
  cancelled = true;
};
```

防止快速切换会话时旧请求覆盖新会话版本。

### 行 107-111：openConversation

从已加载列表找会话。若找不到，设为 null。

### 行 113-120：newConversation

创建后：

- 插到列表顶部。
- 设为 active。
- 清空 draft、附件、输入。

版本 effect 会因为 active.id 变化自动拉取，空会话返回空数组。

### 行 122-129：removeConversation

删除后重新拉列表。如果删的是当前会话，选择列表第一条或 null。

这里没有关闭 drawer，也没有清理 attachments；删除当前会话时 draft 清空，但待发送附件仍保留。重新发送时会绑定到新会话。

### 行 131-151：attach

```ts
setUploading(true);
setNotice(null);
try {
  const result = await api.uploadFile(file, active?.id);
  setAttachments(prev => [...prev, result.attachment]);
  if (result.versions !== undefined) {
    setVersions(result.versions);
  }
  ...
} finally {
  setUploading(false);
}
```

上传成功立即登记原始版并更新 drawer 数据。

扫描件提示和普通提示分两路。

### 行 153-157：send 开始

```ts
const target =
  active ?? (await api.createConversation());
if (active === null) setActive(target);
if (busy) return;
```

设计意图是允许空状态下直接发送时自动建会话。

当前顺序有一个小问题：如果 active 为 null 且 busy 为 true，会先创建会话，再因 busy 返回。正常 UI 很难进入这个状态。

### 行 158-164：乐观用户消息

```ts
const userMessage: ChatMessage = {
  id: `local-${Date.now()}`,
  role: "user",
  text,
  ...(attachments.length === 0
    ? {}
    : { attachments }),
  createdAt: new Date().toISOString(),
};
```

local id 用于后续替换。

### 行 166-172：立即更新 UI

```ts
setActive(prev =>
  prev === null
    ? prev
    : {
        ...prev,
        messages: [
          ...prev.messages,
          userMessage,
        ],
      },
);
setInput("");
setAttachments([]);
setDraft({ ...EMPTY_DRAFT });
setBusy(true);
```

用户马上看到自己的消息和空助手气泡。

### 行 174：AbortController

当前创建后没有取消按钮使用，也没有在 finally 中 abort。

### 行 176-180：消费 SSE

```ts
for await (
  const event of api.streamMessage(
    target.id,
    {
      text,
      attachmentIds: attachments.map(
        item => item.id,
      ),
    },
    controller.signal,
  )
) { ... }
```

注意闭包中的 `attachments` 是 send 开始时的数组。随后 setAttachments([]) 不会影响这里。

### 行 181-182：ui 事件

```ts
applyUiEvent(
  event.data as UiEvent,
  setDraft,
);
```

### 行 183-204：saved 事件

```ts
const saved = event.data as {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  versions?: ResumeVersion[];
};
```

更新 active：

```ts
messages: [
  ...prev.messages.filter(
    item => item.id !== userMessage.id,
  ),
  saved.userMessage,
  saved.assistantMessage,
],
```

只删除本地乐观消息，保留之前历史。

最后：

```ts
if (saved.versions !== undefined) {
  setVersions(saved.versions);
}
setDraft(null);
```

### 行 206-210：网络/流错误

如果 for-await 抛错，把错误写进 draft。页面仍显示部分内容。

### 行 211-214：finally

```ts
setBusy(false);
void refreshList();
```

刷新会话列表，让标题和 updatedAt 排序更新。

### 行 217：messages

```ts
const messages = active?.messages ?? [];
```

### 行 219-239：页面骨架

- Sidebar。
- main。
- topbar。
- 版本按钮。

### 行 241-275：消息区域

空状态条件：

```ts
messages.length === 0 && draft === null
```

显示 Hero。

否则显示 thread：

- 已保存消息。
- draft。

最后一条已保存 assistant 消息在 draft 为 null 时会播放打字机：

```ts
animate={
  message.role === "assistant" &&
  index === messages.length - 1 &&
  draft === null
}
```

这会导致刷新页面后，最后一条历史助手消息也重新打字一次。

### 行 277-284：notice

上传提示条，可关闭。

### 行 286-295：Composer

把状态和回调传入。所有异步回调使用 `void` 表示不等待。

### 行 298：VersionsDrawer

即使关闭，组件也始终挂载；组件内部在 open 为 false 时返回 null。

### 行 303-349：applyUiEvent

这是一个纯状态归约函数，通过 `setDraft` 的函数式更新读取最新 prev。

#### assistant

```ts
text: event.text === ""
  ? draft.text
  : event.text,
```

空文本不覆盖。

#### tool_call

先过滤同 callId，再追加新的 running call。这样重复事件不会重复显示。

#### tool_result

只映射匹配 callId 的项。

#### artifact

按 URL 去重。

#### error

写入 error 字符串。

#### default

`turn_start`、`step_start`、`done` 保持 draft 不变。

## 5. web/src/components.tsx

### 行 1-13：依赖

- React hooks。
- react-markdown。
- remark-gfm，支持表格、任务列表等 GitHub 风格。
- 共享协议类型。
- 工具标签。
- 打字机 Hook。

### 行 15-37：Markdown

```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  components={{
    a: ({ href, children }) => {
      const fixed = fixHref(href);
      return fixed === null
        ? <span>{children}</span>
        : <a href={fixed} ...>{children}</a>;
    },
  }}
>
  {text}
</ReactMarkdown>
```

只覆盖 `a` 组件，其余 HTML 由 react-markdown 默认安全渲染。

`target="_blank"` 新窗口打开，`noreferrer noopener` 防止 opener 访问。

### 行 39-54：fixHref

规则：

- `outputs/xxx.md` -> `/api/outputs/xxx.md`
- http/https -> 原样
- `/api/...` -> 原样
- 其他相对链接 -> null，降级纯文本

```ts
const name =
  href.slice("outputs/".length)
    .split("/")
    .pop() ?? "";
```

只保留最后一段，防止模型生成 `outputs/../../` 之类路径。

### 行 56-70：ToolList

```tsx
<div
  className={`tool ${call.status}`}
  title={call.args}
>
  <span className="dot" />
  <span className="name">
    {TOOL_LABELS[call.name] ??
      displayToolName(call.name)}
  </span>
  <span>
    {call.status === "running"
      ? "执行中…"
      : call.status === "ok"
        ? "已完成"
        : "失败"}
  </span>
</div>
```

class 同时包含 `tool` 和状态，CSS 用状态切换圆点颜色。

工具参数放在原生 title，鼠标悬停可看原始 JSON。

### 行 72-91：ArtifactList

每个 artifact：

- PDF 或 MD 图标文字。
- 文件名。
- 格式化大小。
- 下载链接。

```tsx
<a href={artifact.url} download>
  下载
</a>
```

`download` 让浏览器倾向下载而不是导航。

### 行 93-142：MessageItem

用户消息分支：

```tsx
<div className="msg user">
  <div className="bubble">
    {message.text}
    {attachments...}
  </div>
</div>
```

用户正文不做 Markdown 渲染，保留 `white-space: pre-wrap` 的换行。

附件 chip 使用 emoji 回形针。项目已有该字符，不是新引入的设计系统图标。

助手分支顺序：

1. 工具列表。
2. 正文。
3. 产物。
4. 错误。
5. token 元信息。

### 行 144-154：MessageMeta

只有 usage 存在才显示。

```ts
message.usage.input.toLocaleString()
```

使用用户区域格式加千分位。

缓存命中大于 0 才显示。

### 行 156-192：AssistantBody

```ts
const shown = useTypewriter(text, animate);
const typing =
  streaming &&
  shown.length < text.length;
```

`typing` 只有在 streaming 请求期间且显示落后于全文时为 true。

reasoning 用 `<details>` 折叠，默认收起。

正文显示规则：

- 有内容，或已经停止 typing，显示 Markdown。
- 完全空且正在 typing，显示单独闪烁光标。

如果已有部分正文且还在 typing，在 Markdown 后面追加光标。

### 行 194-216：Composer 参数

refs：

- `areaRef`：textarea。
- `fileRef`：隐藏 file input。

### 行 218-223：自动高度

```ts
area.style.height = "auto";
area.style.height =
  `${Math.min(area.scrollHeight, 200)}px`;
```

先把高度设 auto，浏览器才能重新计算内容高度。最大 200px，超过后 textarea 内部滚动。

### 行 225：canSend

```ts
const canSend =
  !busy &&
  !uploading &&
  (value.trim() !== "" ||
    attachments.length > 0);
```

满足：

- 不在思考。
- 不在上传。
- 有文字或有附件。

### 行 227-231：submit

```ts
if (!canSend) return;
onSend(value.trim());
onChange("");
```

父组件 App.send 也会清空，但 Composer 先清了一次。

### 行 233-247：附件列表

每个 chip 带移除按钮。

注意 button 没有 `type="button"`。当前不在 form 中，因此不会触发表单提交。

### 行 248-261：textarea

- `rows={1}` 初始高度。
- 受控组件。
- placeholder。
- Enter 发送。
- Shift+Enter 默认换行。
- `disabledReason` 存在时禁用。

当前 App 没有传 `disabledReason`，所以 textarea 在 busy 时仍可编辑。发送按钮会被 `canSend` 禁用。

### 行 262-281：底部操作栏

文件 input：

```tsx
accept=".pdf,.docx,.md,.txt,.markdown"
```

这里没有 `.doc`，虽然服务端白名单有 `.doc`。用户通过文件选择器无法选旧 doc，但拖拽/手工构造请求仍可能到服务端。

文件选择后：

```ts
if (file !== undefined) onAttach(file);
event.target.value = "";
```

重置 input 值，允许再次选择同一个文件。

上传按钮 disabled 只检查 `busy`，不检查 `uploading`。上传期间仍可再次打开文件选择器。

提示文案写死 20MB，与服务端限制一致。

### 行 287-344：Sidebar

品牌区、新对话按钮、会话列表、底部版本说明。

会话项：

```tsx
<button className="chat-item">
  <span>{title}</span>
  <button className="del">×</button>
</button>
```

这里存在 HTML 语义问题：button 内嵌套 button 不合法。浏览器通常仍能点击，但键盘和辅助技术行为可能不理想。删除按钮通过 `stopPropagation()` 防止同时选中会话。

### 行 346-378：Hero

`starters` 是三个快捷提示：

- 诊断简历。
- 按岗位改写。
- 导出 PDF。

点击只把文本放进输入框，不自动发送。这与 App 的 onPick 一致。

### 行 380-436：VersionsDrawer

关闭状态：

```ts
if (!open) return null;
```

backdrop 点击关闭。

drawer 自身：

```tsx
<aside
  className="drawer"
  onClick={event => event.stopPropagation()}
>
```

阻止冒泡，点击抽屉内部不会关闭。

每个版本：

- 原始/优化 badge。
- label。
- 文件名和字符数。
- PDF 下载按钮（如有）。
- 原件或 Markdown 下载。
- 扫描件警告。

当前没有键盘 Esc 关闭、focus trap 或 aria-modal。对内部工具可以工作，但无障碍不完整。

### 行 438-442：formatBytes

显示规则：

```text
< 1024 B      -> B
< 1MB         -> KB，0 位小数
>= 1MB        -> MB，1 位小数
```

## 6. web/src/styles.css

这个文件没有组件作用域，所有 class 都是全局。行号按选择器块逐段解释。

### 行 1-15：主题变量

```css
:root {
  --bg: #f7f7f8;
  --panel: #ffffff;
  --sidebar: #fbfbfc;
  --ink: #1a1d21;
  --muted: #6b7280;
  --line: #e5e7eb;
  --accent: #2563eb;
  --accent-soft: #eef3ff;
  --danger: #d93025;
  --ok: #15803d;
  --shadow: ...;
  --radius: 14px;
  color-scheme: light;
}
```

定义颜色、阴影和圆角。`color-scheme: light` 告诉浏览器原生控件使用浅色。

`--panel` 和 `--radius` 当前使用不多，属于可复用变量。

### 行 17-19：box-sizing

所有元素宽高包含 padding 和 border，避免布局溢出。

### 行 21-25：根高度

```css
html, body, #root { height: 100%; }
```

让应用能占满视口，并让内部 `.scroll` 成为独立滚动区。

### 行 27-35：body

- 去掉默认 margin。
- 浅灰背景。
- 深色正文。
- 中文字体优先。
- 15px 字号、1.7 行高。
- 字体抗锯齿。

### 行 37-40：button

继承字体，显示手型光标。

### 行 42-46：app

```css
display: grid;
grid-template-columns: 264px 1fr;
height: 100%;
```

固定侧栏 264px，主区域占剩余空间。

### 行 48-57：sidebar

纵向 flex，12px 间距，右侧边框，`min-height: 0` 允许内部列表滚动。

### 行 59-86：brand

品牌行、28px 渐变方块、主标题、副标题。

### 行 88-105：new-chat

白底按钮、10px 圆角、边框和 hover 阴影。

### 行 107-114：chat-list

```css
flex: 1;
overflow-y: auto;
```

吃掉侧栏剩余高度，会话多时自己滚动。

### 行 116-158：chat-item 和删除按钮

会话项：

- flex 排列。
- 透明背景。
- 文字左对齐。
- 宽度 100%。

标题 span：

```css
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;
```

长标题不换行，用省略号。

删除按钮默认 opacity 0，hover 会话项时显示。

### 行 160-166：sidebar-foot

小号灰色说明，顶部边框。

### 行 168-174：main

纵向 flex，`min-width: 0` 和 `min-height: 0` 防止 flex/grid 子项被内容撑破。

### 行 176-193：topbar

横向排列，半透明白底和 backdrop blur。

标题单行省略。

### 行 195-214：badge

胶囊状小标签。

- `.ok` 绿色。
- `.warn` 黄色。

### 行 216-228：scroll 和 thread

scroll 是主消息滚动区，padding 上下不同。

thread 最大 820px 居中，消息间距 26px。

### 行 230-281：Hero

Hero 最大 720px，顶部留出 `8vh`，居中。

标题 26px，说明灰色，快捷卡片自适应网格：

```css
grid-template-columns:
  repeat(auto-fit, minmax(220px, 1fr));
```

每张卡片 hover 上移 1px 并加阴影。

### 行 283-300：消息通用和用户气泡

`.msg` 横向 flex。

用户消息右对齐，气泡：

- 浅灰背景。
- 不对称圆角。
- 最大宽度 78%。
- 保留换行。
- 长单词换行。

### 行 302-319：助手头像和正文

头像 28px，渐变背景。

正文 `flex: 1` 并 `min-width: 0`，防止长 Markdown 撑开。

### 行 321-338：meta 和错误

token 元信息灰色、可换行。

错误文本红色浅底卡片。

### 行 340-355：typing 光标

7x15px 蓝色块，用 `steps(2, start)` 每 1 秒闪烁。

### 行 357-425：Markdown 样式

- 首尾元素去掉多余 margin。
- h1/h2/h3 字号和间距。
- 列表缩进。
- 行内 code 灰底等宽。
- pre 灰底、边框、横向滚动。
- blockquote 左蓝边。

### 行 427-443：表格

合并边框，宽度 100%，单元格边框和内边距，表头浅灰。

### 行 445-497：工具状态

`.tool` 是 fit-content 的横向条。

圆点状态：

- 默认灰。
- running 蓝且 pulse。
- ok 绿。
- error 红。

`pulse` 在 50% 时透明度降到 0.35。

### 行 499-559：产物卡片

artifact 卡片：

- 横向排列。
- 白色、边框、11px 圆角。
- 最小宽度 260px。
- 阴影。

图标、文件名、大小和下载按钮分别布局。文件名单行省略。

### 行 561-639：输入区

composer-wrap 底部有向上透明渐变，让消息在输入框上方自然淡出。

composer：

- 最大 820px。
- 18px 圆角。
- 白底和阴影。
- focus-within 时边框变蓝。

textarea 没有 outline，高度由 JS 控制。

发送按钮：

- 蓝色。
- disabled 时透明度和禁用光标。
- hover 上移。

### 行 641-681：附件 chip

附件 chip 使用 flex 和圆角胶囊，最大宽度 260px。

移除按钮默认灰色，hover 变红。

用户消息中的附件 chip 背景改白色。

### 行 683-693：移动端断点

屏幕宽度小于等于 860px：

- app 变单列。
- sidebar 完全隐藏。
- 用户气泡最大宽度提高到 88%。

当前没有移动端汉堡菜单或会话切换替代入口。

### 行 695-721：版本按钮

位于 topbar 右侧：

```css
margin-left: auto;
```

胶囊按钮和计数 badge。

### 行 723-745：notice

黄色提示条，最大 820px 居中，关闭按钮在右侧。

### 行 747-761：drawer backdrop

固定全屏覆盖层，半透明黑色，flex 右对齐，z-index 30，淡入动画。

### 行 763-780：drawer

宽度 `min(400px, 92vw)`，全高，左侧边框，阴影，右侧滑入动画。

### 行 781-807：drawer head

标题、说明、关闭按钮。关闭按钮用 `margin-left: auto` 推到右边。

### 行 809-823：drawer body 和空状态

body 占满剩余高度，自己纵向滚动。

### 行 825-855：version 卡片和 badge

version 卡片 flex、可换行。

原始版浅灰背景。

vbadge：

- original 灰色。
- optimized 蓝色。

### 行 857-873：版本信息

`vinfo` 是 `min-width: 0; flex: 1`，允许文件名正确省略。

### 行 875-889：版本下载链接

横向排列，蓝色浅底按钮。

### 行 891-898：扫描件警告

`flex-basis: 100%` 让警告占满版本卡片下一行，黄色底。

## 7. 前端状态的三个副本

读前端时要注意同一个会话在内存里可能有三种表现：

1. `conversations` 列表中的摘要。
2. `active` 中当前完整会话。
3. `draft` 中尚未保存的助手输出。

`saved` 事件负责把 3 合并回 2，并最终由 `refreshList()` 更新 1。

## 8. 本章完成后应能回答

- 为什么 EventSource 不能直接用于这个项目？
- TextDecoder 为什么必须使用 stream 模式？
- 乐观消息如何被服务端消息替换？
- 为什么工具状态是实时的，而正文是打字机回放？
- Draft 与已保存 ChatMessage 有什么区别？
- 版本抽屉在哪个 effect 中加载？
- 移动端隐藏侧栏后还有哪些导航入口？
