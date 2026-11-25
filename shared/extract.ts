import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

/**
 * 从 PDF / DOCX / 纯文本中抽取正文，供「解析简历」与上传预览共用。
 *
 * PDF 优先用 mupdf：对 Word 导出、缺 ToUnicode 的子集字体，它能还原数字与
 * 正确字形；pdfjs（unpdf）在同样文件上会丢数字、把汉字映射成康熙部首。
 * mupdf 失败时再退回 unpdf。
 */

export interface ExtractedDocument {
  name: string;
  kind: "pdf" | "docx" | "text";
  text: string;
}

export async function extractDocument(path: string): Promise<ExtractedDocument> {
  const ext = extname(path).toLowerCase();
  const name = basename(path);

  if (ext === ".pdf") {
    return { name, kind: "pdf", text: await extractPdfText(path) };
  }

  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.default.extractRawText({ buffer: readFileSync(path) });
    return { name, kind: "docx", text: normalize(result.value) };
  }

  if (ext === ".doc") {
    throw new Error("不支持旧版 .doc，请另存为 .docx 或 PDF 后重试");
  }

  if (ext === ".md" || ext === ".markdown" || ext === ".txt") {
    return { name, kind: "text", text: normalize(readFileSync(path, "utf8")) };
  }

  throw new Error(`不支持的文件类型：${ext || "(无扩展名)"}`);
}

async function extractPdfText(path: string): Promise<string> {
  const buffer = readFileSync(path);

  try {
    const mupdf = await import("mupdf");
    const doc = mupdf.Document.openDocument(buffer, "application/pdf");
    const pages: string[] = [];
    for (let index = 0; index < doc.countPages(); index += 1) {
      pages.push(pageTextInReadingOrder(doc.loadPage(index)));
    }
    const text = normalize(pages.join("\n"));
    if (text !== "") return text;
  } catch (error) {
    console.warn("[extract] mupdf 抽取失败，回退 pdfjs：", error);
  }

  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const result = await extractText(pdf, { mergePages: true });
  return normalize(result.text);
}

/**
 * 按版面坐标重排文本块。
 * 很多设计过的简历把「教育经历/专业技能」这类小标题做成独立文本框，
 * PDF 内部顺序会把它们堆到文末；按 (y, x) 排序才能还原人眼看到的顺序。
 */
function pageTextInReadingOrder(page: {
  toStructuredText: (options: string) => { asJSON: () => string };
}): string {
  const json = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON()) as {
    blocks?: Array<{
      type?: string;
      bbox?: { x?: number; y?: number };
      lines?: Array<{ text?: string }>;
    }>;
  };

  const blocks = (json.blocks ?? [])
    .filter((block) => block.type === undefined || block.type === "text")
    .map((block) => ({
      x: block.bbox?.x ?? 0,
      y: block.bbox?.y ?? 0,
      text: (block.lines ?? [])
        .map((line) => (line.text ?? "").trim())
        .filter((line) => line !== "")
        .join("\n"),
    }))
    .filter((block) => block.text !== "");

  // 同一水平线（容差 6pt）内按 x 排序，否则按 y 排序
  blocks.sort((a, b) => (Math.abs(a.y - b.y) > 6 ? a.y - b.y : a.x - b.x));
  return blocks.map((block) => block.text).join("\n\n");
}

export function normalize(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
