/** 将运行时模型诊断转成可重复比较的评测报告，仅保留白名单指标与原始事件。 */

/** 脱敏模型事件，不包含 Workspace、消息、图片、密钥或思考正文。 */
export interface ModelRunEvent {
  taskId: string;
  stage: string;
  model: string;
  status: string;
  durationMs?: number;
  timeToFirstTokenMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
}

const numericFields = ["durationMs", "timeToFirstTokenMs", "inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens"] as const;

/** 校验 JSONL 中的模型事件，过滤其他日志及敏感字段；缺失用量保持缺失。 */
export function parseModelRunEvents(jsonl: string): ModelRunEvent[] {
  if (Buffer.byteLength(jsonl, "utf8") > 16 * 1024 * 1024) throw new Error("单次日志输入超过 16 MB 上限。");
  const events: ModelRunEvent[] = [];
  for (const [index, line] of jsonl.split("\n").entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error(`第 ${index + 1} 行不是有效 JSON。`); }
    if (!record(value)) throw new Error(`第 ${index + 1} 行必须是 JSON 对象。`);
    if (value.event !== "model.invocation") continue;
    const event: ModelRunEvent = {
      taskId: identifier(value.taskId, "unknown-task"),
      stage: identifier(value.stage), model: identifier(value.model, "unknown-model"), status: identifier(value.status),
    };
    for (const field of numericFields) {
      const number = value[field];
      if (number === undefined) continue;
      if (typeof number !== "number" || !Number.isFinite(number) || number < 0) throw new Error(`第 ${index + 1} 行包含无效指标。`);
      event[field] = number;
    }
    events.push(event);
  }
  return events;
}

/** 按模型和阶段汇总真实请求指标；原始白名单事件保留在报告中供复核。 */
export function createModelRunReport(events: readonly ModelRunEvent[]) {
  const groups = new Map<string, ModelRunEvent[]>();
  for (const event of events) {
    const key = JSON.stringify([event.stage, event.model]);
    const group = groups.get(key) ?? [];
    group.push(event); groups.set(key, group);
  }
  return {
    schemaVersion: 1,
    scope: "model-inference-only",
    stages: [...groups.values()].map((group) => {
      const completed = group.filter((event) => event.status === "turn-completed");
      const durations = completed.flatMap((event) => event.durationMs === undefined ? [] : [event.durationMs]);
      const firstTokens = group.flatMap((event) => event.status === "first-token" && event.timeToFirstTokenMs !== undefined
        ? [event.timeToFirstTokenMs] : []);
      return {
        stage: group[0]!.stage, model: group[0]!.model,
        taskCount: new Set(group.map((event) => event.taskId)).size,
        requestCount: group.filter((event) => event.status === "turn-started").length,
        completedCount: completed.length,
        failedCount: group.filter((event) => event.status === "turn-failed").length,
        latencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95) },
        firstTokenMs: { p50: percentile(firstTokens, 0.5), p95: percentile(firstTokens, 0.95) },
        reportedUsageCount: completed.filter((event) => event.inputTokens !== undefined && event.outputTokens !== undefined).length,
        inputTokens: sumReported(completed, "inputTokens"), outputTokens: sumReported(completed, "outputTokens"),
        reasoningTokens: sumReported(completed, "reasoningTokens"), cacheReadTokens: sumReported(completed, "cacheReadTokens"),
      };
    }),
    events: structuredClone(events),
  };
}

/** 采用 nearest-rank 分位数；没有测量值时返回 null。 */
function percentile(values: readonly number[], fraction: number): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

/** 仅汇总已报告值，避免把供应商未返回用量解释为零。 */
function sumReported(events: readonly ModelRunEvent[], field: typeof numericFields[number]): number | null {
  const values = events.flatMap((event) => event[field] === undefined ? [] : [event[field]]);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

/** 校验任务和模型标识的长度及字符范围，不回显被拒绝的输入。 */
function identifier(value: unknown, fallback?: string): string {
  if (value === undefined && fallback) return fallback;
  if (typeof value !== "string" || !/^[a-zA-Z0-9_.:/-]{1,128}$/.test(value)) throw new Error("日志包含无效标识。");
  return value;
}

/** 收窄外部 JSON 对象。 */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
