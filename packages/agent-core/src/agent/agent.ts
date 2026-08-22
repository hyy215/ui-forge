/** 定义可由不同领域工作流复用的平台无关 Agent、消息和工具端口。 */

import type { z } from "zod";

/** Agent 对话支持的基础消息角色。 */
export type AgentMessageRole = "system" | "user" | "assistant";

/** Agent 消息中的文本内容块。 */
export interface AgentTextContent {
  type: "text";
  text: string;
}

/** Agent 消息中的受控内联图片内容块。 */
export interface AgentImageContent {
  type: "image";
  dataUrl: string;
  detail?: "auto" | "low" | "high";
}

/** Agent 消息允许组合的多模态内容块。 */
export type AgentMessageContent = AgentTextContent | AgentImageContent;

/** 表示发送给 Agent 的单条结构化对话消息。 */
export interface AgentMessage {
  role: AgentMessageRole;
  content: string | readonly AgentMessageContent[];
}

/** 描述 Agent 单次 completion 调用的消息输入。 */
export interface AgentInput {
  messages: readonly AgentMessage[];
  context?: AgentInvocationContext;
  signal?: AbortSignal;
}

/** 携带由权威工作流绑定、模型不能自行选择的单次调用上下文。 */
export interface AgentInvocationContext {
  taskId: string;
  values: Readonly<Record<string, unknown>>;
}

/** 描述一次 Agent 调用中允许模型使用的受控结构化工具。 */
export interface AgentTool {
  name: string;
  description: string;
  schema: z.ZodType;
  execute(input: unknown): Promise<unknown>;
}

/** 根据不可由模型覆盖的调用上下文创建本次可见工具集合。 */
export interface AgentToolFactory {
  create(context: AgentInvocationContext | undefined): readonly AgentTool[];
}

/** 描述一次调用中可供主 Agent 委派的受限子 Agent。 */
export interface AgentSubagent {
  name: string;
  description: string;
  systemPrompt: string;
  tools: readonly AgentTool[];
  responseSchema?: z.ZodType;
}

/** 根据权威调用上下文创建任务绑定的子 Agent。 */
export interface AgentSubagentFactory {
  create(context: AgentInvocationContext | undefined): readonly AgentSubagent[];
}

/** 表示 Agent 已完成的一次文本响应。 */
export interface AgentResult {
  response: string;
  structuredResponse?: unknown;
  usage?: AgentTokenUsage;
}

/** 汇总一次 Agent 调用中模型供应商实际报告的 Token 数量。 */
export interface AgentTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** 隔离 Agent Core 与具体模型供应商、接口协议和认证方式的对话端口。 */
export interface Agent {
  invoke(input: AgentInput): Promise<AgentResult>;
}
