import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const browserPath =
  process.env.RESUME_BROWSER_PATH ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const demoPath = resolve("demo/agent-loop.html");
const outputDir = resolve(".runtime");
const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(demoPath).href, { waitUntil: "load" });
  await page.click("#run");
  await page.waitForFunction(
    () => document.querySelector("#status")?.textContent === "本轮完成",
    { timeout: 15_000 },
  );

  const desktop = await page.evaluate(() => ({
    status: document.querySelector("#status")?.textContent,
    timelineChildren: document.querySelector("#timeline")?.children.length,
    logs: document.querySelectorAll("#event-log .log-line").length,
    artifacts: document.querySelectorAll(".artifact-link").length,
    artifactDownload:
      document.querySelector(".artifact-link")?.getAttribute("download") ?? "",
    artifactUrl:
      document.querySelector(".artifact-link")?.getAttribute("href") ?? "",
    hasToolResult: (document.querySelector("#tool-result")?.textContent ?? "").includes(
      '"ok": true',
    ),
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  await page.screenshot({
    path: resolve(outputDir, "agent-loop-desktop.png"),
    fullPage: true,
  });

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: "load" });
  await page.click("#run");
  await page.waitForFunction(
    () => document.querySelector("#status")?.textContent === "本轮完成",
    { timeout: 15_000 },
  );
  const mobile = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  await page.screenshot({
    path: resolve(outputDir, "agent-loop-mobile.png"),
    fullPage: true,
  });

  if (
    desktop.status !== "本轮完成" ||
    desktop.timelineChildren < 9 ||
    desktop.logs < 8 ||
    desktop.artifacts !== 1 ||
    !desktop.artifactDownload.endsWith(".md") ||
    !desktop.artifactUrl.startsWith("blob:") ||
    !desktop.hasToolResult ||
    desktop.bodyWidth > desktop.viewportWidth ||
    mobile.bodyWidth > mobile.viewportWidth
  ) {
    throw new Error(
      `Demo verification failed: ${JSON.stringify({ desktop, mobile })}`,
    );
  }

  console.log(JSON.stringify({ desktop, mobile }, null, 2));
} finally {
  await browser.close();
}
