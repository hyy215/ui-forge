/** 从不可信通信参数中提取日志关联所需的最小非配置上下文。 */

/** 日志允许读取的任务与 Workspace 关联字段。 */
export interface CommunicationLogContext {
  taskId?: string;
  projectPath?: string;
}

/** 只读取 taskId 和 projectPath，不复制请求参数或配置类字段。 */
export function readCommunicationLogContext(params: unknown): CommunicationLogContext {
  if (typeof params !== "object" || params === null) return {};
  const value = params as Record<string, unknown>;
  return {
    ...(typeof value.taskId === "string" ? { taskId: value.taskId } : {}),
    ...(typeof value.projectPath === "string" ? { projectPath: value.projectPath } : {}),
  };
}
