/** 为模型流式调用生成不包含提示词或响应正文的安全时序诊断事件。 */

import { BaseCallbackHandler } from "@langchain/core/callbacks/base";

const defaultProgressIntervalMs = 30_000;

/** 描述一次模型尝试允许写入安全日志的运行指标。 */
export interface ModelInvocationDiagnostic {
  taskId?: string;
  stage: string;
  attempt: number;
  status:
    | "started"
    | "turn-started"
    | "first-token"
    | "stream-progress"
    | "turn-completed"
    | "turn-failed"
    | "structured-output-invalid"
    | "structured-output-repaired"
    | "succeeded"
    | "failed";
  turn?: number;
  durationMs?: number;
  elapsedMs?: number;
  timeToFirstTokenMs?: number;
  chunkCount?: number;
  idleMs?: number;
  errorName?: string;
  errorCode?: string;
  retryable?: boolean;
  validationIssueCount?: number;
  validationIssuePaths?: string[];
}

/** 接收不含消息、图片、凭据或思维内容的模型调用诊断事件。 */
export type ModelDiagnosticReporter = (
  event: ModelInvocationDiagnostic,
) => void | Promise<void>;

interface ModelTurnState {
  turn: number;
  startedAt: number;
  lastChunkAt: number;
  chunkCount: number;
  firstChunkReported: boolean;
  progressTimer: ReturnType<typeof setInterval>;
}

interface ModelTurnDiagnosticObserverOptions {
  taskId?: string;
  stage: string;
  attempt: number;
  reporter?: ModelDiagnosticReporter;
  progressIntervalMs?: number;
}

/** 提供可传给 LangChain 的回调，并在每轮模型请求中汇报首包和静默进度。 */
export function createModelTurnDiagnosticObserver(
  options: ModelTurnDiagnosticObserverOptions,
): { callback: BaseCallbackHandler; dispose: () => void } {
  const turns = new Map<string, ModelTurnState>();
  let nextTurn = 0;
  let disposed = false;
  const base = {
    ...(options.taskId ? { taskId: options.taskId } : {}),
    stage: options.stage,
    attempt: options.attempt,
  };
  const progressIntervalMs = options.progressIntervalMs ?? defaultProgressIntervalMs;

  const startTurn = async (runId: string): Promise<void> => {
    if (disposed || turns.has(runId)) return;
    const startedAt = performance.now();
    const turn = ++nextTurn;
    const progressTimer = setInterval(() => {
      const state = turns.get(runId);
      if (!state || disposed) return;
      const now = performance.now();
      void reportDiagnosticSafely(options.reporter, {
        ...base,
        status: "stream-progress",
        turn: state.turn,
        elapsedMs: elapsedMilliseconds(state.startedAt, now),
        chunkCount: state.chunkCount,
        idleMs: elapsedMilliseconds(state.lastChunkAt, now),
      });
    }, progressIntervalMs);
    progressTimer.unref();
    turns.set(runId, {
      turn,
      startedAt,
      lastChunkAt: startedAt,
      chunkCount: 0,
      firstChunkReported: false,
      progressTimer,
    });
    await reportDiagnosticSafely(options.reporter, {
      ...base,
      status: "turn-started",
      turn,
    });
  };

  const callback = BaseCallbackHandler.fromMethods({
    handleChatModelStart: async (_model, _messages, runId) => startTurn(runId),
    handleLLMStart: async (_model, _prompts, runId) => startTurn(runId),
    handleLLMNewToken: async (_token, _indices, runId) => {
      const state = turns.get(runId);
      if (!state || disposed) return;
      const now = performance.now();
      state.chunkCount += 1;
      state.lastChunkAt = now;
      if (state.firstChunkReported) return;
      state.firstChunkReported = true;
      await reportDiagnosticSafely(options.reporter, {
        ...base,
        status: "first-token",
        turn: state.turn,
        timeToFirstTokenMs: elapsedMilliseconds(state.startedAt, now),
        chunkCount: state.chunkCount,
      });
    },
    handleLLMEnd: async (_output, runId) => {
      const state = takeTurn(turns, runId);
      if (!state || disposed) return;
      const now = performance.now();
      await reportDiagnosticSafely(options.reporter, {
        ...base,
        status: "turn-completed",
        turn: state.turn,
        durationMs: elapsedMilliseconds(state.startedAt, now),
        chunkCount: state.chunkCount,
        idleMs: elapsedMilliseconds(state.lastChunkAt, now),
      });
    },
    handleLLMError: async (error, runId) => {
      const state = takeTurn(turns, runId);
      if (!state || disposed) return;
      const now = performance.now();
      await reportDiagnosticSafely(options.reporter, {
        ...base,
        status: "turn-failed",
        turn: state.turn,
        durationMs: elapsedMilliseconds(state.startedAt, now),
        chunkCount: state.chunkCount,
        idleMs: elapsedMilliseconds(state.lastChunkAt, now),
        errorName: readErrorName(error),
      });
    },
  });

  return {
    callback,
    dispose: () => {
      disposed = true;
      for (const state of turns.values()) clearInterval(state.progressTimer);
      turns.clear();
    },
  };
}

/** 取出已结束轮次并停止对应的周期日志。 */
function takeTurn(
  turns: Map<string, ModelTurnState>,
  runId: string,
): ModelTurnState | undefined {
  const state = turns.get(runId);
  if (!state) return undefined;
  clearInterval(state.progressTimer);
  turns.delete(runId);
  return state;
}

/** 隔离诊断日志故障，确保它不会改变模型调用结果。 */
export async function reportDiagnosticSafely(
  reporter: ModelDiagnosticReporter | undefined,
  event: ModelInvocationDiagnostic,
): Promise<void> {
  try {
    await reporter?.(structuredClone(event));
  } catch {
    // 诊断日志失败不得改变模型执行或重试语义。
  }
}

/** 将高精度计时转换为安全的非负整数毫秒。 */
export function elapsedMilliseconds(startedAt: number, endedAt = performance.now()): number {
  return Math.max(0, Math.round(endedAt - startedAt));
}

/** 从未知异常中提取不含错误消息的类型名称。 */
function readErrorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "Error";
}
