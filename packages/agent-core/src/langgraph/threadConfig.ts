/** 提供领域无关的 LangGraph thread_id 配置构造能力。 */

/** 创建可供任意工作流保存和恢复状态的 LangGraph 线程配置。 */
export function createThreadConfig(threadId: string) {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) throw new Error("LangGraph thread_id 不能为空。");
  return { configurable: { thread_id: normalizedThreadId } };
}
