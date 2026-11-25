/**
 * 真实简历全流程：上传 → 诊断（含追问）→ 改写 → 导出 PDF → 版本核对。
 *   node scripts/smoke-real-flow.mjs "<pdf 路径>"
 */
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const base = process.env.RESUME_BASE_URL ?? "http://127.0.0.1:5178";
const filePath = resolve(process.argv[2] ?? "");
const pdfName = basename(filePath);

async function jsonFetch(path, init) {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  return response.json();
}

const { conversation } = await jsonFetch("/api/conversations", { method: "POST" });
console.log("会话:", conversation.id);

const form = new FormData();
form.append("file", new Blob([readFileSync(filePath)], { type: "application/pdf" }), pdfName);
form.append("conversationId", conversation.id);
const uploaded = await jsonFetch("/api/files", { method: "POST", body: form });
console.log(
  `上传: chars=${uploaded.chars} needsOcr=${uploaded.needsOcr} 结构=${JSON.stringify(uploaded.structure)} 版本=${uploaded.versions?.length}`,
);
console.log("预览前 160 字:", uploaded.attachment.preview.slice(0, 160).replace(/\n/g, " | "));

async function turn(label, text, attachmentIds = []) {
  console.log(`\n===== ${label} =====`);
  const response = await fetch(`${base}/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, attachmentIds }),
    signal: AbortSignal.timeout(300000),
  });
  if (!response.ok) throw new Error(`stream -> ${response.status} ${await response.text()}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const started = Date.now();
  let reply = "";

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
      if (event === "ui" && data.type === "tool_call") console.log(`  [${((Date.now() - started) / 1000).toFixed(1)}s] 调用 ${data.name}`);
      if (event === "ui" && data.type === "tool_result") console.log(`  [${((Date.now() - started) / 1000).toFixed(1)}s] 结果 ok=${data.ok}`);
      if (event === "ui" && data.type === "artifact") console.log("  产物:", data.artifact.name, data.artifact.url);
      if (event === "ui" && data.type === "error") console.log("  错误:", data.message);
      if (event === "saved") reply = data.assistantMessage.text;
    }
  }
  console.log(`用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log("回复摘录:\n" + reply.slice(0, 900));
  return reply;
}

await turn("第一轮：诊断 + 追问", "这是我上传的简历，帮我看看问题在哪，缺什么信息也一并告诉我。", [uploaded.attachment.id]);

await turn(
  "第二轮：改写 + 导出 PDF",
  "公司名和学校名按简历原文保留，没有的数字一律不要编。按「AI 应用开发工程师 · 2027 届」方向改写，然后导出 PDF。",
);

const { versions } = await jsonFetch(`/api/conversations/${conversation.id}/resumes`);
console.log("\n===== 版本 =====");
for (const version of versions) {
  console.log(
    `- ${version.label} | ${version.fileName} | ${version.chars} 字 | md=${version.downloadUrl} | pdf=${version.pdfUrl ?? "-"}`,
  );
}
console.log("\n会话 id:", conversation.id);
