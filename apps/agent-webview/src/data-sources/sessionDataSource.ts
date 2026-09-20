/** 向页面提供经 Schema 校验的会话和规则文件操作，隔离宿主传输。 */
import {
  sessionMethods,
  instructionMethods,
  createdSessionSchema,
  sessionSnapshotSchema,
  sessionOperationResultSchema,
  taskHistoryPageSchema,
  sessionEventSchema,
  instructionDocumentSchema,
  type CreateSessionInput,
  type SendSessionInput,
  type SessionEvent,
  type InstructionKind,
  type InstructionDocument,
} from "@ui-forge/shared-protocol";
import type { CommunicationClient } from "../communication/clientContract";

/** 构造页面共享数据源；长操作超时不隐式重试或停止任务。 */
export function createSessionDataSource(client: CommunicationClient) {
  return {
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
