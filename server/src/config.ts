import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根目录（server/src/config.ts 往上两级） */
export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const WORKSPACE_DIR = process.env.RESUME_WORKSPACE ?? resolve(ROOT, "workspace");
export const UPLOAD_DIR = resolve(WORKSPACE_DIR, "uploads");
export const OUTPUT_DIR = resolve(WORKSPACE_DIR, "outputs");
export const DATA_DIR = process.env.RESUME_DATA_DIR ?? resolve(ROOT, "data");

export const PORT = Number(process.env.PORT ?? 5178);
export const HOST = process.env.HOST ?? "127.0.0.1";

/**
 * 内嵌的 DSH 运行时启动参数。
 * 默认指向本机安装的 DeepSeek Harness 桌面版：它在 app.asar 里携带完整的 sdk profile。
 * 换机器时通过环境变量覆盖，或把 dsh 装进 PATH 后设置 DSH_LAUNCH_COMMAND=dsh。
 */
export const DSH = {
  command: process.env.DSH_LAUNCH_COMMAND ?? "D:\\Deepseek\\DeepSeek Harness.exe",
  cliPath:
    process.env.DSH_CLI_PATH ??
    "D:\\Deepseek\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js",
  /** 注意：不要读 DSH_PROFILE —— 那是桌面版宿主进程的变量，会把 profile 指到 desktop。 */
  profile: process.env.RESUME_DSH_PROFILE ?? "sdk",
  /** 启动时生成的补丁文件目录（含人设与 MCP 工具定义） */
  patchDir: process.env.DSH_PATCH_DIR ?? resolve(ROOT, ".runtime"),
  mcpServer: resolve(ROOT, "dist/mcp-server.mjs"),
  provider: process.env.DSH_MODEL_PROVIDER ?? "deepseek-official",
  model: process.env.DSH_MODEL ?? "deepseek-flash",
  maxTokens: Number(process.env.DSH_MAX_TOKENS ?? 8192),
  /** 设为独立目录可让 ResumeAgent 的会话与桌面版互不干扰 */
  home: process.env.RESUME_DSH_HOME,
};

export const LANGFUSE = {
  publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? "",
  secretKey: process.env.LANGFUSE_SECRET_KEY ?? "",
  baseUrl: process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com",
};

export function ensureDirs(): void {
  for (const dir of [WORKSPACE_DIR, UPLOAD_DIR, OUTPUT_DIR, DATA_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export function assertRuntimeConfigured(): void {
  if (!existsSync(DSH.command)) {
    throw new Error(
      `找不到 DSH 运行时：${DSH.command}。请安装 DeepSeek Harness，或用 DSH_LAUNCH_COMMAND / DSH_CLI_PATH 指定可执行文件与 cli.js。`,
    );
  }
}

export { dirname };
