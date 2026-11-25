import type { Attachment, Conversation, ResumeVersion, UiEvent } from "../../shared/protocol";

/** 前端 API 客户端：会话 CRUD、上传、SSE 流式对话。 */

export interface SavedPayload {
  userMessage: ChatMessageLike;
  assistantMessage: ChatMessageLike;
}

export type ChatMessageLike = Conversation["messages"][number];

async function readError(response: Response): Promise<Error> {
  try {
    const payload = (await response.json()) as { error?: string };
    return new Error(payload.error ?? `请求失败（HTTP ${response.status}）`);
  } catch {
    return new Error(`请求失败（HTTP ${response.status}）`);
  }
}

async function getJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await readError(response);
  return (await response.json()) as T;
}

export async function listConversations(): Promise<Conversation[]> {
  const data = await getJson<{ conversations: Conversation[] }>(await fetch("/api/conversations"));
  return data.conversations;
}

export async function createConversation(): Promise<Conversation> {
  const data = await getJson<{ conversation: Conversation }>(
    await fetch("/api/conversations", { method: "POST" }),
  );
  return data.conversation;
}

export async function deleteConversation(id: string): Promise<void> {
  await fetch(`/api/conversations/${id}`, { method: "DELETE" });
}

export interface UploadResult {
  attachment: Attachment;
  needsOcr: boolean;
  structure: { skills: number; experience: number; bullets: number } | null;
  versions?: ResumeVersion[];
}

export async function uploadFile(file: File, conversationId?: string): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  if (conversationId !== undefined && conversationId !== "") {
    form.append("conversationId", conversationId);
  }
  return getJson<UploadResult>(await fetch("/api/files", { method: "POST", body: form }));
}

export async function fetchVersions(conversationId: string): Promise<ResumeVersion[]> {
  const data = await getJson<{ versions: ResumeVersion[] }>(
    await fetch(`/api/conversations/${conversationId}/resumes`),
  );
  return data.versions;
}

export interface StreamEvent {
  event: string;
  data: unknown;
}

/** POST 之后按 SSE 读取：EventSource 不支持 POST，只能手写解析。 */
export async function* streamMessage(
  conversationId: string,
  body: { text: string; attachmentIds: string[] },
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const response = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) throw await readError(response);
  if (response.body === null) throw new Error("服务端没有返回事件流");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
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
  }
}

function parseBlock(block: string): StreamEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) as unknown };
  } catch {
    return null;
  }
}

export type { UiEvent };
