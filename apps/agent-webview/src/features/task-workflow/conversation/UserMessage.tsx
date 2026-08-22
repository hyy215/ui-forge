/** 展示单视图工作流中的用户设计引用与确认口令消息。 */

import type { ReactNode } from "react";
import { Avatar } from "antd";

/** 用户消息内容参数。 */
interface UserMessageProps {
  children: ReactNode;
}

/** 渲染带用户身份标识的设计链接或确认口令消息。 */
export function UserMessage({ children }: UserMessageProps) {
  return <div className="message message--user">
    <Avatar size={28}>U</Avatar>
    <div><strong>你</strong><p>{children}</p></div>
  </div>;
}
