/**
 * Langfuse 上报冒烟：启动一个本地假 Langfuse 接收端，跑一轮 trace，
 * 验证 trace / generation / span / usage 是否按预期发出。
 *
 *   npx tsx scripts/smoke-langfuse.ts
 */
import { createServer } from "node:http";

const received: Array<{ path: string; body: string }> = [];

const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    received.push({ path: request.url ?? "", body });
    response.writeHead(207, { "content-type": "application/json" });
    response.end(JSON.stringify({ successes: [], errors: [] }));
  });
});

await new Promise<void>((done) => server.listen(7791, "127.0.0.1", done));

process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
process.env.LANGFUSE_HOST = "http://127.0.0.1:7791";

const { startTurnTrace, observabilityEnabled } = await import("../server/src/obs/langfuse.ts");

console.log("observability enabled:", observabilityEnabled());

const trace = startTurnTrace({
  conversationId: "conv-1",
  sessionId: "session-1",
  messageId: "msg-1",
  input: "帮我改简历",
  model: "deepseek-flash",
  attachments: ["张晨-简历.md"],
});

trace.modelStarted();
trace.toolStarted("call-1", "mcp__resume__resume_parse", '{"path":"x.md"}');
trace.toolFinished("call-1", "mcp__resume__resume_parse", true, "解析完成");
trace.modelCompleted("已改写完成", { input: 1200, output: 640, cacheRead: 2048, cacheWrite: 0, total: 3888 });
await trace.finish("已改写完成");
await new Promise((done) => setTimeout(done, 3000));

server.close();

const types = new Set<string>();
for (const item of received) {
  let payload: { batch?: Array<{ type?: string }> } = {};
  try {
    payload = JSON.parse(item.body) as typeof payload;
  } catch {
    continue;
  }
  for (const event of payload.batch ?? []) {
    if (event.type !== undefined) types.add(event.type);
  }
}

console.log("batches:", received.length, "paths:", [...new Set(received.map((item) => item.path))]);
console.log("event types:", [...types].sort().join(", "));
console.log("sample:", received[0]?.body.slice(0, 400));
