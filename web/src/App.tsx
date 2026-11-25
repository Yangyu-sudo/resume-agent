import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Artifact,
  Attachment,
  ChatMessage,
  Conversation,
  ResumeVersion,
  ToolCallView,
  UiEvent,
} from "../../shared/protocol";
import { displayToolName } from "../../shared/protocol";
import * as api from "./api";
import { Composer, Hero, MessageItem, Sidebar, VersionsDrawer } from "./components";

interface Draft {
  text: string;
  reasoning?: string;
  toolCalls: ToolCallView[];
  artifacts: Artifact[];
  error?: string;
}

interface Health {
  runtime: { model: string; started: boolean };
  observability: boolean;
}

const EMPTY_DRAFT: Draft = { text: "", toolCalls: [], artifacts: [] };

export default function App(): React.ReactElement {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [input, setInput] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bootstrapped = useRef(false);

  const refreshList = useCallback(async (): Promise<Conversation[]> => {
    const list = await api.listConversations();
    setConversations(list);
    return list;
  }, []);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    void (async () => {
      try {
        const list = await refreshList();
        if (list.length === 0) {
          const created = await api.createConversation();
          setConversations([created]);
          setActive(created);
        } else {
          setActive(list[0] ?? null);
        }
      } catch (error) {
        console.error(error);
      }
    })();

    void (async () => {
      try {
        const response = await fetch("/api/health");
        setHealth((await response.json()) as Health);
      } catch {
        setHealth(null);
      }
    })();
  }, [refreshList]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    element.scrollTop = element.scrollHeight;
  }, [active?.messages, draft]);

  // 切换会话时同步该会话的简历版本（原始 + 已生成的优化版）
  useEffect(() => {
    const conversationId = active?.id;
    if (conversationId === undefined) {
      setVersions([]);
      return;
    }
    let cancelled = false;
    void api
      .fetchVersions(conversationId)
      .then((items) => {
        if (!cancelled) setVersions(items);
      })
      .catch(() => {
        if (!cancelled) setVersions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [active?.id]);

  const openConversation = (id: string): void => {
    const found = conversations.find((item) => item.id === id) ?? null;
    setActive(found);
    setDraft(null);
  };

  const newConversation = async (): Promise<void> => {
    const created = await api.createConversation();
    setConversations((prev) => [created, ...prev]);
    setActive(created);
    setDraft(null);
    setAttachments([]);
    setInput("");
  };

  const removeConversation = async (id: string): Promise<void> => {
    await api.deleteConversation(id);
    const list = await refreshList();
    if (active?.id === id) {
      setActive(list[0] ?? null);
      setDraft(null);
    }
  };

  const attach = async (file: File): Promise<void> => {
    setUploading(true);
    setNotice(null);
    try {
      const result = await api.uploadFile(file, active?.id);
      setAttachments((prev) => [...prev, result.attachment]);
      if (result.versions !== undefined) setVersions(result.versions);
      if (result.needsOcr) {
        setNotice("这份 PDF 没有抽到文字，可能是扫描件。第一版还不支持 OCR，请上传文字版 PDF 或 DOCX。");
      } else {
        setNotice(
          `已读取 ${result.attachment.chars} 字，记为「原始简历」。说说你的优化要求（缺什么信息 Agent 会追问）。`,
        );
      }
    } catch (error) {
      console.error(error);
      setNotice(error instanceof Error ? error.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const send = async (text: string): Promise<void> => {
    const target = active ?? (await api.createConversation());
    if (active === null) setActive(target);
    if (busy) return;

    const userMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      text,
      ...(attachments.length === 0 ? {} : { attachments }),
      createdAt: new Date().toISOString(),
    };

    setActive((prev) =>
      prev === null ? prev : { ...prev, messages: [...prev.messages, userMessage] },
    );
    setInput("");
    setAttachments([]);
    setDraft({ ...EMPTY_DRAFT });
    setBusy(true);

    const controller = new AbortController();
    try {
      for await (const event of api.streamMessage(
        target.id,
        { text, attachmentIds: attachments.map((item) => item.id) },
        controller.signal,
      )) {
        if (event.event === "ui") {
          applyUiEvent(event.data as UiEvent, setDraft);
        } else if (event.event === "saved") {
          const saved = event.data as {
            userMessage: ChatMessage;
            assistantMessage: ChatMessage;
            versions?: ResumeVersion[];
          };
          setActive((prev) =>
            prev === null
              ? prev
              : {
                  ...prev,
                  messages: [
                    ...prev.messages.filter((item) => item.id !== userMessage.id),
                    saved.userMessage,
                    saved.assistantMessage,
                  ],
                  updatedAt: saved.assistantMessage.createdAt,
                },
          );
          if (saved.versions !== undefined) setVersions(saved.versions);
          setDraft(null);
        }
      }
    } catch (error) {
      setDraft((prev) => ({
        ...(prev ?? EMPTY_DRAFT),
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setBusy(false);
      void refreshList();
    }
  };

  const messages = active?.messages ?? [];

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={active?.id ?? null}
        onSelect={openConversation}
        onNew={() => void newConversation()}
        onDelete={(id) => void removeConversation(id)}
      />

      <main className="main">
        <header className="topbar">
          <h1>{active?.title ?? "新的对话"}</h1>
          <span className="badge">{health?.runtime.model ?? "deepseek-flash"}</span>
          <span className={`badge ${health?.observability === true ? "ok" : "warn"}`}>
            {health?.observability === true ? "Langfuse 已接入" : "Langfuse 未配置"}
          </span>
          <button className="versions-btn" onClick={() => setDrawerOpen(true)}>
            简历版本 <span className="count">{versions.length}</span>
          </button>
        </header>

        <div className="scroll" ref={scrollRef}>
          {messages.length === 0 && draft === null ? (
            <Hero
              onPick={(text) => {
                setInput(text);
              }}
            />
          ) : (
            <div className="thread">
              {messages.map((message, index) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  animate={message.role === "assistant" && index === messages.length - 1 && draft === null}
                />
              ))}
              {draft !== null && (
                <MessageItem
                  message={{
                    id: "draft",
                    role: "assistant",
                    text: draft.text,
                    ...(draft.reasoning === undefined ? {} : { reasoning: draft.reasoning }),
                    ...(draft.error === undefined ? {} : { error: draft.error }),
                    toolCalls: draft.toolCalls,
                    artifacts: draft.artifacts,
                    createdAt: new Date().toISOString(),
                  }}
                  animate={!busy}
                  streaming={busy}
                />
              )}
            </div>
          )}
        </div>

        {notice !== null && (
          <div className="notice">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="关闭提示">
              ×
            </button>
          </div>
        )}

        <Composer
          busy={busy}
          uploading={uploading}
          attachments={attachments}
          value={input}
          onChange={setInput}
          onAttach={(file) => void attach(file)}
          onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((item) => item.id !== id))}
          onSend={(text) => void send(text)}
        />
      </main>

      <VersionsDrawer open={drawerOpen} versions={versions} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}

function applyUiEvent(event: UiEvent, setDraft: React.Dispatch<React.SetStateAction<Draft | null>>): void {
  setDraft((prev) => {
    const draft = prev ?? { ...EMPTY_DRAFT };
    switch (event.type) {
      case "assistant": {
        return {
          ...draft,
          text: event.text === "" ? draft.text : event.text,
          ...(event.reasoning === undefined ? {} : { reasoning: event.reasoning }),
        };
      }
      case "tool_call": {
        return {
          ...draft,
          toolCalls: [
            ...draft.toolCalls.filter((item) => item.callId !== event.callId),
            {
              callId: event.callId,
              name: displayToolName(event.name),
              args: event.args,
              status: "running",
            },
          ],
        };
      }
      case "tool_result": {
        return {
          ...draft,
          toolCalls: draft.toolCalls.map((item) =>
            item.callId === event.callId
              ? { ...item, status: event.ok ? "ok" : "error", output: event.output }
              : item,
          ),
        };
      }
      case "artifact": {
        if (draft.artifacts.some((item) => item.url === event.artifact.url)) return draft;
        return { ...draft, artifacts: [...draft.artifacts, event.artifact] };
      }
      case "error": {
        return { ...draft, error: event.message };
      }
      default:
        return draft;
    }
  });
}
