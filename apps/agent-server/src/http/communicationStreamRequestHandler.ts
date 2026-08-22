/** 将领域异步事件转换为有序流信封，并统一记录成功或失败审计结果。 */

import {
  createCommunicationStreamCompleteMessage,
  createCommunicationStreamErrorMessage,
  createCommunicationStreamEventMessage,
  createCommunicationStreamHeartbeatMessage,
  type CommunicationStreamMessage,
  type CommunicationStreamRequestMessage,
} from "@ui-forge/shared-protocol";
import { readCommunicationLogContext } from "../logging/communicationLogContext.js";
import type { CommunicationRequestLogger } from "../logging/workspaceRequestLogger.js";

/** 流式通信处理器调用的领域服务端口。 */
export interface CommunicationStreamWorkflowService {
  /** 按方法和参数生成可序列化领域事件。 */
  stream(method: string, params: unknown, signal?: AbortSignal): AsyncIterable<unknown>;
}

/** 创建流式通信处理器所需依赖。 */
export interface CommunicationStreamRequestHandlerOptions {
  workflowService: CommunicationStreamWorkflowService;
  requestLogger?: CommunicationRequestLogger;
  clock?: () => number;
  heartbeatIntervalMs?: number;
}

/** 为单次流调用关联递增序号、完成状态与安全错误。 */
export class CommunicationStreamRequestHandler {
  private readonly workflowService: CommunicationStreamWorkflowService;
  private readonly requestLogger: CommunicationRequestLogger | undefined;
  private readonly clock: () => number;
  private readonly heartbeatIntervalMs: number;

  /** 保存领域流、审计日志和可替换计时器。 */
  constructor(options: CommunicationStreamRequestHandlerOptions) {
    this.workflowService = options.workflowService;
    this.requestLogger = options.requestLogger;
    this.clock = options.clock ?? (() => performance.now());
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 20_000;
    if (this.heartbeatIntervalMs <= 0) throw new Error("流心跳间隔必须为正数。");
  }

  /** 执行一个流请求，并输出严格递增的事件、完成或错误信封。 */
  async *handle(
    message: CommunicationStreamRequestMessage,
    signal?: AbortSignal,
  ): AsyncIterable<CommunicationStreamMessage> {
    const startedAt = this.clock();
    let seq = 0;
    const iterator = this.workflowService.stream(
      message.method,
      message.params,
      signal,
    )[Symbol.asyncIterator]();
    let pendingNext = iterator.next();
    try {
      for (;;) {
        const result = await waitForNextOrHeartbeat(
          pendingNext,
          this.heartbeatIntervalMs,
          signal,
        );
        if (result.kind === "aborted") return;
        if (result.kind === "heartbeat") {
          seq += 1;
          yield createCommunicationStreamHeartbeatMessage(message.requestId, seq);
          continue;
        }
        if (result.value.done) break;
        seq += 1;
        yield createCommunicationStreamEventMessage(message.requestId, seq, result.value.value);
        pendingNext = iterator.next();
      }
      seq += 1;
      yield createCommunicationStreamCompleteMessage(message.requestId, seq);
      const context = readCommunicationLogContext(message.params);
      await this.recordSafely(this.requestLogger?.recordSuccess({
        requestId: message.requestId,
        method: message.method,
        durationMs: this.elapsedMilliseconds(startedAt),
        ...(context.taskId ? { taskId: context.taskId } : {}),
      }));
    } catch (error: unknown) {
      if (signal?.aborted || isAbortError(error)) return;
      const context = readCommunicationLogContext(message.params);
      await this.recordSafely(this.requestLogger?.recordFailure({
        requestId: message.requestId,
        method: message.method,
        durationMs: this.elapsedMilliseconds(startedAt),
        ...(context.taskId ? { taskId: context.taskId } : {}),
        ...(context.projectPath ? { projectPath: context.projectPath } : {}),
        errorName: error instanceof Error ? error.name : "UnknownError",
      }));
      seq += 1;
      const errorMessage = error instanceof Error ? error.message : "D2C workflow stream failed.";
      yield createCommunicationStreamErrorMessage(message.requestId, seq, errorMessage);
    } finally {
      await iterator.return?.();
    }
  }

  /** 将高精度计时转换为非负整数毫秒。 */
  private elapsedMilliseconds(startedAt: number): number {
    return Math.max(0, Math.round(this.clock() - startedAt));
  }

  /** 防止日志异常改变已经确定的流输出。 */
  private async recordSafely(record: Promise<void> | undefined): Promise<void> {
    if (!record) return;
    try {
      await record;
    } catch {
      // 审计持久化故障不得改变领域流结果。
    }
  }
}

type PendingStreamResult =
  | { kind: "next"; value: IteratorResult<unknown> }
  | { kind: "heartbeat" }
  | { kind: "aborted" };

/** 等待下一个领域事件，同时在空闲期间产生可取消的传输心跳。 */
function waitForNextOrHeartbeat(
  pendingNext: Promise<IteratorResult<unknown>>,
  heartbeatIntervalMs: number,
  signal: AbortSignal | undefined,
): Promise<PendingStreamResult> {
  if (signal?.aborted) return Promise.resolve({ kind: "aborted" });
  return new Promise<PendingStreamResult>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish({ kind: "heartbeat" }), heartbeatIntervalMs);
    const handleAbort = () => finish({ kind: "aborted" });

    /** 完成当前竞争并释放定时器与取消监听。 */
    function finish(result: PendingStreamResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", handleAbort);
      resolve(result);
    }

    signal?.addEventListener("abort", handleAbort, { once: true });
    void pendingNext.then(
      (value) => finish({ kind: "next", value }),
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

/** 判断异常是否是沿传输链传播的主动取消。 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
