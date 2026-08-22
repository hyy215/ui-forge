/** 隔离领域包与 LangGraph Checkpointer 具体类型导入路径。 */

import {
  MemorySaver,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";

/** Agent Core 接受的 LangGraph 状态检查点持久化端口。 */
export type Checkpointer = BaseCheckpointSaver;

/** 清理已终止工作流线程所需的最小通用 Checkpoint 能力。 */
export interface CheckpointThreadDisposer {
  deleteThread(threadId: string): Promise<void>;
}

/** 创建适用于测试和单进程运行的内存 Checkpointer。 */
export function createMemoryCheckpointer(): Checkpointer {
  return new MemorySaver();
}
