/** 通过共享通信协议访问 Agent Server 的 Workspace 任务查询与管理能力。 */

import { randomUUID } from "node:crypto";
import {
  communicationResponseMessageSchema,
  communicationTransportMethods,
  createCommunicationProtocolNegotiationInput,
  createCommunicationRequestMessage,
  deleteD2CTaskResultSchema,
  d2cTaskSummaryPageSchema,
  d2cWorkflowMethods,
  d2cWorkflowSnapshotSchema,
  negotiateCommunicationProtocolResultSchema,
  type D2CTaskSummary,
  type D2CTaskSummaryPage,
} from "@ui-forge/shared-protocol";

/** 侧边栏消费的最小任务客户端契约。 */
export interface UiForgeTaskClient {
  /** 分页读取当前 Workspace 的活动与归档任务摘要。 */
  listTasks(input?: { cursor?: string; includeArchived?: boolean }): Promise<D2CTaskSummaryPage>;
  /** 使用摘要 revision 重命名任务。 */
  renameTask(task: D2CTaskSummary, displayName: string): Promise<void>;
  /** 使用摘要 revision 软归档任务。 */
  archiveTask(task: D2CTaskSummary): Promise<void>;
  /** 使用摘要 revision 恢复任务。 */
  restoreTask(task: D2CTaskSummary): Promise<void>;
  /** 使用摘要 revision 永久删除任务。 */
  deleteTask(task: D2CTaskSummary): Promise<void>;
}

/** Agent Server 任务客户端的传输配置。 */
export interface UiForgeServerTaskClientOptions {
  endpoint: string;
  getProjectPath: () => string | undefined;
  fetchImplementation?: typeof fetch;
}

/** 创建带响应校验和 Workspace 宿主上下文的任务客户端。 */
export function createUiForgeServerTaskClient(
  options: UiForgeServerTaskClientOptions,
): UiForgeTaskClient {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  let negotiation: Promise<void> | undefined;

  /** 发送一个共享协议请求并校验业务响应。 */
  async function sendRequest<T>(
    method: string,
    params: Record<string, unknown>,
    responseSchema: { parse(value: unknown): T },
  ): Promise<T> {
    const requestId = `extension-${randomUUID()}`;
    const response = await fetchImplementation(options.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createCommunicationRequestMessage(requestId, method, params)),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Agent Server 返回 ${response.status}。`);
    const message = communicationResponseMessageSchema.parse(await response.json());
    if (message.requestId !== requestId) throw new Error("Agent Server 响应关联标识不匹配。");
    if (!message.success) throw new Error(message.error.message);
    return responseSchema.parse(message.data);
  }

  /** 在第一次任务请求前确认 Server 支持当前持久任务能力。 */
  async function ensureNegotiated(): Promise<void> {
    negotiation ??= sendRequest(
      communicationTransportMethods.negotiateProtocol,
      createCommunicationProtocolNegotiationInput(),
      negotiateCommunicationProtocolResultSchema,
    ).then(() => undefined).catch((error: unknown) => {
      negotiation = undefined;
      throw error;
    });
    await negotiation;
  }

  /** 协商完成后发送一个任务业务请求。 */
  async function request<T>(
    method: string,
    params: Record<string, unknown>,
    responseSchema: { parse(value: unknown): T },
  ): Promise<T> {
    await ensureNegotiated();
    return sendRequest(method, params, responseSchema);
  }

  /** 为每个任务请求附加当前可信 Workspace 路径。 */
  function withProjectPath(params: Record<string, unknown>): Record<string, unknown> {
    const projectPath = options.getProjectPath();
    return projectPath ? { ...params, projectPath } : params;
  }

  return {
    listTasks: (input = {}) => request(
      d2cWorkflowMethods.listTasks,
      withProjectPath({
        includeArchived: input.includeArchived ?? true,
        limit: 100,
        ...(input.cursor ? { cursor: input.cursor } : {}),
      }),
      d2cTaskSummaryPageSchema,
    ),
    renameTask: async (task, displayName) => {
      await request(
        d2cWorkflowMethods.renameTask,
        withProjectPath({
          taskId: task.taskId,
          expectedRevision: task.revision,
          displayName,
        }),
        d2cWorkflowSnapshotSchema,
      );
    },
    archiveTask: async (task) => {
      await request(
        d2cWorkflowMethods.archiveTask,
        withProjectPath({ taskId: task.taskId, expectedRevision: task.revision }),
        d2cWorkflowSnapshotSchema,
      );
    },
    restoreTask: async (task) => {
      await request(
        d2cWorkflowMethods.restoreTask,
        withProjectPath({ taskId: task.taskId, expectedRevision: task.revision }),
        d2cWorkflowSnapshotSchema,
      );
    },
    deleteTask: async (task) => {
      await request(
        d2cWorkflowMethods.deleteTask,
        withProjectPath({ taskId: task.taskId, expectedRevision: task.revision }),
        deleteD2CTaskResultSchema,
      );
    },
  };
}
