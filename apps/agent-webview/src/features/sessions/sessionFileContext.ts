/** 向会话及子任务消息传递当前任务的文件打开能力。 */
import { createContext } from "react";
import type { SessionFileSource } from "../../data-sources/sessionFileSource";

/** 缺少任务上下文时只展示文本，不生成指向错误任务的链接。 */
export const SessionFileContext = createContext<{
  taskId: string;
  source: SessionFileSource;
} | null>(null);
