/** 在 Extension 边界绑定工作区，防止页面传入其他目录或绕过信任状态。 */
import { realpath } from "node:fs/promises";
import {
  createSessionSchema,
  checkDesignConnectionSchema,
  designMethods,
  deliveryMethods,
  readTaskDeliverySchema,
  sessionIdSchema,
  sessionMethods,
  instructionMethods,
  sessionSnapshotSchema,
  type CommunicationRequestMessage,
} from "@ui-forge/shared-protocol";

/** 当前 VS Code 明确授权的工作区上下文。 */
export interface HostWorkspace {
  trusted: boolean;
  projectPath?: string;
}

/** 需要当前窗口信任的操作；转发前也必须使用同一集合复核授权上下文。 */
export function requiresWorkspaceTrust(method: string): boolean {
  return [
    sessionMethods.create,
    sessionMethods.send,
    sessionMethods.stop,
    sessionMethods.respond,
    instructionMethods.save,
    designMethods.check,
  ].some((candidate) => candidate === method);
}

/** 执行和外部设计连接要求工作区信任；配置读取和历史浏览不启动执行。 */
export async function authorizeHostRequest(
  message: CommunicationRequestMessage,
  workspace: HostWorkspace,
  read: (taskId: string) => Promise<unknown>,
): Promise<CommunicationRequestMessage> {
  if (requiresWorkspaceTrust(message.method) && !workspace.trusted)
    throw new Error("请先信任当前 VS Code 工作区。");
  if (message.method === designMethods.check) {
    return { ...message, params: checkDesignConnectionSchema.parse(message.params) };
  }
  if (message.method === deliveryMethods.read) {
    return { ...message, params: readTaskDeliverySchema.parse(message.params) };
  }
  if (message.method === sessionMethods.create) {
    if (!workspace.projectPath) throw new Error("请先打开目标工作区。");
    const input = createSessionSchema.parse(message.params);
    return { ...message, params: { ...input, projectPath: await realpath(workspace.projectPath) } };
  }
  if (
    [sessionMethods.send, sessionMethods.stop, sessionMethods.respond].some(
      (method) => method === message.method,
    )
  ) {
    if (!workspace.projectPath) throw new Error("请在任务对应的工作区操作。");
    const input = message.params;
    if (!input || typeof input !== "object" || !("taskId" in input))
      throw new Error("缺少任务标识。");
    const { taskId } = sessionIdSchema.parse({ taskId: input.taskId });
    const snapshot = sessionSnapshotSchema.parse(await read(taskId));
    if (snapshot.thread.id !== taskId) throw new Error("返回的任务身份不一致，已拒绝当前操作。");
    if ((await realpath(workspace.projectPath)) !== (await realpath(snapshot.thread.cwd)))
      throw new Error("当前工作区与任务不一致，请打开任务对应目录。");
  }
  return message;
}
