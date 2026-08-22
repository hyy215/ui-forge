import type { ZodType } from "zod";

export type ToolPermission = "read" | "propose" | "write" | "execute";

export interface ToolContext {
  taskId: string;
  workspaceRoot: string;
  readablePaths: string[];
  writablePaths: string[];
  signal: AbortSignal;
}

export interface ToolDefinition<Input, Output> {
  name: string;
  description: string;
  inputSchema: ZodType<Input>;
  outputSchema: ZodType<Output>;
  permission: ToolPermission;
  timeoutMs: number;
  idempotency: "required" | "best-effort" | "none";
  execute(input: Input, context: ToolContext): Promise<Output>;
}
