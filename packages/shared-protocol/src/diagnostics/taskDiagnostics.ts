/** 定义只读任务诊断的字段白名单，不携带会话正文或驱动任务执行。 */
import { z } from "zod";
import { sessionIdSchema } from "../sessions/sessionProtocol.js";

/** 只读诊断入口，读取原生历史但不恢复或继续任务。 */
export const diagnosticMethods = { read: "ui-forge.diagnostics.read" } as const;
/** 诊断仅访问已经属于 ui-forge 的任务。 */
export const readTaskDiagnosticsSchema = sessionIdSchema;
const count = z.number().int().nonnegative();
const duration = z.number().finite().nonnegative();
const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const pathIdentifier = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\u0000-\u001f\u007f]+$/);

/** 实际注入新任务的设计和工程规则内容指纹，不保存规则全文。 */
export const ruleFingerprintsSchema = z.strictObject({
  design: z.string().regex(/^[a-f0-9]{64}$/),
  project: z.string().regex(/^[a-f0-9]{64}$/),
});
/** 已知错误类别；对象型原生错误只导出类别，不导出异常正文。 */
export const diagnosticErrorCodeSchema = z.enum([
  "contextWindowExceeded",
  "usageLimitExceeded",
  "sessionBudgetExceeded",
  "rateLimitExceeded",
  "serverOverloaded",
  "cyberPolicy",
  "misalignmentPolicyViolation",
  "httpConnectionFailed",
  "responseStreamConnectionFailed",
  "internalServerError",
  "unauthorized",
  "badRequest",
  "threadRollbackFailed",
  "sandboxError",
  "responseStreamDisconnected",
  "responseTooManyFailedAttempts",
  "activeTurnNotSteerable",
  "other",
]);
/** 工具项按原生类型汇总，不导出命令、MCP 名称、参数或结果。 */
export const diagnosticToolSummarySchema = z.strictObject({
  type: z.enum([
    "commandExecution",
    "fileChange",
    "mcpToolCall",
    "dynamicToolCall",
    "collabAgentToolCall",
    "webSearch",
    "imageView",
    "imageGeneration",
  ]),
  count,
  completed: count,
  failed: count,
  inProgress: count,
  other: count,
  timedCount: count,
  knownDurationMs: duration.nullable(),
});
/** 时间和终态直接来自原生轮次，工具并行耗时总和不等于轮次耗时。 */
export const diagnosticTurnSchema = z.strictObject({
  turnId: identifier,
  status: z.enum(["inProgress", "completed", "interrupted", "failed"]),
  startedAt: z.number().finite().nullable(),
  completedAt: z.number().finite().nullable(),
  durationMs: duration.nullable(),
  errorCode: diagnosticErrorCodeSchema.nullable(),
  tools: z.array(diagnosticToolSummarySchema),
});
/** 最后一次观测的原生累计 Token 数，重复事件必须覆盖而非累加。 */
export const diagnosticTokenUsageSchema = z.strictObject({
  observedAt: z.iso.datetime(),
  total: z.strictObject({
    totalTokens: count,
    inputTokens: count,
    cachedInputTokens: count,
    cacheWriteInputTokens: count,
    outputTokens: count,
    reasoningOutputTokens: count,
  }),
});
/** Codex 运行时环境摘要；路径只用于定位实际运行时，不包含环境正文。 */
export const diagnosticRuntimeSchema = z.strictObject({
  executablePath: pathIdentifier.nullable(),
  codexHome: pathIdentifier.nullable(),
  serviceTier: identifier.nullable(),
  configuredConcurrency: count.nullable(),
  currentConcurrency: count.nullable(),
  peakConcurrency: count.nullable(),
  platform: identifier.nullable(),
  arch: identifier.nullable(),
});
/** 主线程和子代理的脱敏运行摘要；不携带提示词、命令或工具输出。 */
export const diagnosticAgentSummarySchema = z.strictObject({
  threadId: identifier,
  parentThreadId: identifier.nullable(),
  source: identifier.nullable(),
  model: identifier.nullable(),
  modelProvider: identifier.nullable(),
  reasoningEffort: z
    .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"])
    .nullable(),
  serviceTier: identifier.nullable(),
  status: z.enum(["notLoaded", "idle", "systemError", "active", "unknown"]),
  errorCodes: z.array(diagnosticErrorCodeSchema),
});
/** 明确数据缺口，缺失统计不能被展示为零。 */
export const diagnosticWarningSchema = z.enum([
  "rulesUnavailable",
  "tokenUsageUnavailable",
  "metadataReadFailed",
  "metadataWriteFailed",
  "historyIncomplete",
  "runtimeUnavailable",
  "agentsUnavailable",
  "concurrencyUnavailable",
]);
/** 可展示和导出的版本化报告；严格 Schema 防止私有字段进入报告。 */
export const taskDiagnosticsSchema = z.strictObject({
  reportVersion: z.literal(2),
  generatedAt: z.iso.datetime(),
  taskId: identifier,
  source: z.literal("codex-thread-read"),
  scope: z.literal("thread-tree"),
  status: z.enum(["notLoaded", "idle", "systemError", "active", "unknown"]),
  model: identifier.nullable(),
  modelProvider: identifier.nullable(),
  reasoningEffort: z
    .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"])
    .nullable(),
  codexVersion: identifier.nullable(),
  protocolVersion: identifier,
  runtime: diagnosticRuntimeSchema.nullable(),
  agents: z.array(diagnosticAgentSummarySchema),
  ruleFingerprints: ruleFingerprintsSchema.nullable(),
  tokenUsage: diagnosticTokenUsageSchema.nullable(),
  turns: z.array(diagnosticTurnSchema),
  warnings: z.array(diagnosticWarningSchema),
});
/** 诊断报告的公共类型，只通过运行时 Schema 推导。 */
export type TaskDiagnostics = z.infer<typeof taskDiagnosticsSchema>;
/** 供服务持久化的已注入规则指纹。 */
export type RuleFingerprints = z.infer<typeof ruleFingerprintsSchema>;
/** 原生累计 Token 的最后观测值。 */
export type DiagnosticTokenUsage = z.infer<typeof diagnosticTokenUsageSchema>;
/** Codex 进程运行时摘要。 */
export type DiagnosticRuntime = z.infer<typeof diagnosticRuntimeSchema>;
/** 子代理状态汇总。 */
export type DiagnosticAgentSummary = z.infer<typeof diagnosticAgentSummarySchema>;
/** 导出中允许的缺失原因。 */
export type DiagnosticWarning = z.infer<typeof diagnosticWarningSchema>;
