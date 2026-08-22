/** 执行已校验的通信请求，并统一处理计时、审计日志和协议响应。 */

import {
  createFailedCommunicationResponseMessage,
  createSuccessfulCommunicationResponseMessage,
  d2cWorkflowSnapshotSchema,
  type CommunicationRequestMessage,
  type CommunicationResponseMessage,
} from "@ui-forge/shared-protocol";
import { readCommunicationLogContext } from "../logging/communicationLogContext.js";
import type { CommunicationRequestLogger } from "../logging/workspaceRequestLogger.js";

/** 通信请求处理器调用的 D2C 应用服务端口。 */
export interface CommunicationWorkflowService {
  handle(method: string, params: unknown): Promise<unknown>;
}

/** 创建通信请求处理器所需的显式依赖。 */
export interface CommunicationRequestHandlerOptions {
  workflowService: CommunicationWorkflowService;
  requestLogger?: CommunicationRequestLogger;
  clock?: () => number;
}

/** 将一次协议请求执行为成功或失败响应，并记录安全审计结果。 */
export class CommunicationRequestHandler {
  private readonly workflowService: CommunicationWorkflowService;
  private readonly requestLogger: CommunicationRequestLogger | undefined;
  private readonly clock: () => number;

  /** 创建不依赖 Fastify 的通信请求执行器。 */
  constructor(options: CommunicationRequestHandlerOptions) {
    this.workflowService = options.workflowService;
    this.requestLogger = options.requestLogger;
    this.clock = options.clock ?? (() => performance.now());
  }

  /** 执行已经通过 shared-protocol 校验的双向请求。 */
  async handle(message: CommunicationRequestMessage): Promise<CommunicationResponseMessage> {
    const startedAt = this.clock();
    let result: unknown;
    try {
      result = await this.workflowService.handle(message.method, message.params);
    } catch (error: unknown) {
      const context = readCommunicationLogContext(message.params);
      await this.recordSafely(this.requestLogger?.recordFailure({
        requestId: message.requestId,
        method: message.method,
        durationMs: this.elapsedMilliseconds(startedAt),
        ...(context.taskId ? { taskId: context.taskId } : {}),
        ...(context.projectPath ? { projectPath: context.projectPath } : {}),
        errorName: error instanceof Error ? error.name : "UnknownError",
      }));
      const errorMessage = error instanceof Error ? error.message : "D2C workflow request failed.";
      return createFailedCommunicationResponseMessage(message.requestId, errorMessage);
    }

    const snapshotResult = d2cWorkflowSnapshotSchema.safeParse(result);
    const context = readCommunicationLogContext(message.params);
    await this.recordSafely(this.requestLogger?.recordSuccess({
      requestId: message.requestId,
      method: message.method,
      durationMs: this.elapsedMilliseconds(startedAt),
      ...(snapshotResult.success ? { snapshot: snapshotResult.data } : {}),
      ...(!snapshotResult.success && context.taskId ? { taskId: context.taskId } : {}),
    }));
    return createSuccessfulCommunicationResponseMessage(message.requestId, result);
  }

  /** 将高精度计时转换为适合结构化日志的非负整数毫秒。 */
  private elapsedMilliseconds(startedAt: number): number {
    return Math.max(0, Math.round(this.clock() - startedAt));
  }

  /** 防止自定义日志端口的异常改变已经确定的业务响应。 */
  private async recordSafely(record: Promise<void> | undefined): Promise<void> {
    if (!record) return;
    try {
      await record;
    } catch {
      // 生产 WorkspaceRequestLogger 会自行告警；其他实现同样不得影响通信结果。
    }
  }
}
