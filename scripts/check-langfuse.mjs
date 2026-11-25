/**
 * Langfuse 连通性自检：不用启动服务，验证「网络 + 密钥 + 写入通道」。
 *
 *   npm run langfuse:check
 *
 * 读取项目根目录 .env 的 LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_HOST。
 * 说明：Langfuse v4 的 events_only 模式不再接受 /api/public/ingestion 的 trace，
 * 所以这里直接向 OTLP 端点 POST 一条最小 span 来验证写入是否被接受。
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// 自己解析 .env：process.loadEnvFile 遇到带 BOM 的文件会漏掉第一个键
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  const raw = readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const publicKey = process.env.LANGFUSE_PUBLIC_KEY ?? "";
const secretKey = process.env.LANGFUSE_SECRET_KEY ?? "";
const host = (process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com").replace(/\/+$/, "");

if (publicKey === "" || secretKey === "") {
  console.error("✗ 没有配置密钥。请在项目根目录的 .env 里填写：");
  console.error("  LANGFUSE_PUBLIC_KEY=pk-lf-...");
  console.error("  LANGFUSE_SECRET_KEY=sk-lf-...");
  console.error(`  LANGFUSE_HOST=${host}`);
  process.exit(1);
}

const authorization = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`;

console.log(`→ Host: ${host}`);
console.log(`→ Public key: ${publicKey.slice(0, 8)}…（长度 ${publicKey.length}）`);

// 1) 网络 + 版本
let version = "unknown";
try {
  const response = await fetch(`${host}/api/public/health`, { signal: AbortSignal.timeout(10_000) });
  const body = await response.json().catch(() => ({}));
  version = body.version ?? "unknown";
  console.log(`→ 网络：HTTP ${response.status}（Langfuse ${version}）`);
} catch (error) {
  console.error(`✗ 连不上 ${host}：${error instanceof Error ? error.message : error}`);
  console.error("  国内访问 cloud.langfuse.com 可能不稳，可改用自托管并设置 LANGFUSE_HOST。");
  process.exit(2);
}

// 2) 鉴权（public API 用 Basic）
try {
  const response = await fetch(`${host}/api/public/projects`, {
    headers: { authorization },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) {
    console.error(`✗ 密钥无效（HTTP ${response.status}）：key 与 host 区域不匹配，或 key 已被删除。`);
    console.error("  区域对照：EU = cloud.langfuse.com，US = us.cloud.langfuse.com，自托管 = 你的域名。");
    process.exit(3);
  }
  console.log(`→ 鉴权：HTTP ${response.status}`);
} catch (error) {
  console.error(`✗ 鉴权请求失败：${error instanceof Error ? error.message : error}`);
  process.exit(3);
}

// 3) OTLP 写入通道：发一条最小 span，看服务端是否接受
const now = Date.now();
const payload = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "resume-agent-check" } },
        ],
      },
      scopeSpans: [
        {
          scope: { name: "resume-agent-check", version: "1.0.0" },
          spans: [
            {
              traceId: randomBytes(16).toString("hex"),
              spanId: randomBytes(8).toString("hex"),
              name: "resume-agent.connectivity-check",
              kind: 1,
              startTimeUnixNano: String(now * 1_000_000),
              endTimeUnixNano: String((now + 5) * 1_000_000),
              attributes: [
                { key: "langfuse.observation.type", value: { stringValue: "span" } },
                { key: "langfuse.trace.name", value: { stringValue: "resume-agent.connectivity-check" } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

try {
  const response = await fetch(`${host}/api/public/otel/v1/traces`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const text = (await response.text()).slice(0, 300);
  if (response.status >= 200 && response.status < 300) {
    console.log(`→ OTLP 写入：HTTP ${response.status}（已接受）`);
    console.log("✓ 全部通过。打开 Langfuse → Traces，按 name = resume-agent.connectivity-check 查看这条测试；");
    console.log("  正式对话的 trace 名字是 resume-agent.turn。重启服务后生效。");
    process.exit(0);
  }
  console.error(`✗ OTLP 写入被拒绝：HTTP ${response.status} ${text}`);
  process.exit(4);
} catch (error) {
  console.error(`✗ OTLP 写入失败：${error instanceof Error ? error.message : error}`);
  process.exit(4);
}
