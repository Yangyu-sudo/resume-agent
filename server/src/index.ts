import "./env";
import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { HOST, PORT, ROOT, ensureDirs } from "./config";
import { closeRuntime } from "./agent/runtime";
import { verifyLangfuse } from "./obs/langfuse";
import { chatRouter } from "./routes/chat";
import { filesRouter } from "./routes/files";

/**
 * ResumeAgent 服务端：
 * - /api/conversations...  会话与流式对话（SSE）
 * - /api/files, /api/outputs 上传与产物下载
 * - 生产模式下同时托管 web/dist 单页应用
 */

ensureDirs();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

app.use("/api", chatRouter);
app.use("/api", filesRouter);

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

const webDist = join(ROOT, "web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist, { index: false }));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) {
      next();
      return;
    }
    response.sendFile(join(webDist, "index.html"));
  });
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[server] 未处理错误：", error);
  if (response.headersSent) return;
  response.status(500).json({ error: message });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`ResumeAgent 已启动：http://${HOST}:${PORT}`);
  if (!existsSync(webDist)) {
    console.log("提示：web/dist 不存在，开发模式请另开一个窗口跑 npm run dev:web");
  }
  void verifyLangfuse();
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n收到 ${signal}，正在关闭…`);
  server.close();
  await closeRuntime();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
