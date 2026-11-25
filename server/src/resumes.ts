import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR, ensureDirs } from "./config";
import type { ResumeVersion } from "../../shared/protocol";

/**
 * 简历版本库：一次会话里保留原始简历 + 每个优化版本。
 *
 * 原始版本来自上传（含 PDF 原件路径），优化版本来自 resume_rewrite 生成的 Markdown；
 * pdf_generate 之后把 PDF 挂到最近的优化版本上。前端「简历版本」抽屉读的就是这里。
 */

interface StoredVersion {
  id: string;
  kind: "original" | "optimized";
  label: string;
  fileName: string;
  /** 原始文件或 Markdown 的绝对路径 */
  path: string;
  /** 导出的 PDF 绝对路径 */
  pdfPath?: string;
  createdAt: string;
  chars: number;
  source: "upload" | "agent";
  needsOcr?: boolean;
}

interface StoreShape {
  version: 1;
  conversations: Record<string, StoredVersion[]>;
}

const STORE_PATH = join(DATA_DIR, "resumes.json");
let cache: StoreShape | null = null;

function load(): StoreShape {
  if (cache !== null) return cache;
  ensureDirs();
  if (!existsSync(STORE_PATH)) {
    cache = { version: 1, conversations: {} };
    return cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(STORE_PATH, "utf8")) as StoreShape;
    cache = {
      version: 1,
      conversations: typeof parsed.conversations === "object" && parsed.conversations !== null ? parsed.conversations : {},
    };
  } catch {
    cache = { version: 1, conversations: {} };
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

function bucket(conversationId: string): StoredVersion[] {
  const store = load();
  const key = conversationId;
  store.conversations[key] ??= [];
  return store.conversations[key];
}

export function listVersions(conversationId: string): StoredVersion[] {
  return [...(load().conversations[conversationId] ?? [])];
}

export function addOriginal(
  conversationId: string,
  input: { path: string; fileName: string; chars: number; needsOcr?: boolean },
): StoredVersion {
  const items = bucket(conversationId);
  const version: StoredVersion = {
    id: randomUUID(),
    kind: "original",
    label: "原始简历",
    fileName: input.fileName,
    path: input.path,
    createdAt: new Date().toISOString(),
    chars: input.chars,
    source: "upload",
    ...(input.needsOcr === true ? { needsOcr: true } : {}),
  };
  items.unshift(version);
  persist();
  return version;
}

export function addOptimized(
  conversationId: string,
  input: { path: string; fileName: string; chars: number },
): StoredVersion {
  const items = bucket(conversationId);
  const count = items.filter((item) => item.kind === "optimized").length + 1;
  const version: StoredVersion = {
    id: randomUUID(),
    kind: "optimized",
    label: `优化版 v${count}`,
    fileName: input.fileName,
    path: input.path,
    createdAt: new Date().toISOString(),
    chars: input.chars,
    source: "agent",
  };
  items.push(version);
  persist();
  return version;
}

/** 把 PDF 挂到当前会话最新的、还没有 PDF 的优化版本上。 */
export function attachPdf(conversationId: string, pdfPath: string): void {
  const items = bucket(conversationId);
  const target = [...items].reverse().find((item) => item.kind === "optimized" && item.pdfPath === undefined);
  if (target === undefined) return;
  target.pdfPath = pdfPath;
  persist();
}

export function publicVersions(conversationId: string): ResumeVersion[] {
  return listVersions(conversationId).map((item) => ({
    id: item.id,
    kind: item.kind,
    label: item.label,
    fileName: item.fileName,
    createdAt: item.createdAt,
    chars: item.chars,
    source: item.source,
    downloadUrl:
      item.kind === "original"
        ? `/api/uploads/${encodeURIComponent(basename(item.path))}`
        : `/api/outputs/${encodeURIComponent(basename(item.path))}`,
    ...(item.pdfPath === undefined
      ? {}
      : { pdfUrl: `/api/outputs/${encodeURIComponent(basename(item.pdfPath))}` }),
    ...(item.needsOcr === true ? { needsOcr: true } : {}),
  }));
}
