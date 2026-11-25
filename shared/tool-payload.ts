/**
 * 工具结果约定：MCP 工具返回「给人看的一句话 + 末尾一段 JSON」。
 * 模型能读 summary，前端/服务端能从 JSON 里拿到结构化数据和产物文件。
 * 这样同一份工具输出既服务对话，也服务 UI 的下载卡片与 Langfuse 记录。
 */

export interface ToolArtifact {
  /** 展示用文件名 */
  name: string;
  /** 绝对路径，位于 workspace/outputs 下 */
  path: string;
  bytes: number;
}

export interface ToolPayload {
  ok: boolean;
  summary: string;
  data?: unknown;
  artifacts?: ToolArtifact[];
}

const BLOCK_PATTERN = /```json\s*([\s\S]*?)```\s*$/i;

export function encodeToolResult(payload: ToolPayload): string {
  const structured = {
    ok: payload.ok,
    ...(payload.data === undefined ? {} : { data: payload.data }),
    ...(payload.artifacts === undefined ? {} : { artifacts: payload.artifacts }),
  };
  return `${payload.summary}\n\n\`\`\`json\n${JSON.stringify(structured, null, 2)}\n\`\`\``;
}

export function decodeToolResult(text: string): ToolPayload | null {
  const match = text.match(BLOCK_PATTERN);
  if (match === null) return null;
  try {
    const parsed = JSON.parse(match[1] ?? "") as Partial<ToolPayload> & {
      artifacts?: ToolArtifact[];
    };
    if (typeof parsed.ok !== "boolean") return null;
    return {
      ok: parsed.ok,
      summary: text.slice(0, match.index ?? text.length).trim(),
      data: parsed.data,
      artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : undefined,
    };
  } catch {
    return null;
  }
}
