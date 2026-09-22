/** 从已经校验的原生历史和独立运行元数据投影诊断白名单，不导出正文或工具载荷。 */
import { z } from "zod";
import { codexProtocolVersion, type NativeMethods } from "@ui-forge/codex-client";
import {
  diagnosticErrorCodeSchema,
  diagnosticToolSummarySchema,
  taskDiagnosticsSchema,
  type DiagnosticAgentSummary,
  type TaskDiagnostics,
} from "@ui-forge/shared-protocol";
import type { DiagnosticMetadata } from "./diagnosticMetadataStore.js";

type Thread = NativeMethods["thread/read"]["result"]["thread"];
type ListedThread = NativeMethods["thread/list"]["result"]["data"][number];
type ToolSummary = z.infer<typeof diagnosticToolSummarySchema>;
const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const duration = z.number().finite().nonnegative();
const timestamp = z.number().finite();

/** 仅允许简单原生标识符进入可导出字段，路径、控制字符或正文返回未知。 */
function safeIdentifier(value: unknown): string | null {
  const parsed = identifier.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function finiteValue(value: unknown, schema: z.ZodNumber): number | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** 原生对象错误只保留其已知枚举键，禁止扩散附加详情。 */
function errorCode(
  error: Thread["turns"][number]["error"],
): TaskDiagnostics["turns"][number]["errorCode"] {
  if (!error) return null;
  const value = error.codexErrorInfo;
  if (typeof value === "string") return diagnosticErrorCodeSchema.catch("other").parse(value);
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1) return diagnosticErrorCodeSchema.catch("other").parse(keys[0]);
  }
  return "other";
}

/** 相同 item 身份只计一次；并行工具耗时仅作为工具总量，不代替轮次耗时。 */
function summarizeTools(turn: Thread["turns"][number]): ToolSummary[] {
  const items = new Map(turn.items.map((item) => [item.id, item]));
  const summaries = new Map<ToolSummary["type"], ToolSummary>();
  for (const item of items.values()) {
    const parsedType = diagnosticToolSummarySchema.shape.type.safeParse(item.type);
    if (!parsedType.success) continue;
    const type = parsedType.data;
    const summary = summaries.get(type) ?? {
      type,
      count: 0,
      completed: 0,
      failed: 0,
      inProgress: 0,
      other: 0,
      timedCount: 0,
      knownDurationMs: null,
    };
    summary.count += 1;
    const status = "status" in item ? item.status : undefined;
    if (status === "completed" || status === "failed" || status === "inProgress")
      summary[status] += 1;
    else summary.other += 1;
    const milliseconds = finiteValue("durationMs" in item ? item.durationMs : null, duration);
    if (milliseconds !== null) {
      summary.timedCount += 1;
      summary.knownDurationMs = (summary.knownDurationMs ?? 0) + milliseconds;
    }
    summaries.set(type, summary);
  }
  return [...summaries.values()].sort((left, right) => left.type.localeCompare(right.type));
}

/** 只从原生字段生成摘要；元数据缺失和不完整历史保持显式未知。 */
export function projectTaskDiagnostics(
  thread: Thread,
  metadata: DiagnosticMetadata,
  childThreads: ListedThread[] = [],
  additionalWarnings: Iterable<TaskDiagnostics["warnings"][number]> = [],
): TaskDiagnostics {
  const warnings = new Set(metadata.warnings);
  if (!metadata.ruleFingerprints) warnings.add("rulesUnavailable");
  if (!metadata.tokenUsage) warnings.add("tokenUsageUnavailable");
  if (!metadata.runtime) warnings.add("runtimeUnavailable");
  else if (
    metadata.runtime.configuredConcurrency === null &&
    metadata.runtime.currentConcurrency === null &&
    metadata.runtime.peakConcurrency === null
  )
    warnings.add("concurrencyUnavailable");
  for (const warning of additionalWarnings) warnings.add(warning);
  if (thread.turns.some((turn) => turn.itemsView !== "full")) warnings.add("historyIncomplete");
  const turns = new Map(thread.turns.map((turn) => [turn.id, turn]));
  const allThreads = [thread, ...childThreads.filter((item) => item.id !== thread.id)];
  const storedAgents = new Map((metadata.agents ?? []).map((agent) => [agent.threadId, agent]));
  const agents: DiagnosticAgentSummary[] = allThreads.map((item) => {
    const stored = storedAgents.get(item.id);
    const turnsWithErrors = item.turns.flatMap((turn) => {
      const code = errorCode(turn.error);
      return code ? [code] : [];
    });
    const errorCodes = [...new Set([...(stored?.errorCodes ?? []), ...turnsWithErrors])];
    return {
      threadId: item.id,
      parentThreadId: item.parentThreadId ?? null,
      source: safeIdentifier(item.threadSource ?? item.source),
      model: safeIdentifier(item.model ?? null),
      modelProvider: safeIdentifier(item.modelProvider ?? null),
      reasoningEffort: taskDiagnosticsSchema.shape.reasoningEffort
        .catch(null)
        .parse(item.reasoningEffort),
      serviceTier:
        stored?.serviceTier ??
        (item.id === thread.id ? (metadata.runtime?.serviceTier ?? null) : null),
      status: taskDiagnosticsSchema.shape.status.catch("unknown").parse(item.status.type),
      errorCodes,
    };
  });
  return taskDiagnosticsSchema.parse({
    reportVersion: 2,
    generatedAt: new Date().toISOString(),
    taskId: thread.id,
    source: "codex-thread-read",
    scope: "thread-tree",
    status: taskDiagnosticsSchema.shape.status.catch("unknown").parse(thread.status.type),
    model: safeIdentifier(thread.model),
    modelProvider: safeIdentifier(thread.modelProvider),
    reasoningEffort: taskDiagnosticsSchema.shape.reasoningEffort
      .catch(null)
      .parse(thread.reasoningEffort),
    codexVersion: safeIdentifier(thread.cliVersion),
    protocolVersion: codexProtocolVersion,
    runtime: metadata.runtime ?? null,
    agents,
    ruleFingerprints: metadata.ruleFingerprints,
    tokenUsage: metadata.tokenUsage,
    turns: [...turns.values()].map((turn) => ({
      turnId: turn.id,
      status: turn.status,
      startedAt: finiteValue(turn.startedAt, timestamp),
      completedAt: finiteValue(turn.completedAt, timestamp),
      durationMs: finiteValue(turn.durationMs, duration),
      errorCode: errorCode(turn.error),
      tools: summarizeTools(turn),
    })),
    warnings: [...warnings],
  });
}
