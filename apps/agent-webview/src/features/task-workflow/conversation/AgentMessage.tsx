/** 展示单视图工作流中的普通 UiForge 对话消息。 */

import type { ReactNode } from "react";
import { Avatar } from "antd";

/** Agent 消息内容参数。 */
interface AgentMessageProps {
  children: ReactNode;
}

/** 渲染带 UiForge 身份标识的普通 Assistant 消息气泡。 */
export function AgentMessage({ children }: AgentMessageProps) {
  return <div className="message message--agent">
    <Avatar size={28} className="agent-avatar">U</Avatar>
    <div><strong>ui-forge</strong>{children}</div>
  </div>;
}
