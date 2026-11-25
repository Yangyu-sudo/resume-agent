/**
 * 简历结构化模型与渲染。
 *
 * 解析是「尽力而为」的启发式：中文简历排版千差万别，这里的目标不是 100% 准确，
 * 而是给模型一个可靠起点 + 保留原文，让模型在此基础上纠错，而不是从零猜测。
 */

export interface ResumeBasics {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  links: string[];
}

export interface ResumeEntry {
  /** 公司 / 学校 / 项目名 */
  org: string;
  role: string;
  period: string;
  bullets: string[];
}

export interface ResumeProfile {
  basics: ResumeBasics;
  summary: string;
  experience: ResumeEntry[];
  projects: ResumeEntry[];
  education: ResumeEntry[];
  skills: string[];
  /** 带数字的成果句，改写时优先保留 */
  highlights: string[];
  stats: { chars: number; lines: number; bullets: number };
}

const SECTION_PATTERNS: Array<{ key: SectionKey; pattern: RegExp }> = [
  { key: "summary", pattern: /^(个人简介|自我评价|个人总结|简介|概述|summary|profile|about)$/i },
  { key: "experience", pattern: /^(工作经历|工作经验|职业经历|实习经历|工作履历|experience|employment)$/i },
  { key: "projects", pattern: /^(项目经历|项目经验|主要项目|projects?)$/i },
  { key: "education", pattern: /^(教育背景|教育经历|学历|education)$/i },
  { key: "skills", pattern: /^(专业技能|技能|技术栈|技能清单|个人技能|skills?)$/i },
  { key: "other", pattern: /^(荣誉|证书|获奖|奖项|其他|附加信息|awards?|certificates?)$/i },
];

type SectionKey = "summary" | "experience" | "projects" | "education" | "skills" | "other";

const BULLET_PATTERN = /^\s*(?:[-*•·▪●]|\d+[.、)]|[（(]\d+[)）])\s*/;
// 支持 2022.07 – 至今、2020/07~2022/06、2016 – 2020 这些常见写法
const PERIOD_PATTERN =
  /(?:19|20)\d{2}(?:[.\-/年]\s?\d{1,2}\s?月?)?\s*(?:[-–—~至到]\s*)?(?:(?:19|20)\d{2}(?:[.\-/年]\s?\d{1,2}\s?月?)?|至今|现在|present|now)?/i;

export function parseResumeText(text: string): ResumeProfile {
  const lines = text.split("\n");
  const trimmed = lines.map((line) => line.trim());

  const basics = parseBasics(trimmed);
  const sections = splitSections(trimmed);

  const experience = parseEntries(sections.get("experience") ?? []);
  const projects = parseEntries(sections.get("projects") ?? []);
  const education = parseEntries(sections.get("education") ?? []);
  const skills = parseSkills(sections.get("skills") ?? []);
  const summary = (sections.get("summary") ?? []).join(" ").trim();

  const allBullets = [...experience, ...projects, ...education].flatMap((entry) => entry.bullets);
  const highlights = allBullets.filter(isQuantified).slice(0, 12);

  return {
    basics,
    summary,
    experience,
    projects,
    education,
    skills,
    highlights,
    stats: {
      chars: text.length,
      lines: lines.filter((line) => line.trim() !== "").length,
      bullets: allBullets.length,
    },
  };
}

function parseBasics(lines: string[]): ResumeBasics {
  const head = lines
    .slice(0, 8)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter((line) => line !== "");
  const text = head.join(" ");

  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? "";
  const phone = text.match(/(?:\+?86[-\s]?)?1[3-9]\d{9}/)?.[0] ?? "";
  const links = [...text.matchAll(/https?:\/\/[^\s，,；;）)]+|(?:github|gitee)\.com\/[A-Za-z0-9_.-]+/gi)].map(
    (match) => match[0],
  );

  const name = head[0] !== undefined && head[0].length <= 20 && !head[0].includes("@") ? head[0] : "";
  const titleLine = head.find((line) => /工程师|开发|产品|设计师|经理|架构师|分析师|专家|负责人/.test(line)) ?? "";
  const locationMatch = text.match(/(北京|上海|深圳|杭州|广州|成都|武汉|南京|西安|苏州|长沙|重庆|厦门|合肥|天津)/);

  return {
    name,
    title: titleLine.replace(/[|·].*$/, "").trim(),
    email,
    phone,
    location: locationMatch?.[1] ?? "",
    links: [...new Set(links)].slice(0, 4),
  };
}

function splitSections(lines: string[]): Map<SectionKey, string[]> {
  const sections = new Map<SectionKey, string[]>();
  let current: SectionKey = "summary";

  for (const line of lines) {
    const heading = matchHeading(line);
    if (heading !== null) {
      current = heading;
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    const bucket = sections.get(current) ?? [];
    bucket.push(line);
    sections.set(current, bucket);
  }
  return sections;
}

function matchHeading(line: string): SectionKey | null {
  const clean = line.replace(/^#+\s*/, "").replace(/[:：]\s*$/, "").trim();
  if (clean === "" || clean.length > 12) return null;
  for (const { key, pattern } of SECTION_PATTERNS) {
    if (pattern.test(clean)) return key;
  }
  return null;
}

function parseEntries(lines: string[]): ResumeEntry[] {
  const entries: ResumeEntry[] = [];
  let current: ResumeEntry | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;

    if (BULLET_PATTERN.test(line)) {
      const bullet = line.replace(BULLET_PATTERN, "").trim();
      if (bullet === "") continue;
      if (current === null) {
        current = { org: "", role: "", period: "", bullets: [] };
        entries.push(current);
      }
      current.bullets.push(bullet);
      continue;
    }

    // 非要点行视为条目头：公司 · 职位 · 时间
    const period = line.match(PERIOD_PATTERN)?.[0] ?? "";
    const cleaned = line.replace(PERIOD_PATTERN, "").replace(/[|｜,，]\s*$/, "").trim();
    const parts = cleaned.split(/\s*[|｜·•]\s*|[—–-]{2,}/).map((part) => part.trim()).filter(Boolean);
    current = {
      org: parts[0] ?? cleaned,
      role: parts[1] ?? "",
      period: period.trim(),
      bullets: [],
    };
    entries.push(current);
  }

  return entries.filter((entry) => entry.bullets.length > 0 || entry.org !== "");
}

function parseSkills(lines: string[]): string[] {
  const joined = lines.join("\n");
  const parts = joined
    .split(/[、,，;；\n|｜/]/)
    .map((part) => part.replace(BULLET_PATTERN, "").trim())
    .filter((part) => part !== "" && part.length <= 24);
  return [...new Set(parts)].slice(0, 40);
}

function isQuantified(bullet: string): boolean {
  if (!/\d/.test(bullet)) return false;
  return /(%|％|倍|万|亿|ms|毫秒|秒|小时|天|人|个|K|W|QPS)/i.test(bullet) || /\d\s?(s|min|h|w|k)\b/i.test(bullet);
}

export interface RenderOptions {
  /** 输出文件标题（通常写「姓名 - 目标岗位」） */
  headline?: string;
}

export function renderResumeMarkdown(profile: ResumeProfile, options: RenderOptions = {}): string {
  const lines: string[] = [];
  const { basics } = profile;

  lines.push(`# ${basics.name || "未命名"}`, "");
  const contact = [basics.title, basics.location, basics.email, basics.phone, ...basics.links]
    .filter((item) => item !== "")
    .join(" · ");
  if (contact !== "") lines.push(contact, "");
  if (options.headline !== undefined && options.headline !== "") lines.push(`> 求职目标：${options.headline}`, "");

  if (profile.summary !== "") {
    lines.push("## 个人简介", "", profile.summary, "");
  }

  pushEntries(lines, "工作经历", profile.experience);
  pushEntries(lines, "项目经历", profile.projects);

  if (profile.education.length > 0) {
    lines.push("## 教育背景", "");
    for (const entry of profile.education) {
      const head = [entry.org, entry.role, entry.period].filter(Boolean).join(" · ");
      lines.push(`### ${head}`, "");
      for (const bullet of entry.bullets) lines.push(`- ${bullet}`);
      if (entry.bullets.length > 0) lines.push("");
    }
  }

  if (profile.skills.length > 0) {
    lines.push("## 专业技能", "");
    // 模型可能把多组技能塞进一个字符串（用换行分隔），这里统一拆成逐行要点
    const items = profile.skills
      .flatMap((skill) => skill.split(/\n+/))
      // 模型可能自带项目符号，去掉后再统一渲染，避免出现「• ○」双符号
      .map((skill) => skill.replace(/^[\s\-*•·▪●○◦]+/, "").trim())
      .filter((skill) => skill !== "");
    if (items.some((skill) => /[：:]/.test(skill))) {
      for (const skill of items) lines.push(`- ${skill}`);
    } else {
      lines.push(items.join("、"));
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function pushEntries(lines: string[], title: string, entries: ResumeEntry[]): void {
  if (entries.length === 0) return;
  lines.push(`## ${title}`, "");
  for (const entry of entries) {
    const head = [entry.org, entry.role, entry.period].filter(Boolean).join(" · ");
    if (head !== "") lines.push(`### ${head}`, "");
    for (const bullet of entry.bullets) lines.push(`- ${bullet}`);
    lines.push("");
  }
}
