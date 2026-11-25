/**
 * 截图脚本：渲染 Web UI 或 Markdown 预览，用于人工检查视觉效果。
 *
 *   node scripts/preview.mjs ui  out.png
 *   node scripts/preview.mjs pdf out.png path/to/resume.md
 */
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});

try {
  const [mode, out, input] = process.argv.slice(2);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });

  if (mode === "pdf") {
    const { renderHtml } = await import("../tools/src/pdf.ts");
    const markdown = readFileSync(resolve(input ?? "workspace/outputs/demo.md"), "utf8");
    await page.setContent(renderHtml(markdown, "预览"), { waitUntil: "load" });
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1.5 });
  } else {
    await page.goto(process.env.PREVIEW_URL ?? "http://127.0.0.1:5178/", { waitUntil: "networkidle0" });
    await new Promise((done) => setTimeout(done, 800));
    if (mode === "drawer") {
      await page.click(".versions-btn");
      await new Promise((done) => setTimeout(done, 600));
    }
    await page.evaluate(() => {
      const element = document.querySelector(".scroll");
      if (element !== null) element.scrollTop = element.scrollHeight;
    });
    await new Promise((done) => setTimeout(done, 400));
  }

  const png = await page.screenshot({ fullPage: mode !== "ui" });
  writeFileSync(resolve(out ?? "preview.png"), png);
  console.log("saved", resolve(out ?? "preview.png"));
} finally {
  await browser.close();
}
