#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import { extractDocument } from "../../shared/extract";
import { encodeToolResult } from "../../shared/tool-payload";
import { markdownToPdf } from "./pdf";
import { parseResumeText, renderResumeMarkdown } from "./resume";
import { OUTPUT_DIR, resolveOutput, resolveReadable } from "./workspace";

/**
 * ResumeAgent 的工具服务（MCP stdio）。
 *
 * 分工：模型负责判断与措辞；工具负责确定性的读写、结构化、排版和落盘。
 * stdout 专用于 JSON-RPC，日志一律走 stderr。
 */

mkdirSync(OUTPUT_DIR, { recursive: true });

const server = new McpServer({ name: "resume-tools", version: "0.1.0" });

const entrySchema = z.object({
  org: z.string().default("").describe("公司 / 学校 / 项目名"),
  role: z.string().default("").describe("职位 / 专业 / 角色"),
  period: z.string().default("").describe("时间区间，例如 2022.07 – 至今"),
  bullets: z.array(z.string()).default([]).describe("要点，一条一个成果"),
});

const profileSchema = z.object({
  basics: z.object({
    name: z.string().describe("姓名"),
    title: z.string().default("").describe("目标职位或当前职位"),
    email: z.string().default(""),
    phone: z.string().default(""),
    location: z.string().default(""),
    links: z.array(z.string()).default([]),
  }),
  summary: z.string().default("").describe("个人简介，2-4 句"),
  experience: z.array(entrySchema).default([]),
  projects: z.array(entrySchema).default([]),
  education: z.array(entrySchema).default([]),
  skills: z.array(z.string()).default([]),
  highlights: z.array(z.string()).default([]).describe("带数字的关键成果"),
});

server.registerTool(
  "resume_parse",
  {
    title: "解析简历",
    description:
      "读取用户上传的简历文件（PDF/DOCX/MD/TXT），返回结构化字段与原文预览。改写简历前先调用它，不要凭空猜测简历内容。",
    inputSchema: {
      path: z.string().describe("简历文件的绝对路径，通常来自用户消息里的附件路径"),
    },
  },
  async ({ path }) => {
    try {
      const target = resolveReadable(path);
      const document = await extractDocument(target);
      const profile = parseResumeText(document.text);
      const text = encodeToolResult({
        ok: true,
        summary: `已解析《${basename(target)}》：${profile.stats.lines} 行正文、${profile.stats.bullets} 条要点、${profile.skills.length} 项技能${profile.highlights.length > 0 ? `、${profile.highlights.length} 条量化成果` : ""}。原文如下，供你核对。`,
        data: {
          profile,
          rawText: document.text.slice(0, 6000),
        },
      });
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return toolError(error);
    }
  },
);

server.registerTool(
  "resume_rewrite",
  {
    title: "生成改写版简历",
    description:
      "把结构化的简历内容渲染成排版统一的 Markdown 文件并落盘，返回可下载文件。模型负责内容与措辞，工具负责模板与保存。",
    inputSchema: {
      profile: profileSchema,
      headline: z.string().default("").describe("求职目标，例如「高级前端工程师 · 字节跳动」"),
    },
  },
  async ({ profile, headline }) => {
    try {
      const markdown = renderResumeMarkdown(
        { ...profile, stats: { chars: 0, lines: 0, bullets: 0 } },
        { headline },
      );
      const safeName = headline === "" ? profile.basics.name : `${profile.basics.name}-${headline}`;
      const target = resolveOutput(safeName, "md");
      writeFileSync(target, markdown, "utf8");
      const text = encodeToolResult({
        ok: true,
        summary: `已生成改写版简历，共 ${markdown.length} 字，文件可在界面下载。`,
        data: { path: target, chars: markdown.length, preview: markdown.slice(0, 1200) },
        artifacts: [{ name: basename(target), path: target, bytes: Buffer.byteLength(markdown, "utf8") }],
      });
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return toolError(error);
    }
  },
);

server.registerTool(
  "pdf_generate",
  {
    title: "导出 PDF",
    description:
      "把上一步生成的 Markdown 简历渲染成 A4 PDF 并落盘，返回可下载文件。仅在用户明确需要 PDF 时调用。",
    inputSchema: {
      markdownPath: z.string().describe("resume_rewrite 返回的 Markdown 绝对路径"),
      fileName: z.string().default("").describe("输出文件名（不含扩展名），留空则沿用源文件名"),
    },
  },
  async ({ markdownPath, fileName }) => {
    try {
      const source = resolveReadable(markdownPath);
      const markdown = readFileSync(source, "utf8");
      const target = resolveOutput(fileName === "" ? basename(source, ".md") : fileName, "pdf");
      mkdirSync(OUTPUT_DIR, { recursive: true });
      await markdownToPdf(markdown, target, basename(target));
      const bytes = statSync(target).size;
      const text = encodeToolResult({
        ok: true,
        summary: `已生成 PDF（${(bytes / 1024).toFixed(0)} KB），可在界面下载。`,
        data: { path: target, bytes },
        artifacts: [{ name: basename(target), path: target, bytes }],
      });
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return toolError(error);
    }
  },
);

function toolError(error: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[resume-tools]", message);
  return {
    content: [
      {
        type: "text",
        text: encodeToolResult({ ok: false, summary: `工具执行失败：${message}` }),
      },
    ],
    isError: true,
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[resume-tools] MCP server ready");
