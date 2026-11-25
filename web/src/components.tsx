import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  Artifact,
  Attachment,
  ChatMessage,
  Conversation,
  ResumeVersion,
  ToolCallView,
} from "../../shared/protocol";
import { TOOL_LABELS, displayToolName } from "../../shared/protocol";
import { useTypewriter } from "./useTypewriter";

export function Markdown({ text }: { text: string }): React.ReactElement {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const fixed = fixHref(href);
            return fixed === null ? (
              <span>{children}</span>
            ) : (
              <a href={fixed} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/**
 * 模型经常把产物写成 `outputs/xxx.md` 这样的相对路径。
 * 这里把它们改写到 /api/outputs/ 下载路由；无法解析的链接（例如它自己编的
 * uploads/ 路径）降级成纯文本，避免出现点不动的假链接。
 */
function fixHref(href: string | undefined): string | null {
  if (href === undefined) return null;
  if (href.startsWith("outputs/")) {
    const name = href.slice("outputs/".length).split("/").pop() ?? "";
    return `/api/outputs/${encodeURIComponent(name)}`;
  }
  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("/api/")) {
    return href;
  }
  return null;
}

export function ToolList({ calls }: { calls: ToolCallView[] }): React.ReactElement {
  return (
    <div className="tools">
      {calls.map((call) => (
        <div key={call.callId} className={`tool ${call.status}`} title={call.args}>
          <span className="dot" />
          <span className="name">{TOOL_LABELS[call.name] ?? displayToolName(call.name)}</span>
          <span>
            {call.status === "running" ? "执行中…" : call.status === "ok" ? "已完成" : "失败"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ArtifactList({ artifacts }: { artifacts: Artifact[] }): React.ReactElement {
  return (
    <div className="artifacts">
      {artifacts.map((artifact) => (
        <div className="artifact" key={artifact.url}>
          <div className="icon">{artifact.name.toLowerCase().endsWith(".pdf") ? "PDF" : "MD"}</div>
          <div className="info">
            <div className="fname" title={artifact.name}>
              {artifact.name}
            </div>
            <div className="fsize">{formatBytes(artifact.bytes)}</div>
          </div>
          <a href={artifact.url} download>
            下载
          </a>
        </div>
      ))}
    </div>
  );
}

export function MessageItem({
  message,
  animate,
  streaming,
}: {
  message: ChatMessage;
  animate?: boolean;
  streaming?: boolean;
}): React.ReactElement {
  if (message.role === "user") {
    return (
      <div className="msg user">
        <div className="bubble">
          {message.text}
          {message.attachments !== undefined && message.attachments.length > 0 && (
            <div className="user-attachments">
              {message.attachments.map((item) => (
                <span className="chip" key={item.id}>
                  📎 {item.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="msg assistant">
      <div className="avatar">R</div>
      <div className="body">
        {message.toolCalls !== undefined && message.toolCalls.length > 0 && (
          <ToolList calls={message.toolCalls} />
        )}
        <AssistantBody
          text={message.text}
          reasoning={message.reasoning}
          animate={animate === true}
          streaming={streaming === true}
        />
        {message.artifacts !== undefined && message.artifacts.length > 0 && (
          <ArtifactList artifacts={message.artifacts} />
        )}
        {message.error !== undefined && <div className="error-text">{message.error}</div>}
        <MessageMeta message={message} />
      </div>
    </div>
  );
}

function MessageMeta({ message }: { message: ChatMessage }): React.ReactElement | null {
  if (message.usage === undefined) return null;
  return (
    <div className="meta">
      <span>
        输入 {message.usage.input.toLocaleString()} · 输出 {message.usage.output.toLocaleString()} tokens
      </span>
      {message.usage.cacheRead > 0 && <span>缓存命中 {message.usage.cacheRead.toLocaleString()}</span>}
    </div>
  );
}

function AssistantBody({
  text,
  reasoning,
  animate,
  streaming,
}: {
  text: string;
  reasoning?: string;
  animate: boolean;
  streaming: boolean;
}): React.ReactElement {
  const shown = useTypewriter(text, animate);
  const typing = streaming && shown.length < text.length;

  return (
    <>
      {reasoning !== undefined && reasoning !== "" && (
        <details style={{ marginBottom: 8 }}>
          <summary style={{ cursor: "pointer", color: "#6b7280", fontSize: 12.5 }}>思考过程</summary>
          <div style={{ color: "#4b5563", fontSize: 13, whiteSpace: "pre-wrap", marginTop: 6 }}>
            {reasoning}
          </div>
        </details>
      )}
      {shown !== "" || !typing ? (
        <Markdown text={shown} />
      ) : (
        <div className="md">
          <p>
            <span className="typing" />
          </p>
        </div>
      )}
      {typing && shown !== "" && <span className="typing" />}
    </>
  );
}

export function Composer({
  busy,
  attachments,
  onAttach,
  onRemoveAttachment,
  onSend,
  uploading,
  value,
  onChange,
  disabledReason,
}: {
  busy: boolean;
  attachments: Attachment[];
  onAttach: (file: File) => void;
  onRemoveAttachment: (id: string) => void;
  onSend: (text: string) => void;
  uploading: boolean;
  value: string;
  onChange: (value: string) => void;
  disabledReason?: string;
}): React.ReactElement {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const area = areaRef.current;
    if (area === null) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 200)}px`;
  }, [value]);

  const canSend = !busy && !uploading && (value.trim() !== "" || attachments.length > 0);

  const submit = (): void => {
    if (!canSend) return;
    onSend(value.trim());
    onChange("");
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((item) => (
              <span className="chip" key={item.id}>
                📎 {item.name}
                <button className="x" onClick={() => onRemoveAttachment(item.id)} aria-label="移除附件">
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={areaRef}
          rows={1}
          value={value}
          placeholder={disabledReason ?? "粘贴岗位 JD，或直接说「帮我改简历」…  Enter 发送，Shift+Enter 换行"}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          disabled={disabledReason !== undefined}
        />
        <div className="row">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.md,.txt,.markdown"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) onAttach(file);
              event.target.value = "";
            }}
          />
          <button className="attach" onClick={() => fileRef.current?.click()} disabled={busy}>
            {uploading ? "上传中…" : "＋ 上传简历"}
          </button>
          <span className="hint">支持 PDF / DOCX / MD / TXT，≤ 20MB</span>
          <button className="send" onClick={submit} disabled={!canSend}>
            {busy ? "思考中…" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}): React.ReactElement {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">R</div>
        <div>
          <div className="brand-name">ResumeAgent</div>
          <div className="brand-sub">对话式简历顾问</div>
        </div>
      </div>

      <button className="new-chat" onClick={onNew}>
        ＋ 新对话
      </button>

      <div className="chat-list">
        {conversations.map((conversation) => (
          <button
            key={conversation.id}
            className={`chat-item ${conversation.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(conversation.id)}
            title={conversation.title}
          >
            <span>{conversation.title}</span>
            <button
              className="del"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(conversation.id);
              }}
              aria-label="删除对话"
            >
              ×
            </button>
          </button>
        ))}
      </div>

      <div className="sidebar-foot">
        本地单机 MVP · deepseek-flash
        <br />
        Agent Runtime: DeepSeek Harness
      </div>
    </aside>
  );
}

export function Hero({ onPick }: { onPick: (text: string) => void }): React.ReactElement {  const starters = [
    {
      title: "诊断我的简历",
      detail: "上传简历 + 粘贴 JD，给出匹配度与缺口",
      text: "我先上传一份简历，请帮我看看和目标岗位的差距。",
    },
    {
      title: "按岗位改写",
      detail: "保留事实，重写要点与措辞",
      text: "帮我按目标岗位改写这份简历，不要编造经历。",
    },
    {
      title: "导出 PDF",
      detail: "A4 排版，可直接投递",
      text: "把改写后的简历导出成 PDF。",
    },
  ];

  return (
    <div className="hero">
      <h2>把简历交给一位懂招聘的面试官</h2>
      <p>上传简历、贴上 JD，多轮打磨，最后导出 PDF。</p>
      <div className="starters">
        {starters.map((item) => (
          <button className="starter" key={item.title} onClick={() => onPick(item.text)}>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function VersionsDrawer({
  open,
  versions,
  onClose,
}: {
  open: boolean;
  versions: ResumeVersion[];
  onClose: () => void;
}): React.ReactElement | null {
  if (!open) return null;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <h2>简历版本</h2>
            <p>原始简历与每个优化版本都保留，可随时下载对比。</p>
          </div>
          <button className="close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="drawer-body">
          {versions.length === 0 && (
            <div className="drawer-empty">还没有简历。上传 PDF 后会自动记录为「原始简历」。</div>
          )}
          {versions.map((version) => (
            <div className={`version ${version.kind}`} key={version.id}>
              <span className={`vbadge ${version.kind}`}>
                {version.kind === "original" ? "原始" : "优化"}
              </span>
              <div className="vinfo">
                <div className="vlabel">{version.label}</div>
                <div className="vfile" title={version.fileName}>
                  {version.fileName} · {version.chars} 字
                </div>
              </div>
              <div className="vlinks">
                {version.pdfUrl !== undefined && (
                  <a href={version.pdfUrl} download>
                    PDF
                  </a>
                )}
                <a href={version.downloadUrl} download>
                  {version.kind === "original" ? "原件" : "Markdown"}
                </a>
              </div>
              {version.needsOcr === true && <div className="vwarn">扫描件 PDF，暂不支持 OCR</div>}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
