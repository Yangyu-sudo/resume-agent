/**
 * 前后端共享的协议类型：聊天消息、附件、流式事件、产物。
 * 服务端按这些形状发 SSE，前端按同样形状渲染，避免两端各写一份接口定义。
 */

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  /** 解析出的纯文本摘要，便于前端预览和直接注入上下文 */
  preview: string;
  chars: number;
}

export interface Artifact {
  name: string;
  url: string;
  bytes: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
  attachments?: Attachment[];
  toolCalls?: ToolCallView[];
  artifacts?: Artifact[];
  usage?: TokenUsage;
  createdAt: string;
  error?: string;
}

export interface ToolCallView {
  callId: string;
  name: string;
  args: string;
  status: "running" | "ok" | "error";
  output?: string;
}

export interface Conversation {
  id: string;
  title: string;
  dshSessionId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 简历版本：一次会话里同时保留「原始简历」和所有「优化版」。
 * 原始版本来自用户上传，优化版本由 resume_rewrite 产出；
 * 之后的 pdf_generate 会把 PDF 挂到对应的优化版本上。
 */
export interface ResumeVersion {
  id: string;
  kind: "original" | "optimized";
  label: string;
  fileName: string;
  createdAt: string;
  chars: number;
  source: "upload" | "agent";
  /** 可直接下载的文件地址（原始件或 Markdown） */
  downloadUrl: string;
  /** 该版本导出的 PDF（如有） */
  pdfUrl?: string;
  /** 原始 PDF 是否为扫描件（抽不到文本） */
  needsOcr?: boolean;
}


export type UiEvent =
  | { type: "turn_start"; turn: number }
  | { type: "step_start"; turn: number; step: number }
  | { type: "tool_call"; callId: string; name: string; args: string }
  | { type: "tool_result"; callId: string; name: string; ok: boolean; output: string }
  | { type: "assistant"; text: string; reasoning?: string; usage?: TokenUsage }
  | { type: "artifact"; artifact: Artifact }
  | { type: "error"; message: string }
  | { type: "done"; finishReason: string };

/** 把 MCP 工具名变成展示名：mcp__resume__resume_parse -> resume_parse */
export function displayToolName(name: string): string {
  return name.replace(/^mcp__[a-z0-9_]+__/i, "");
}

export const TOOL_LABELS: Record<string, string> = {
  resume_parse: "解析简历",
  resume_rewrite: "改写简历",
  pdf_generate: "生成 PDF",
};
