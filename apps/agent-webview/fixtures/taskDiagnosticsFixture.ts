/** 为只读诊断界面提供固定白名单数据，不访问真实会话或执行工具。 */
import type { TaskDiagnostics } from "@ui-forge/shared-protocol";

/** 分别覆盖已采集的新任务和缺少运行信息的历史任务。 */
export function createTaskDiagnosticsFixture(taskId: string, unknown = false): TaskDiagnostics {
  return {
    reportVersion: 2,
    generatedAt: "2026-09-20T08:00:00.000Z",
    taskId,
    source: "codex-thread-read",
    scope: "thread-tree",
    status: unknown ? "unknown" : "idle",
    model: unknown ? null : "gpt-6-astra",
    modelProvider: unknown ? null : "openai",
    reasoningEffort: unknown ? null : "high",
    codexVersion: unknown ? null : "0.153.4",
    protocolVersion: "0.153.4",
    runtime: unknown
      ? null
      : {
          executablePath: "/usr/local/bin/codex",
          codexHome: "/Users/demo/.codex",
          serviceTier: "pro",
          configuredConcurrency: 4,
          currentConcurrency: 1,
          peakConcurrency: 2,
          platform: "darwin",
          arch: "arm64",
        },
    agents: unknown
      ? []
      : [
          {
            threadId: taskId,
            parentThreadId: null,
            source: "codex-thread-read",
            model: "gpt-6-astra",
            modelProvider: "openai",
            reasoningEffort: "high",
            serviceTier: "pro",
            status: "idle",
            errorCodes: [],
          },
        ],
    ruleFingerprints: unknown ? null : { design: "a".repeat(64), project: "b".repeat(64) },
    tokenUsage: unknown
      ? null
      : {
          observedAt: "2026-09-20T07:59:00.000Z",
          total: {
            totalTokens: 1200,
            inputTokens: 1000,
            cachedInputTokens: 600,
            cacheWriteInputTokens: 0,
            outputTokens: 200,
            reasoningOutputTokens: 100,
          },
        },
    turns: unknown
      ? []
      : [
          {
            turnId: "turn-completed",
            status: "completed",
            startedAt: null,
            completedAt: null,
            durationMs: 2000,
            errorCode: null,
            tools: [
              {
                type: "commandExecution",
                count: 2,
                completed: 2,
                failed: 0,
                inProgress: 0,
                other: 0,
                timedCount: 2,
                knownDurationMs: 3000,
              },
            ],
          },
          {
            turnId: "turn-capacity",
            status: "failed",
            startedAt: null,
            completedAt: null,
            durationMs: null,
            errorCode: "serverOverloaded",
            tools: [
              {
                type: "mcpToolCall",
                count: 1,
                completed: 0,
                failed: 1,
                inProgress: 0,
                other: 0,
                timedCount: 0,
                knownDurationMs: null,
              },
            ],
          },
        ],
    warnings: unknown
      ? [
          "rulesUnavailable",
          "tokenUsageUnavailable",
          "metadataReadFailed",
          "metadataWriteFailed",
          "historyIncomplete",
          "runtimeUnavailable",
          "agentsUnavailable",
          "concurrencyUnavailable",
        ]
      : [],
  };
}
