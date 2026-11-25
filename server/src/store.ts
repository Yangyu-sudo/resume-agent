import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DATA_DIR, ensureDirs } from "./config";
import type { ChatMessage, Conversation } from "../../shared/protocol";

/**
 * 会话持久化：单用户 MVP 用一份 JSON 文件即可，避免引入数据库。
 * 消息历史留在服务端，刷新页面或重启服务都能恢复；DSH 侧的上下文由 dshSessionId 维持。
 */

const STORE_PATH = join(DATA_DIR, "conversations.json");

interface StoreShape {
  version: 1;
  conversations: Conversation[];
}

let cache: StoreShape | null = null;

function load(): StoreShape {
  if (cache !== null) return cache;
  ensureDirs();
  if (!existsSync(STORE_PATH)) {
    cache = { version: 1, conversations: [] };
    return cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(STORE_PATH, "utf8")) as StoreShape;
    cache = { version: 1, conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [] };
  } catch {
    cache = { version: 1, conversations: [] };
  }
  return cache;
}

function persist(): void {
  if (cache === null) return;
  ensureDirs();
  const temp = `${STORE_PATH}.tmp`;
  writeFileSync(temp, JSON.stringify(cache, null, 2), "utf8");
  renameSync(temp, STORE_PATH);
}

export function listConversations(): Conversation[] {
  return [...load().conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getConversation(id: string): Conversation | undefined {
  return load().conversations.find((item) => item.id === id);
}

export function createConversation(): Conversation {
  const now = new Date().toISOString();
  const conversation: Conversation = {
    id: randomUUID(),
    title: "新的对话",
    dshSessionId: `session-${randomUUID().replaceAll("-", "")}`,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  load().conversations.push(conversation);
  persist();
  return conversation;
}

export function deleteConversation(id: string): boolean {
  const store = load();
  const index = store.conversations.findIndex((item) => item.id === id);
  if (index === -1) return false;
  store.conversations.splice(index, 1);
  persist();
  return true;
}

export function appendMessage(conversationId: string, message: ChatMessage): Conversation {
  const conversation = requireConversation(conversationId);
  conversation.messages.push(message);
  conversation.updatedAt = new Date().toISOString();
  if (conversation.title === "新的对话" && message.role === "user") {
    conversation.title = titleFrom(message.text);
  }
  persist();
  return conversation;
}

export function updateMessage(
  conversationId: string,
  messageId: string,
  patch: Partial<ChatMessage>,
): void {
  const conversation = requireConversation(conversationId);
  const message = conversation.messages.find((item) => item.id === messageId);
  if (message === undefined) return;
  Object.assign(message, patch);
  conversation.updatedAt = new Date().toISOString();
  persist();
}

export function requireConversation(id: string): Conversation {
  const conversation = getConversation(id);
  if (conversation === undefined) {
    throw new Error(`会话不存在：${id}`);
  }
  return conversation;
}

function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean === "") return "新的对话";
  return clean.length <= 24 ? clean : `${clean.slice(0, 24)}…`;
}
