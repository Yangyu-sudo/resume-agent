import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ROOT, WORKSPACE_DIR, UPLOAD_DIR, OUTPUT_DIR } from "../config";

/**
 * 生成 DSH profile 补丁（--patch 叠加层）。
 *
 * 这样做而不是写死一份静态 YAML：MCP 工具的启动命令必须是「当前正在跑服务的 Node 绝对路径」，
 * 换机器、换 Node 安装位置时都不用改配置。
 */

export interface PatchOptions {
  /** 运行时补丁文件落盘位置 */
  filePath: string;
  /** MCP 服务器可执行文件（node）与脚本参数 */
  mcpCommand: string;
  mcpArgs: string[];
  persona: string;
}

/** sdk profile 里默认挂载、但在简历场景不需要的工具。 */
const DISABLED_ENTRIES = [
  "tool-plugin-manager",
  "plugin-manager",
  "tool-bash",
  "tool-pwsh",
  "tool-jobs",
  "tool-fs",
  "tool-fs-search",
  "tool-skill",
  "tool-subagent",
  "tool-subagent-control",
  "tool-subagent-fork",
  "tool-workflow",
  "tool-todo",
  "tool-goal",
  "tool-web",
  "tool-schedule",
  "tool-ask-user",
  "present",
  "commands",
  "goal",
  "plan-mode",
  "subagent",
  "web",
  "skill",
  // 依赖上面被禁用的服务，一并关掉避免启动时大量 pending 警告
  "skill-filesystem",
  "command-feedback",
  "command-goal",
  "command-compact",
  "goal-round-driver",
  "subagent-spawn-in-process",
  "subagent-fork-in-process",
  "workflow-ptc",
];

export function buildPatchYaml(options: PatchOptions): string {
  const lines: string[] = [];

  lines.push("# 由 ResumeAgent 服务端在启动时生成，请勿手改", "");
  lines.push("- id: system-prompt", "  config:", `    personaPrefix: ${blockScalar(options.persona, 6)}`, "");

  for (const id of DISABLED_ENTRIES) {
    lines.push(`- id: ${id}`, "  disabled: true");
  }

  lines.push(
    "- insert:",
    "    - id: mcp-resume",
    "      name: '@deepseek-ai/dsh-mcp-client'",
    "      config:",
    "        serverName: resume",
    "        transport: stdio",
    `        command: ${quote(options.mcpCommand)}`,
    "        args:",
    ...options.mcpArgs.map((arg) => `          - ${quote(arg)}`),
    `        cwd: ${quote(ROOT)}`,
    "        env:",
    `          RESUME_WORKSPACE: ${quote(WORKSPACE_DIR)}`,
    `          RESUME_UPLOAD_DIR: ${quote(UPLOAD_DIR)}`,
    `          RESUME_OUTPUT_DIR: ${quote(OUTPUT_DIR)}`,
    "          NODE_ENV: production",
  );

  return `${lines.join("\n")}\n`;
}

export function writePatch(filePath: string, options: Omit<PatchOptions, "filePath">): string {
  const target = resolve(filePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buildPatchYaml({ ...options, filePath: target }), "utf8");
  return target;
}

export function patchExists(filePath: string): boolean {
  return existsSync(filePath);
}

/** 单引号标量：YAML 里只有 ' 需要转义，反斜杠原样保留，适合 Windows 路径。 */
function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** 块标量：多行人设文本，缩进后整体作为字符串。 */
function blockScalar(text: string, indent: number): string {
  const padding = " ".repeat(indent);
  const body = text
    .split("\n")
    .map((line) => (line === "" ? "" : `${padding}${line}`))
    .join("\n");
  return `|\n${body}`;
}
