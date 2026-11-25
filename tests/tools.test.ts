import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeToolResult, encodeToolResult } from "../shared/tool-payload";
import { buildPatchYaml } from "../server/src/agent/patch";
import { parseResumeText, renderResumeMarkdown } from "../tools/src/resume";

const sample = readFileSync(resolve("fixtures/resume.sample.md"), "utf8");

describe("parseResumeText", () => {
  const profile = parseResumeText(sample);

  it("取到姓名与联系方式", () => {
    expect(profile.basics.name).toBe("张晨");
    expect(profile.basics.email).toBe("zhangchen@example.com");
    expect(profile.basics.location).toBe("上海");
  });

  it("按小节切分经历，并保住时间区间", () => {
    expect(profile.experience.length).toBeGreaterThanOrEqual(2);
    const first = profile.experience[0];
    expect(first?.org).toContain("某电商公司");
    expect(first?.period).toContain("2022.07");
    expect(first?.period).toContain("至今");
  });

  it("识别技能与量化成果", () => {
    expect(profile.skills).toContain("React");
    expect(profile.skills).toContain("TypeScript");
    expect(profile.highlights.length).toBeGreaterThan(0);
    expect(profile.highlights.some((item) => item.includes("3.2s"))).toBe(true);
  });

  it("统计正文规模", () => {
    expect(profile.stats.chars).toBeGreaterThan(500);
    expect(profile.stats.bullets).toBeGreaterThanOrEqual(6);
  });
});

describe("renderResumeMarkdown", () => {
  it("渲染出结构化 Markdown", () => {
    const profile = parseResumeText(sample);
    const markdown = renderResumeMarkdown(profile, { headline: "高级前端工程师" });
    expect(markdown).toContain("# 张晨");
    expect(markdown).toContain("## 工作经历");
    expect(markdown).toContain("## 专业技能");
    expect(markdown).toContain("求职目标：高级前端工程师");
  });
});

describe("tool payload", () => {
  it("编码后可以解码出摘要、结构化数据与产物", () => {
    const text = encodeToolResult({
      ok: true,
      summary: "已生成",
      data: { chars: 12 },
      artifacts: [{ name: "a.md", path: "D:/x/a.md", bytes: 12 }],
    });
    const decoded = decodeToolResult(text);
    expect(decoded?.ok).toBe(true);
    expect(decoded?.summary).toBe("已生成");
    expect(decoded?.artifacts?.[0]?.name).toBe("a.md");
  });

  it("普通文本返回 null", () => {
    expect(decodeToolResult("没有 JSON 的一段话")).toBeNull();
  });
});

describe("buildPatchYaml", () => {
  const yaml = buildPatchYaml({
    filePath: "x.yml",
    mcpCommand: "C:\\node.exe",
    mcpArgs: ["D:\\app\\mcp.mjs"],
    persona: "你是 ResumeAgent。\n第二行",
  });

  it("写入人设、MCP 工具与禁用项", () => {
    expect(yaml).toContain("personaPrefix: |");
    expect(yaml).toContain("你是 ResumeAgent。");
    expect(yaml).toContain("name: '@deepseek-ai/dsh-mcp-client'");
    expect(yaml).toContain("serverName: resume");
    expect(yaml).toContain("command: 'C:\\node.exe'");
    expect(yaml).toContain("- id: tool-bash");
  });
});
