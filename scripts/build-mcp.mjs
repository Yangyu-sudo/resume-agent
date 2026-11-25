import { build } from "esbuild";

/**
 * 把 MCP 工具服务打成单文件 dist/mcp-server.mjs：
 * 运行时由 DSH 以 `node dist/mcp-server.mjs` 启动，不依赖 tsx 与 node_modules。
 */
await build({
  entryPoints: ["tools/src/mcp-server.ts"],
  outfile: "dist/mcp-server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  minify: false,
  logLevel: "info",
  // mupdf 带 .wasm 资产，不能内联进单文件；运行时从 node_modules 解析
  external: ["mupdf"],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
