import { existsSync } from "node:fs";
import { marked } from "marked";
import puppeteer from "puppeteer-core";

/**
 * Markdown → PDF：用本机已装的 Chrome/Edge 无头渲染，避免打包 Chromium 与中文字体。
 */

const CANDIDATES = [
  process.env.RESUME_BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((item): item is string => typeof item === "string" && item !== "");

export function findBrowser(): string | null {
  return CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

export async function markdownToPdf(markdown: string, outputPath: string, title: string): Promise<void> {
  const browserPath = findBrowser();
  if (browserPath === null) {
    throw new Error("找不到可用的 Chrome / Edge，无法渲染 PDF。可设置 RESUME_BROWSER_PATH 指定浏览器路径。");
  }

  const html = renderHtml(markdown, title);
  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "15mm", right: "15mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#9aa0a6;padding:0 15mm;display:flex;justify-content:space-between;"><span></span><span class="pageNumber"></span></div>',
    });
  } finally {
    await browser.close();
  }
}

export function renderHtml(markdown: string, title: string): string {
  const body = marked.parse(markdown, { async: false, gfm: true });
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  :root { --ink:#1f2328; --muted:#57606a; --line:#d8dee4; --accent:#0b5fff; }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: var(--ink); background: #fff;
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", "Segoe UI", sans-serif;
    font-size: 10.5pt; line-height: 1.65;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1 { font-size: 20pt; margin: 0 0 2px; letter-spacing: .3px; }
  h1 + p { color: var(--muted); margin: 0 0 10px; font-size: 9.5pt; }
  h2 {
    font-size: 12pt; margin: 16px 0 6px; padding-bottom: 3px;
    border-bottom: 1.5px solid var(--line); letter-spacing: .4px;
  }
  h3 { font-size: 10.8pt; margin: 10px 0 3px; }
  h3 + p { color: var(--muted); font-size: 9.5pt; margin: 0; }
  p { margin: 4px 0; }
  ul { margin: 3px 0 6px; padding-left: 16px; }
  li { margin: 1.5px 0; }
  li::marker { color: var(--accent); }
  blockquote { margin: 6px 0; padding: 4px 10px; border-left: 3px solid var(--accent); background: #f2f6ff; color: #24304a; }
  strong { font-weight: 600; }
  hr { border: none; border-top: 1px solid var(--line); margin: 10px 0; }
  a { color: var(--accent); text-decoration: none; }
  h1, h2, h3 { page-break-after: avoid; }
  li, blockquote { page-break-inside: avoid; }
</style>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
