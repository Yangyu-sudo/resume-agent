/**
 * 用真实 PDF 走一遍上传 + 解析 + 对话，验证抽取质量与工具链路。
 *   node scripts/smoke-real-pdf.mjs <pdf 路径>
 */
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const base = process.env.RESUME_BASE_URL ?? "http://127.0.0.1:5178";
const filePath = resolve(process.argv[2] ?? "");

async function jsonFetch(path, init) {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  return response.json();
}

const { conversation } = await jsonFetch("/api/conversations", { method: "POST" });
const form = new FormData();
form.append("file", new Blob([readFileSync(filePath)], { type: "application/pdf" }), basename(filePath));
form.append("conversationId", conversation.id);
const uploaded = await jsonFetch("/api/files", { method: "POST", body: form });
console.log("chars:", uploaded.chars, "needsOcr:", uploaded.needsOcr, "structure:", JSON.stringify(uploaded.structure));
console.log("---- preview ----");
console.log(uploaded.attachment.preview.slice(0, 240));

const response = await fetch(`${base}/api/conversations/${conversation.id}/messages`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ text: "解析这份简历，指出三处最该改的地方。", attachmentIds: [uploaded.attachment.id] }),
  signal: AbortSignal.timeout(240000),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
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
    if (event === "ui" && data.type === "tool_call") console.log("tool:", data.name);
    if (event === "ui" && data.type === "tool_result") console.log("tool ok:", data.ok);
    if (event === "ui" && data.type === "error") console.log("error:", data.message);
    if (event === "saved") {
      console.log("---- reply ----");
      console.log(data.assistantMessage.text.slice(0, 700));
    }
  }
}
