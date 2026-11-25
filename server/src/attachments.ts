import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, ensureDirs } from "./config";
import type { Attachment } from "../../shared/protocol";

/**
 * 附件仓库：把「上传时拿到的一次性路径」变成稳定的 attachmentId，
 * 前端只回传 id，服务端据此把绝对路径交给 MCP 工具。
 */

export interface StoredAttachment extends Attachment {
  path: string;
}

const STORE_PATH = join(DATA_DIR, "attachments.json");
let cache: Map<string, StoredAttachment> | null = null;

function load(): Map<string, StoredAttachment> {
  if (cache !== null) return cache;
  ensureDirs();
  cache = new Map();
  if (existsSync(STORE_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(STORE_PATH, "utf8")) as { attachments?: StoredAttachment[] };
      for (const item of parsed.attachments ?? []) cache.set(item.id, item);
    } catch {
      // 损坏的索引不影响新上传
    }
  }
  return cache;
}

function persist(): void {
  if (cache === null) return;
  ensureDirs();
  const temp = `${STORE_PATH}.tmp`;
  writeFileSync(temp, JSON.stringify({ attachments: [...cache.values()] }, null, 2), "utf8");
  renameSync(temp, STORE_PATH);
}

export function saveAttachment(attachment: StoredAttachment): void {
  load().set(attachment.id, attachment);
  persist();
}

export function getAttachment(id: string): StoredAttachment | undefined {
  return load().get(id);
}

export function resolveAttachments(ids: string[]): StoredAttachment[] {
  const result: StoredAttachment[] = [];
  for (const id of ids) {
    const item = getAttachment(id);
    if (item !== undefined && existsSync(item.path)) result.push(item);
  }
  return result;
}

export function publicView(attachment: StoredAttachment): Attachment {
  const { path: _path, ...rest } = attachment;
  return rest;
}
