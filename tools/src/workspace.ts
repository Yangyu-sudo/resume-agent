import { existsSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

/**
 * 工具侧的路径边界：只允许读工作区内文件、只允许写 outputs。
 * 模型给的路径来自对话，必须当作不可信输入。
 */

export const WORKSPACE = resolve(process.env.RESUME_WORKSPACE ?? process.cwd());
export const UPLOAD_DIR = resolve(process.env.RESUME_UPLOAD_DIR ?? join(WORKSPACE, "uploads"));
export const OUTPUT_DIR = resolve(process.env.RESUME_OUTPUT_DIR ?? join(WORKSPACE, "outputs"));

export function resolveReadable(input: string): string {
  const target = resolve(input);
  if (!isInside(WORKSPACE, target)) {
    throw new Error(`路径不在工作区内：${input}`);
  }
  if (!existsSync(target)) {
    throw new Error(`文件不存在：${input}`);
  }
  return target;
}

export function resolveOutput(fileName: string, extension: string): string {
  const safe = sanitize(basename(fileName))
    .replace(/\.(md|pdf|markdown)$/i, "")
    .slice(0, 60);
  const name = `${safe === "" ? "resume" : safe}-${stamp()}.${extension}`;
  const target = resolve(join(OUTPUT_DIR, name));
  if (!isInside(OUTPUT_DIR, target)) {
    throw new Error(`输出路径非法：${fileName}`);
  }
  return target;
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + sep);
}

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim();
}

function stamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
