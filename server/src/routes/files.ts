import { Router } from "express";
import multer from "multer";
import { existsSync, statSync } from "node:fs";
import { extname, basename, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { UPLOAD_DIR, OUTPUT_DIR, ensureDirs } from "../config";
import { saveAttachment, type StoredAttachment } from "../attachments";
import { addOriginal, publicVersions } from "../resumes";
import { extractDocument } from "../../../shared/extract";
import { parseResumeText } from "../../../tools/src/resume";

/**
 * 文件入口：
 * - POST /api/files 上传简历（第一版以 PDF 为主），落盘、抽文本、解析结构，并登记为「原始简历」版本
 * - GET /api/uploads/:name 下载用户上传的原件
 * - GET /api/outputs/:name 下载工具生成的产物（限制在 workspace/outputs 内）
 */

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    ensureDirs();
    callback(null, UPLOAD_DIR);
  },
  filename: (_req, file, callback) => {
    const ext = extname(file.originalname).toLowerCase().slice(0, 12);
    callback(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const ext = extname(file.originalname).toLowerCase();
    const allowed = [".pdf", ".docx", ".doc", ".md", ".txt", ".markdown"];
    callback(null, allowed.includes(ext));
  },
});

export const filesRouter = Router();

filesRouter.post("/files", upload.single("file"), async (request, response) => {
  const file = request.file;
  if (file === undefined) {
    response.status(400).json({ error: "请上传 PDF / DOCX / MD / TXT 简历文件" });
    return;
  }

  const ext = extname(file.originalname).toLowerCase();
  const fileName = decodeOriginalName(file.originalname);

  let text = "";
  try {
    text = (await extractDocument(file.path)).text;
  } catch (error) {
    text = "";
    console.warn(`[files] 文本抽取失败：${fileName}`, error);
  }

  // 扫描件 PDF 抽不到文本；第一版不做 OCR，明确告诉用户而不是让模型瞎猜
  const needsOcr = ext === ".pdf" && text.length < 80;

  const attachment: StoredAttachment = {
    id: randomUUID(),
    name: fileName,
    size: file.size,
    mime: file.mimetype,
    preview: text.slice(0, 4000),
    chars: text.length,
    path: file.path,
  };
  saveAttachment(attachment);

  const conversationId = typeof request.body?.conversationId === "string" ? request.body.conversationId : "";
  let version = null;
  if (conversationId !== "") {
    version = addOriginal(conversationId, {
      path: file.path,
      fileName,
      chars: text.length,
      needsOcr,
    });
  }

  // 上传即解析一次，前端可以直接展示结构化结果，也便于后续对比原始与优化版本
  let structure: { skills: number; experience: number; bullets: number } | null = null;
  if (text !== "" && !needsOcr) {
    try {
      const profile = parseResumeText(text);
      structure = {
        skills: profile.skills.length,
        experience: profile.experience.length,
        bullets: profile.stats.bullets,
      };
    } catch {
      structure = null;
    }
  }

  const { path: _path, ...visible } = attachment;
  response.json({
    attachment: visible,
    chars: attachment.chars,
    needsOcr,
    structure,
    ...(conversationId === "" ? {} : { versions: publicVersions(conversationId) }),
  });
});

filesRouter.get("/uploads/:name", (request, response) => {
  const name = basename(request.params.name ?? "");
  const target = resolve(join(UPLOAD_DIR, name));
  if (!target.startsWith(UPLOAD_DIR + sep) || !existsSync(target)) {
    response.status(404).json({ error: "文件不存在" });
    return;
  }
  response.download(target, name);
});

filesRouter.get("/outputs/:name", (request, response) => {
  const name = basename(request.params.name ?? "");
  const target = resolve(join(OUTPUT_DIR, name));
  if (!target.startsWith(OUTPUT_DIR + sep) || !existsSync(target)) {
    response.status(404).json({ error: "文件不存在" });
    return;
  }
  response.download(target, name);
});

function decodeOriginalName(name: string): string {
  // 浏览器上传的中文文件名在部分场景下按 latin1 传上来
  try {
    const decoded = Buffer.from(name, "latin1").toString("utf8");
    return decoded.includes("\uFFFD") ? name : decoded;
  } catch {
    return name;
  }
}

export function fileSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}
