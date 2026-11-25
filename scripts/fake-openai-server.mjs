/**
 * 本地假模型服务：模拟 OpenAI 兼容的 /chat/completions，用于在没有 api key 时
 * 端到端验证 LLM 链路（provider → 提示词 → JSON 校验 → 报告渲染）。
 *
 *   node scripts/fake-openai-server.mjs
 *   RESUME_AGENT_API_KEY=test RESUME_AGENT_BASE_URL=http://127.0.0.1:8787/v1 \
 *     npx tsx src/index.ts analyze fixtures/resume.sample.md fixtures/jd.sample.md --analyzer llm
 */
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8787);

const analysis = {
  score: 74,
  verdict: "基本匹配，需补齐微前端与容器化经验",
  summary:
    "交易链路与性能优化的经历和岗位高度对应，React/TypeScript 关键词齐全；但简历没有微前端改造和 Kubernetes 部署的痕迹，需补证。",
  matchedKeywords: [
    { term: "React", importance: "must", evidence: "使用 React 18 + TypeScript 重构订单模块" },
    { term: "TypeScript", importance: "must", evidence: "使用 React 18 + TypeScript 重构订单模块" },
    { term: "性能优化", importance: "must", evidence: "主导性能优化专项，LCP 从 4.1s 降到 1.8s" },
    { term: "Node.js", importance: "must", evidence: "负责 Node.js BFF 层维护" },
  ],
  missingKeywords: [
    { term: "微前端", importance: "must", evidence: "" },
    { term: "Kubernetes", importance: "nice", evidence: "" },
  ],
  strengths: ["交易链路稳定性与性能指标可量化", "BFF 聚合层有真实落地"],
  gaps: ["补一个微前端拆分或接入的具体项目", "补充容器化部署与发布链路中的角色"],
  bulletRewrites: [
    {
      original: "负责交易链路 H5 与商家后台的前端开发",
      rewrite: "负责交易链路 H5 与商家后台前端架构，支撑大促峰值 QPS 3k，首屏耗时下降 65%",
      reason: "补充规模与量化结果，对齐岗位的稳定性要求",
    },
  ],
};

const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url?.endsWith("/chat/completions") !== true) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
    return;
  }

  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    let model = "fake-model";
    try {
      model = JSON.parse(body).model ?? model;
    } catch {
      // 请求体不可解析也照常返回，便于验证客户端的错误处理分支。
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        model,
        choices: [{ message: { role: "assistant", content: JSON.stringify(analysis) } }],
      }),
    );
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake OpenAI-compatible server: http://127.0.0.1:${port}/v1`);
});
