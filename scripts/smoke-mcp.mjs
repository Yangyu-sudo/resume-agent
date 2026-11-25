/**
 * MCP 冒烟测试：直接以 stdio 启动 dist/mcp-server.mjs，走一遍
 * initialize → tools/list → resume_parse → resume_rewrite → pdf_generate。
 *
 *   node scripts/smoke-mcp.mjs
 */
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const serverPath = resolve("dist/mcp-server.mjs");
const workspace = resolve("workspace");
mkdirSync(resolve(workspace, "uploads"), { recursive: true });
const fixture = resolve(workspace, "uploads", "resume.sample.md");
copyFileSync(resolve("fixtures/resume.sample.md"), fixture);

const child = spawn(process.execPath, [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, RESUME_WORKSPACE: workspace },
});

let buffer = "";
const pending = new Map();
let nextId = 1;

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line === "") continue;
    const message = JSON.parse(line);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve: done } = pending.get(message.id);
      pending.delete(message.id);
      done(message);
    }
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

function request(method, params) {
  const id = nextId++;
  const payload = { jsonrpc: "2.0", id, method, params };
  return new Promise((done) => {
    pending.set(id, { resolve: done });
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

const init = await request("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke", version: "1.0.0" },
});
console.log("initialize:", JSON.stringify(init.result?.serverInfo));
notify("notifications/initialized", {});

const list = await request("tools/list", {});
console.log(
  "tools:",
  list.result?.tools?.map((tool) => tool.name).join(", "),
);

const parsed = await request("tools/call", {
  name: "resume_parse",
  arguments: { path: fixture },
});
console.log("resume_parse isError:", parsed.result?.isError ?? false);
console.log("resume_parse text head:", (parsed.result?.content?.[0]?.text ?? "").slice(0, 220));

const rewritten = await request("tools/call", {
  name: "resume_rewrite",
  arguments: {
    profile: {
      basics: { name: "张晨", title: "高级前端工程师", email: "zhangchen@example.com" },
      summary: "4 年前端经验，专注交易链路与性能优化。",
      experience: [
        {
          org: "某电商公司",
          role: "高级前端工程师",
          period: "2022.07 – 至今",
          bullets: ["使用 React 18 + TypeScript 重构订单模块，首屏从 3.2s 降至 1.1s"],
        },
      ],
      skills: ["React", "TypeScript", "Node.js"],
    },
    headline: "高级前端工程师",
  },
});
const rewriteText = rewritten.result?.content?.[0]?.text ?? "";
console.log("resume_rewrite isError:", rewritten.result?.isError ?? false);
const payload = JSON.parse(rewriteText.split("```json")[1]?.split("```")[0] ?? "{}");
console.log("artifact:", JSON.stringify(payload.artifacts));

if (payload.artifacts?.[0]?.path) {
  const pdf = await request("tools/call", {
    name: "pdf_generate",
    arguments: { markdownPath: payload.artifacts[0].path, fileName: "张晨-测试" },
  });
  console.log("pdf_generate isError:", pdf.result?.isError ?? false);
  console.log("pdf text:", (pdf.result?.content?.[0]?.text ?? "").split("\n")[0]);
}

child.kill();
