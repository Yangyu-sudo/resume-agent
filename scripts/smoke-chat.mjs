/**
 * 端到端冒烟：真实 HTTP + 真实 DSH 运行时 + 真实 deepseek-flash。
 *
 *   node scripts/smoke-chat.mjs "帮我看这份简历和岗位的差距"
 *
 * 设置 FOLLOW_UP 可以再发一轮，验证同一会话的上下文延续。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.RESUME_BASE_URL ?? "http://127.0.0.1:5178";
const prompt = process.argv[2] ?? "我上传了一份简历，请解析它，然后告诉我这份简历最大的三个问题。";

async function jsonFetch(path, init) {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  return response.json();
}

const created = await jsonFetch("/api/conversations", { method: "POST" });
const conversation = created.conversation;
console.log("conversation:", conversation.id, conversation.dshSessionId);

const form = new FormData();
form.append(
  "file",
  new Blob([readFileSync(resolve("fixtures/resume.sample.md"))], { type: "text/markdown" }),
  "张晨-简历.md",
);
const uploaded = await jsonFetch("/api/files", { method: "POST", body: form });
console.log("attachment:", uploaded.attachment.id, uploaded.attachment.chars, "chars");

async function turn(text, attachmentIds) {
  const response = await fetch(`${base}/api/conversations/${conversation.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, attachmentIds }),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`stream -> ${response.status} ${await response.text()}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const started = Date.now();
  const kinds = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const event = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
      const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
      if (dataLine === undefined) continue;
      const data = JSON.parse(dataLine.slice(5).trim());
      if (event === "ui") {
        kinds.push(data.type);
        if (data.type === "tool_call") console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] 工具: ${data.name}`);
        if (data.type === "error") console.log("错误:", data.message);
        if (data.type === "artifact") console.log("产物:", data.artifact.name, "->", data.artifact.url);
      } else if (event === "saved") {
        const saved = data.assistantMessage;
        console.log("\n---- assistant ----");
        console.log(saved.text.slice(0, 700));
        console.log("usage:", JSON.stringify(saved.usage));
        console.log("tools:", JSON.stringify(saved.toolCalls?.map((call) => `${call.name}:${call.status}`)));
        console.log("artifacts:", JSON.stringify(saved.artifacts?.map((item) => item.name)));
      }
    }
  }
  console.log(`用时 ${((Date.now() - started) / 1000).toFixed(1)}s；事件：${[...new Set(kinds)].join(", ")}\n`);
}

await turn(prompt, [uploaded.attachment.id]);

if (process.env.FOLLOW_UP) {
  console.log("==== 第二轮（同一会话）====");
  await turn(process.env.FOLLOW_UP, []);
}
