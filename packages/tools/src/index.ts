/** 暴露受控工具契约与目标 Workspace 写入适配器。 */

import type { ZodType } from "zod";

export { FileSystemProjectPatchApplier } from "./fileSystemProjectPatchApplier.js";
export {
  FileSystemProjectDeliveryValidator,
  type FileSystemProjectDeliveryValidatorOptions,
} from "./fileSystemProjectDeliveryValidator.js";

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
