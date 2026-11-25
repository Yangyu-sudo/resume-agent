import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../config";

/**
 * MCP 工具服务的启动方式。
 * 优先用 esbuild 打好的单文件（dist/mcp-server.mjs）；
 * 还没构建时退回 tsx，保证 `npm run dev` 开箱即用。
 */
export function mcpLaunch(): { command: string; args: string[] } {
  const bundled = resolve(ROOT, "dist/mcp-server.mjs");
  if (existsSync(bundled)) {
    return { command: process.execPath, args: [bundled] };
  }
  return { command: process.execPath, args: ["--import", "tsx", resolve(ROOT, "tools/src/mcp-server.ts")] };
}
