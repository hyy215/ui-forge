/** 向页面提供经 Schema 校验的会话、规则及只读诊断和交付操作，隔离宿主传输。 */
import {
  sessionMethods,
  instructionMethods,
  createdSessionSchema,
  sessionSnapshotSchema,
  sessionOperationResultSchema,
  taskHistoryPageSchema,
  sessionEventSchema,
  instructionDocumentSchema,
  diagnosticMethods,
  taskDiagnosticsSchema,
  deliveryMethods,
  taskDeliverySchema,
  designMethods,
  designSourceSchema,
  designConnectionCheckSchema,
  type DesignSource,
  type CreateSessionInput,
  type SendSessionInput,
  type SessionEvent,
  type InstructionKind,
  type InstructionDocument,
} from "@ui-forge/shared-protocol";
import type { CommunicationClient } from "../communication/clientContract";
import { continuationPrompt } from "@ui-forge/client-core";

/** 构造页面共享数据源；长操作超时不隐式重试或停止任务。 */
export function createSessionDataSource(client: CommunicationClient) {
  return {
    /** 只读验证所选来源，不创建或恢复会话；调用方可取消过期检查。 */
    checkDesignConnection: (source: DesignSource, signal?: AbortSignal) => {
      const requestedSource = designSourceSchema.parse(source);
      return client.request({
        method: designMethods.check,
        params: { source: requestedSource },
        responseSchema: designConnectionCheckSchema.refine(
          (report) => JSON.stringify(report.source) === JSON.stringify(requestedSource),
          { message: "连接检查结果不属于当前设计来源。" },
        ),
        timeoutMs: 120_000,
        ...(signal ? { signal } : {}),
      });
    },
    create: (input: CreateSessionInput) =>
      client.request({
        method: sessionMethods.create,
        params: input,
        responseSchema: createdSessionSchema,
        timeoutMs: 180_000,
      }),
    read: (taskId: string) =>
      client.request({
        method: sessionMethods.read,
        params: { taskId },
        responseSchema: sessionSnapshotSchema,
        timeoutMs: 120_000,
      }),
    /** 按需读取独立诊断报告，不恢复会话、不发送消息，也不隐式重试。 */
    readDiagnostics: (taskId: string, signal?: AbortSignal) =>
      client.request({
        method: diagnosticMethods.read,
        params: { taskId },
        responseSchema: taskDiagnosticsSchema.refine((report) => report.taskId === taskId, {
          message: "诊断报告不属于当前任务。",
        }),
        timeoutMs: 120_000,
        ...(signal ? { signal } : {}),
      }),
    /** 仅核对当前任务的交付报告与证据，不恢复线程或重新执行检查。 */
    readDelivery: (taskId: string, signal?: AbortSignal) =>
      client.request({
        method: deliveryMethods.read,
        params: { taskId },
        responseSchema: taskDeliverySchema.refine(
          (delivery) =>
            delivery.taskId === taskId && (!delivery.report || delivery.report.taskId === taskId),
          { message: "交付报告不属于当前任务。" },
        ),
        timeoutMs: 120_000,
        ...(signal ? { signal } : {}),
      }),
    list: (offset = 0) =>
      client.request({
        method: sessionMethods.list,
        params: { offset },
        responseSchema: taskHistoryPageSchema,
      }),
    send: (taskId: string, text: string, images: SendSessionInput["images"] = []) =>
      client.request({
        method: sessionMethods.send,
        params: { taskId, text, images },
        responseSchema: sessionOperationResultSchema,
        timeoutMs: 120_000,
      }),
    /** 复用空闲时发送能力；其他入口已启动轮次时不重复提交继续请求。 */
    continue: (taskId: string) =>
      client.request({
        method: sessionMethods.send,
        params: { taskId, text: continuationPrompt, startOnlyIfIdle: true },
        responseSchema: sessionOperationResultSchema,
        timeoutMs: 120_000,
      }),
    stop: (taskId: string, turnId: string) =>
      client.request({
        method: sessionMethods.stop,
        params: { taskId, turnId },
        responseSchema: sessionOperationResultSchema,
        timeoutMs: 120_000,
      }),
    respond: (taskId: string, token: string, result: unknown) =>
      client.request({
        method: sessionMethods.respond,
        params: { taskId, token, result },
        responseSchema: sessionOperationResultSchema,
        timeoutMs: 120_000,
      }),
    subscribe: (taskId: string, onEvent: (event: SessionEvent) => void, signal: AbortSignal) =>
      client.stream({
        method: sessionMethods.subscribe,
        params: { taskId },
        onEvent,
        signal,
        eventSchema: sessionEventSchema,
      }),
    readInstruction: (kind: InstructionKind, signal?: AbortSignal) =>
      client.request({
        method: instructionMethods.read,
        params: { kind },
        responseSchema: instructionDocumentSchema,
        ...(signal ? { signal } : {}),
      }),
    saveInstruction: (document: InstructionDocument, content: string) =>
      client.request({
        method: instructionMethods.save,
        params: { kind: document.kind, content, revision: document.revision },
        responseSchema: instructionDocumentSchema,
      }),
  };
}
/** 页面依赖的数据源，不包含 HTTP 或 VS Code API。 */
export type SessionDataSource = ReturnType<typeof createSessionDataSource>;
