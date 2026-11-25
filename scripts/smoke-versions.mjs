/**
 * 版本链路冒烟：上传简历（登记原始版本）→ 对话生成优化版 + PDF → 查询版本列表。
 *
 *   node scripts/smoke-versions.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.RESUME_BASE_URL ?? "http://127.0.0.1:5178";

async function jsonFetch(path, init) {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  return response.json();
}

const { conversation } = await jsonFetch("/api/conversations", { method: "POST" });
console.log("conversation:", conversation.id);

async function upload(filePath, displayName, mime) {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(filePath)], { type: mime }), displayName);
  form.append("conversationId", conversation.id);
  const result = await jsonFetch("/api/files", { method: "POST", body: form });
  console.log(
    `upload ${displayName}: chars=${result.chars} needsOcr=${result.needsOcr} structure=${JSON.stringify(result.structure)} versions=${result.versions?.length}`,
  );
  return result;
}

const md = await upload(resolve("fixtures/resume.sample.md"), "张晨-简历.md", "text/markdown");

const pdfDir = resolve("workspace/outputs");
let pdfFile = null;
try {
  pdfFile = readdirSync(pdfDir).find((name) => name.endsWith(".pdf")) ?? null;
} catch {
  pdfFile = null;
}
if (pdfFile !== null) {
  await upload(resolve(pdfDir, pdfFile), "张晨-简历.pdf", "application/pdf");
}

const response = await fetch(`${base}/api/conversations/${conversation.id}/messages`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    text: "把这份简历按「高级前端工程师」改写，只重组已有事实，然后导出 PDF。",
    attachmentIds: [md.attachment.id],
  }),
  signal: AbortSignal.timeout(240000),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let versionsFromSaved = null;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let index;
  while ((index = buffer.indexOf("\n\n")) >= 0) {
    const block = buffer.slice(0, index);
    buffer = buffer.slice(index + 2);
    const event = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
    const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
    if (dataLine === undefined) continue;
    const data = JSON.parse(dataLine.slice(5).trim());
    if (event === "ui" && data.type === "artifact") console.log("产物:", data.artifact.name);
    if (event === "saved") versionsFromSaved = data.versions;
  }
}

console.log("\n---- versions（saved 事件内联）----");
console.log(JSON.stringify(versionsFromSaved, null, 2));

const fetched = await jsonFetch(`/api/conversations/${conversation.id}/resumes`);
console.log("\n---- versions（独立接口）----");
console.log(JSON.stringify(fetched.versions, null, 2));
