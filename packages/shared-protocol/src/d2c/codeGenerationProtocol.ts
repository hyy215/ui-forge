/** 定义按已审阅 Plan 生成候选代码 Patch 的命令、快照和有序流事件。 */

import { z } from "zod";
import { d2cTaskCommandInputSchema } from "./commonProtocol.js";
import { toolExecutionMetricsSchema } from "./conversationProtocol.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/** 校验单个计划步骤内的文件内容变换和审阅 Diff。 */
export const codePatchOperationSchema = z.object({
  path: z.string().min(1).refine((path) => {
    const normalized = path.replaceAll("\\", "/");
    return path === normalized && !normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized)
      && normalized.split("/").every((part) => part !== "" && part !== "." && part !== "..");
  }, "Patch 文件必须是安全的项目相对路径。"),
  action: z.enum(["create", "modify", "delete"]),
  beforeHash: sha256Schema.nullable(),
  afterHash: sha256Schema.nullable(),
  reviewDiff: z.string().min(1),
}).superRefine((operation, context) => {
  const validHashes = operation.action === "create"
    ? operation.beforeHash === null && operation.afterHash !== null
    : operation.action === "modify"
      ? operation.beforeHash !== null && operation.afterHash !== null
      : operation.beforeHash !== null && operation.afterHash === null;
  if (!validHashes) context.addIssue({ code: "custom", message: "Patch 文件动作与前后哈希不一致。" });
});

/** 校验绑定一个原子计划步骤的候选 Patch。 */
export const codeStepPatchSchema = z.object({
  stepId: z.string().min(1),
  patchHash: sha256Schema,
  operations: z.array(codePatchOperationSchema).min(1),
});

/** 校验绑定当前 Plan 版本的完整候选 Patch 集合。 */
export const codePatchSetSchema = z.object({
  patchSetHash: sha256Schema,
  planVersion: z.number().int().positive(),
  planHash: sha256Schema,
  summary: z.string().min(1),
  patches: z.array(codeStepPatchSchema).min(1),
  warnings: z.array(z.string().min(1)),
});

const blockedCodeGenerationViewModelSchema = z.object({
    status: z.literal("blocked"),
    summary: z.string().min(1),
    reasons: z.array(z.string().min(1)).min(1),
    warnings: z.array(z.string().min(1)),
  });
const readyCodeGenerationViewModelSchema = z.object({
    status: z.literal("ready"),
    patchSet: codePatchSetSchema,
  });

/** 校验快照中可恢复的代码生成审阅状态。 */
export const codeGenerationViewModelSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("idle") }),
  blockedCodeGenerationViewModelSchema,
  readyCodeGenerationViewModelSchema,
]);

const completedCodeGenerationViewModelSchema = z.discriminatedUnion("status", [
  blockedCodeGenerationViewModelSchema,
  readyCodeGenerationViewModelSchema,
]);

/** 校验开始代码生成流所需的任务与乐观并发版本。 */
export const streamD2CCodeGenerationInputSchema = d2cTaskCommandInputSchema;

/** 校验取消当前代码生成运行所需的任务标识。 */
export const cancelD2CCodeGenerationInputSchema = z.object({
  taskId: z.string().uuid(),
});

/** 校验 Server 是否找到并取消了当前代码生成运行。 */
export const cancelD2CCodeGenerationResultSchema = z.object({
  cancelled: z.boolean(),
});

/** 校验代码生成流中不包含隐藏思维链的公开事件。 */
export const codeGenerationStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("code-generation-start") }),
  z.object({
    type: z.literal("code-generation-progress"),
    phase: z.enum(["reading-context", "generating-code", "validating-patch"]),
    summary: z.string().min(1),
    metrics: toolExecutionMetricsSchema.optional(),
  }),
  z.object({
    type: z.literal("code-generation-result"),
    result: completedCodeGenerationViewModelSchema,
  }),
  z.object({ type: z.literal("code-generation-complete") }),
  z.object({ type: z.literal("code-generation-stopped") }),
]);

/** 单个文件候选 Patch 的公开审阅模型。 */
export type CodePatchOperation = z.infer<typeof codePatchOperationSchema>;
/** 单个计划步骤候选 Patch 的公开审阅模型。 */
export type CodeStepPatch = z.infer<typeof codeStepPatchSchema>;
/** 完整候选 Patch 集合的公开审阅模型。 */
export type CodePatchSet = z.infer<typeof codePatchSetSchema>;
/** 快照中可恢复的代码生成状态。 */
export type CodeGenerationViewModel = z.infer<typeof codeGenerationViewModelSchema>;
/** 开始代码生成流所需参数。 */
export type StreamD2CCodeGenerationInput = z.infer<typeof streamD2CCodeGenerationInputSchema>;
/** 取消代码生成所需参数。 */
export type CancelD2CCodeGenerationInput = z.infer<typeof cancelD2CCodeGenerationInputSchema>;
/** 取消代码生成返回结果。 */
export type CancelD2CCodeGenerationResult = z.infer<typeof cancelD2CCodeGenerationResultSchema>;
/** 代码生成流允许发送的领域事件。 */
export type CodeGenerationStreamEvent = z.infer<typeof codeGenerationStreamEventSchema>;
