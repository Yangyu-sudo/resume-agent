# 06 - MCP 工具

这一章覆盖工具服务的所有手写代码：

| 文件 | 行号 |
|---|---|
| `tools/src/workspace.ts` | 1-48 |
| `tools/src/resume.ts` | 1-249 |
| `tools/src/pdf.ts` | 1-101 |
| `tools/src/mcp-server.ts` | 1-159 |

工具层是项目的“确定性部分”。模型负责判断和措辞，工具负责解析、模板、文件边界和 PDF。

## 1. tools/src/workspace.ts

### 行 1-2：依赖

```ts
import { existsSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
```

工具进程通过环境变量接收服务端的工作区路径，因此路径边界必须在工具内部再验证一次。

### 行 4-7：设计原则

模型给的路径来自对话，按不可信输入处理：

- 读只能落在工作区。
- 写只能落在 outputs。

### 行 9-11：路径配置

```ts
export const WORKSPACE =
  resolve(process.env.RESUME_WORKSPACE ?? process.cwd());
export const UPLOAD_DIR =
  resolve(
    process.env.RESUME_UPLOAD_DIR ??
      join(WORKSPACE, "uploads")
  );
export const OUTPUT_DIR =
  resolve(
    process.env.RESUME_OUTPUT_DIR ??
      join(WORKSPACE, "outputs")
  );
```

优先级：

1. patch 传给工具进程的显式环境变量。
2. 默认基于当前工作目录或 workspace。

服务端启动 MCP 时会把三个值写进 patch YAML，避免工具进程猜错目录。

### 行 13-22：resolveReadable

```ts
const target = resolve(input);
if (!isInside(WORKSPACE, target)) {
  throw new Error(`路径不在工作区内：${input}`);
}
if (!existsSync(target)) {
  throw new Error(`文件不存在：${input}`);
}
return target;
```

步骤：

1. 把相对路径转成绝对路径。
2. 做词法边界判断。
3. 检查存在。

当前检查是 `resolve` 级，不是 `realpath` 级。如果工作区内存在指向外部的符号链接，边界仍可能被绕过。对本机单用户 MVP 可以接受，但不是强沙箱。

### 行 24-34：resolveOutput

```ts
const safe = sanitize(basename(fileName))
  .replace(/\.(md|pdf|markdown)$/i, "")
  .slice(0, 60);
const name = `${safe === "" ? "resume" : safe}-${stamp()}.${extension}`;
const target = resolve(join(OUTPUT_DIR, name));
if (!isInside(OUTPUT_DIR, target)) {
  throw new Error(`输出路径非法：${fileName}`);
}
return target;
```

处理顺序：

1. `basename` 去掉目录。
2. `sanitize` 删除 Windows 非法字符和控制字符。
3. 去掉源扩展名，避免生成 `a.md-...pdf`。
4. 最多保留 60 字。
5. 空名字回退 `resume`。
6. 加秒级时间戳。
7. 再加目标扩展名。
8. 最终再检查一次边界。

时间戳只到秒。如果同一秒内两次生成同名文件，后一次会覆盖前一次。当前产品通常每轮只生成一个版本，因此可以接受。

### 行 36-38：isInside

```ts
return target === root || target.startsWith(root + sep);
```

允许根本身，也允许根下的子路径。`root + sep` 防止 `uploads-evil` 这种同前缀目录被误判。

### 行 40-42：sanitize

```ts
return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim();
```

去掉 Windows 不允许的字符：

```text
\ / : * ? " < > |
```

以及 C0 控制字符。

注意 `basename()` 在不同平台使用不同分隔符。当前部署以 Windows 为主，工具路径通常来自 Windows 工作区。跨平台部署时要重新测试路径处理。

### 行 44-48：stamp

```ts
const now = new Date();
const pad = (value) => String(value).padStart(2, "0");
return `${year}${month}${day}-${hour}${minute}${second}`;
```

本地时间格式：

```text
20261114-230558
```

不包含毫秒，也不包含时区。

## 2. tools/src/resume.ts

这个文件包含“尽力而为”的简历解析器和统一 Markdown 渲染器。

### 行 1-6：设计边界

简历排版差异很大，解析器不追求 100% 正确，而是：

- 给模型一个可靠起点。
- 保留原文。
- 让模型在原文基础上纠错。

### 行 8-15：ResumeBasics

```ts
name, title, email, phone, location, links
```

这些字段来自简历头部前 8 个非空行。

### 行 17-23：ResumeEntry

```ts
org, role, period, bullets
```

用同一个结构表达：

- 公司经历。
- 项目经历。
- 教育经历。

字段语义由所在数组决定。

### 行 25-35：ResumeProfile

```ts
basics
summary
experience
projects
education
skills
highlights
stats
```

`highlights` 是从所有 bullet 中筛出的带数字成果，用于模型优先保留量化信息。

### 行 37-46：SECTION_PATTERNS

每个 section 用中英文正则匹配。

例如 work：

```text
工作经历、工作经验、职业经历、实习经历、工作履历、experience、employment
```

`SectionKey` 是六类：

```ts
summary | experience | projects | education | skills | other
```

### 行 48：BULLET_PATTERN

```ts
/^\s*(?:[-*•·▪●]|\d+[.、)]|[（(]\d+[)）])\s*/
```

支持：

- `-`
- `*`
- 各种圆点符号。
- `1.`
- `1、`
- `1)`
- `(1)`
- `（1）`

匹配后会把符号去掉，只留下正文。

### 行 49-51：PERIOD_PATTERN

这是解析经历头部的关键正则。它支持：

- `2022.07 - 至今`
- `2020/07~2022/06`
- `2016 – 2020`
- `2020年7月` 这类写法。

组成部分：

- `(?:19|20)\d{2}`：四位年份。
- 可选月份。
- 可选连接符。
- 可选结束时间或“至今/现在/present/now”。

它是宽泛匹配，不保证一定完整吃掉整行。后面还会用行替换清理残留。

### 行 53-83：parseResumeText

流程：

1. 按换行切 lines。
2. 每行 trim 成 trimmed。
3. `parseBasics(trimmed)`。
4. `splitSections(trimmed)`。
5. 分别解析 experience、projects、education。
6. 解析 skills。
7. summary 直接拼接。
8. 汇总 bullets。
9. 筛带数字成果。
10. 返回 profile 和 stats。

注意 `text.split("\n")` 假设输入已经 normalize 成 LF。上传层和工具抽取层都会先 normalize。

### 行 66-67：highlights

```ts
const allBullets = [
  ...experience,
  ...projects,
  ...education,
].flatMap((entry) => entry.bullets);
const highlights =
  allBullets.filter(isQuantified).slice(0, 12);
```

去掉专业边界，只保留量化成果，最多 12 条。

### 行 69-82：stats

```ts
chars: text.length
lines: 非空行数
bullets: allBullets.length
```

`chars` 是 JS UTF-16 code unit 数，不是严格字节数。中文大多也是一个 code unit，emoji 可能是两个。

### 行 85-110：parseBasics

```ts
const head = lines
  .slice(0, 8)
  .map(line => line.replace(/^#+\s*/, "").trim())
  .filter(line => line !== "");
const text = head.join(" ");
```

只看前 8 行，去掉 Markdown 标题井号。

#### 邮箱

```ts
/[\w.+-]+@[\w-]+\.[\w.]+/
```

支持常见字母、数字、下划线、点、加号和短横线。

#### 手机

```ts
/(?:\+?86[-\s]?)?1[3-9]\d{9}/
```

支持中国大陆手机号，可选 +86 或 86 前缀。

#### 链接

```ts
/https?:\/\/[^\s，,；;）)]+|(?:github|gitee)\.com\/[A-Za-z0-9_.-]+/gi
```

支持完整 URL，也支持 GitHub/Gitee 域名加用户名。

#### 姓名

```ts
const name =
  head[0] !== undefined &&
  head[0].length <= 20 &&
  !head[0].includes("@")
    ? head[0]
    : "";
```

启发式：

- 第一行。
- 不超过 20 字。
- 不像邮箱。

#### 职位行

```ts
/工程师|开发|产品|设计师|经理|架构师|分析师|专家|负责人/
```

在前 8 行中找第一个包含这些词的英雄行。

#### 地点

只匹配一批常见中国城市。没有全国城市库。

#### 去重

```ts
[...new Set(links)].slice(0, 4)
```

链接最多四个。

### 行 112-128：splitSections

从 `summary` 开始，逐行判断 heading。

遇到 heading：

- 更新 current。
- 如果 section 不存在，创建空数组。
- 不把 heading 本身加入内容。

其他行加入当前 section。

### 行 130-137：matchHeading

```ts
const clean = line
  .replace(/^#+\s*/, "")
  .replace(/[:：]\s*$/, "")
  .trim();
if (clean === "" || clean.length > 12) return null;
```

规则：

- 去掉 Markdown #。
- 去掉末尾中英文冒号。
- 空行或超过 12 字不当作 heading。

然后用 SECTION_PATTERNS 匹配。

### 行 139-172：parseEntries

逐行处理：

#### bullet 行

```ts
if (BULLET_PATTERN.test(line)) {
  const bullet = line.replace(BULLET_PATTERN, "").trim();
  if (bullet === "") continue;
  if (current === null) {
    current = {
      org: "",
      role: "",
      period: "",
      bullets: [],
    };
    entries.push(current);
  }
  current.bullets.push(bullet);
  continue;
}
```

如果第一条就是 bullet，会创建一个空头部条目，保证 bullet 不丢。

#### 非 bullet 行

```ts
const period = line.match(PERIOD_PATTERN)?.[0] ?? "";
const cleaned = line
  .replace(PERIOD_PATTERN, "")
  .replace(/[|｜,，]\s*$/, "")
  .trim();
const parts = cleaned
  .split(/\s*[|｜·•]\s*|[—–-]{2,}/)
  .map(part => part.trim())
  .filter(Boolean);
```

非 bullet 被视为新条目头：

- 提取 period。
- 移除 period。
- 按 `|`、`·`、两个以上短横线等切分。

第一段是 org，第二段是 role。多余段当前忽略。

#### 返回

```ts
return entries.filter(
  entry => entry.bullets.length > 0 || entry.org !== "",
);
```

过滤完全空条目。

### 行 174-181：parseSkills

```ts
const joined = lines.join("\n");
const parts = joined
  .split(/[、,，;；\n|｜/]/)
  .map(part => part.replace(BULLET_PATTERN, "").trim())
  .filter(part => part !== "" && part.length <= 24);
return [...new Set(parts)].slice(0, 40);
```

技能分隔符：

- 中文顿号。
- 中英文逗号。
- 分号。
- 换行。
- 竖线。
- 斜杠。

过滤过长文本，避免把整段句子当技能；最多 40 项；去重。

### 行 183-186：isQuantified

必须：

1. 含数字。
2. 含结果单位或时间单位。

单位示例：

```text
% ％ 倍 万 亿 ms 毫秒 秒 小时 天 人 个 K W QPS
```

或匹配 `3s`、`10min`、`2h`、`4w`、`20k`。

这比“只含数字”更可靠，避免把年份、日期误当量化成果。

### 行 188-191：RenderOptions

当前只有 `headline`，作为求职目标。

### 行 193-238：renderResumeMarkdown

输出顺序：

1. `# 姓名`
2. 联系方式行。
3. 求职目标 blockquote。
4. 个人简介。
5. 工作经历。
6. 项目经历。
7. 教育背景。
8. 专业技能。

#### 标题与联系方式

```ts
lines.push(`# ${basics.name || "未命名"}`, "");
const contact = [
  basics.title,
  basics.location,
  basics.email,
  basics.phone,
  ...basics.links,
]
  .filter(item => item !== "")
  .join(" · ");
```

空字段不输出分隔符。

#### 求职目标

```ts
if (options.headline !== undefined && options.headline !== "") {
  lines.push(`> 求职目标：${options.headline}`, "");
}
```

#### 教育

教育单独渲染，因为通常希望 org、role、period 出现在同一个三级标题。

#### 技能

```ts
const items = profile.skills
  .flatMap(skill => skill.split(/\n+/))
  .map(skill => skill.replace(/^[\s\-*•·▪●○◦]+/, "").trim())
  .filter(skill => skill !== "");

if (items.some(skill => /[：:]/.test(skill))) {
  for (const skill of items) lines.push(`- ${skill}`);
} else {
  lines.push(items.join("、"));
}
```

规则：

- 模型可能把一个技能项写成多行，先拆。
- 去掉自带项目符号，避免双重符号。
- 如果任何一项包含冒号，认为它是“分类：内容”结构，全部用 bullet。
- 否则用顿号连成一段。

#### 结尾

```ts
return `${lines.join("\n").trimEnd()}\n`;
```

去掉尾部多余空行，但保留最后换行。

### 行 240-249：pushEntries

通用工作经历和项目经历渲染：

- 没有条目就不输出 section。
- 有 org/role/period 就生成三级标题。
- 每条 bullet 输出为 Markdown list。
- 每个条目后空一行。

## 3. tools/src/pdf.ts

### 行 1-3：依赖

`puppeteer-core` 需要外部浏览器，因此项目不打包 Chromium。`marked` 负责 Markdown 到 HTML。

### 行 5-7：设计说明

使用本机 Chrome/Edge：

- 不增加几百 MB Chromium 包。
- 直接使用系统中文字体。

### 行 9-18：浏览器候选

顺序：

1. `RESUME_BROWSER_PATH`
2. Windows Edge 32/64 位路径
3. Windows Chrome 路径
4. Linux 路径
5. macOS Chrome 路径

`filter` 去掉 undefined 和空字符串。

### 行 20-22：findBrowser

找到第一个存在的可执行文件，找不到返回 null。

### 行 24-53：markdownToPdf

#### 浏览器检查

```ts
if (browserPath === null) {
  throw new Error("找不到可用的 Chrome / Edge...");
}
```

#### HTML

```ts
const html = renderHtml(markdown, title);
```

#### 启动

```ts
const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--font-render-hinting=none",
  ],
});
```

参数用途：

- 无头模式。
- 避免沙箱问题。
- 禁用 GPU。
- 兼容较小 `/dev/shm`。
- 让字体栅格更适合 PDF。

#### 打印

```ts
await page.setContent(html, { waitUntil: "load" });
await page.pdf({
  path: outputPath,
  format: "A4",
  printBackground: true,
  margin: {
    top: "16mm",
    bottom: "16mm",
    left: "15mm",
    right: "15mm",
  },
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: "...pageNumber...",
});
```

页脚只显示页码，不显示 URL 或日期。

#### finally

无论打印成功还是失败，都关闭 browser。

### 行 55-93：renderHtml

```ts
const body = marked.parse(markdown, {
  async: false,
  gfm: true,
});
```

`marked.parse` 生成 HTML 片段，然后嵌入固定模板。

CSS 关键点：

- A4 打印底色。
- 中文字体回退列表。
- 10.5pt 正文。
- 标题避免分页后落单。
- li 和 blockquote 内部避免分页。
- `print-color-adjust: exact` 保留背景色。

### 行 95-101：escapeHtml

只转义：

- `&`
- `<`
- `>`
- `"`

用于 `<title>`。

Markdown 正文本身由 marked 输出，不经过这个 escape，因为 markdown 允许 HTML。PDF 浏览器打开的是本地内容，没有网络隔离保证。

## 4. tools/src/mcp-server.ts

### 行 1-11：依赖

`#!/usr/bin/env node` 允许脚本直接执行，不过实际由 patch 显式用 Node 启动。

导入：

- MCP server。
- stdio transport。
- 文件 API。
- path。
- Zod。
- 抽取。
- 工具载荷。
- PDF。
- 简历解析和渲染。
- 工作区路径函数。

### 行 13-18：stdout 规则

注释最重要：

```text
stdout 专用于 JSON-RPC，日志一律走 stderr
```

如果 `console.log()` 写到 stdout，会污染 MCP 协议，DSH 可能解析失败。因此所有工具日志都用 `console.error()`。

### 行 20-22：创建目录和 server

```ts
mkdirSync(OUTPUT_DIR, { recursive: true });
const server = new McpServer({
  name: "resume-tools",
  version: "0.1.0",
});
```

`McpServer` 是协议层，不是 HTTP server。

### 行 24-29：entrySchema

```ts
{
  org,
  role,
  period,
  bullets
}
```

所有字段除 org 外可以使用默认值。Zod 的 `.default()` 让模型省略字段时自动补值。

### 行 31-46：profileSchema

`basics.name` 必填；其他字段有默认值。

`stats` 不在 schema 里，因为模型不需要生成统计值。渲染函数也不需要 stats。

### 行 48-76：resume_parse

注册配置：

```ts
name: "resume_parse"
inputSchema: { path: z.string() }
```

处理：

1. `resolveReadable(path)`。
2. `extractDocument(target)`。
3. `parseResumeText(document.text)`。
4. 生成 summary。
5. `data` 返回 profile 和 rawText 前 6000 字。

summary 示例：

```text
已解析《resume.md》：45 行正文、8 条要点、12 项技能、4 条量化成果。
```

错误由 `toolError()` 包装成 MCP 的错误结果。

### 行 78-109：resume_rewrite

输入：

- `profile`
- `headline`

处理：

```ts
const markdown = renderResumeMarkdown(
  {
    ...profile,
    stats: { chars: 0, lines: 0, bullets: 0 },
  },
  { headline },
);
```

为什么补 dummy stats：

- Zod schema 没定义 stats。
- `ResumeProfile` 类型要求 stats。
- 渲染器不读取 stats。

文件名：

```ts
const safeName =
  headline === ""
    ? profile.basics.name
    : `${profile.basics.name}-${headline}`;
const target = resolveOutput(safeName, "md");
```

写入后返回：

- `data.path`
- `data.chars`
- `data.preview`
- `artifacts[0]`

artifact 的 path 是绝对路径，服务端会转成下载 URL。

### 行 111-141：pdf_generate

输入：

- `markdownPath`
- 可选 `fileName`

处理：

1. `resolveReadable(markdownPath)`。
2. 读取 Markdown。
3. 生成安全目标名。
4. 确保 OUTPUT_DIR 存在。
5. `markdownToPdf`。
6. `statSync` 得到字节数。
7. 返回 summary、data、artifact。

目标名默认沿用源文件名，但 `resolveOutput` 会去掉 `.md` 并加 `.pdf` 和时间戳。

### 行 143-155：toolError

```ts
return {
  content: [{
    type: "text",
    text: encodeToolResult({
      ok: false,
      summary: `工具执行失败：${message}`,
    }),
  }],
  isError: true,
};
```

错误仍然是可被模型阅读的文本，同时 MCP 标记 `isError`。

### 行 157-159：连接

```ts
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[resume-tools] MCP server ready");
```

stdio transport 保持进程运行，直到父进程关闭管道或发送终止信号。

## 5. 工具层的真实边界

### 能做什么

- 读取 workspace 内文件。
- 解析 PDF/DOCX/Markdown/TXT。
- 生成 Markdown。
- 用本机浏览器生成 PDF。
- 写 outputs。

### 不能做什么

- 读取 workspace 外任意文件。
- 执行 shell。
- 访问网络。
- 直接操作数据库。
- 决定用户身份或权限。

### 仍然存在的风险

- 词法路径检查不防符号链接。
- Markdown 中允许 HTML，PDF 渲染器会执行页面加载。
- 输出名同秒冲突可能覆盖。
- PDF 渲染依赖系统浏览器和字体。

## 6. 本章完成后应能回答

- 为什么工具输出不能 `console.log` 到 stdout？
- `resolveReadable` 和 `resolveOutput` 分别限制什么？
- 解析器为什么保留原文？
- `PERIOD_PATTERN` 为什么不能保证完整识别所有经历头？
- 为什么 `resume_rewrite` 要补 dummy stats？
- PDF 为什么会依赖本机 Edge/Chrome 而不是自带 Chromium？
- MCP 工具错误为什么仍返回文本载荷？
