/** 在 Agent 名称旁展示当前对话流的实时或最终耗时。 */

import { useEffect, useState } from "react";
import type { ConversationStreamState } from "../model/conversationStreamState";
import { formatDurationInSeconds } from "./durationFormat";

/** 对话流计时器所需的局部状态。 */
export interface ConversationRunTimerProps {
  conversation: ConversationStreamState;
}

/** 在流运行时逐秒更新，并在终止、失败或完成后冻结最终耗时。 */
export function ConversationRunTimer({ conversation }: ConversationRunTimerProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!conversation.streamActive) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [conversation.streamActive, conversation.streamStartedAt]);

  if (conversation.streamStartedAt === null) return null;
  const finishedAt = conversation.streamFinishedAt ?? now;
  const elapsed = formatDurationInSeconds(finishedAt - conversation.streamStartedAt);
  const label = conversation.streamActive
    ? `已执行 ${elapsed}`
    : conversation.status === "stopped"
      ? `已终止 · 用时 ${elapsed}`
      : conversation.status === "error"
        ? `失败 · 用时 ${elapsed}`
        : `完成用时 ${elapsed}`;
  const className = conversation.streamActive
    ? "conversation-run-time conversation-run-time--active"
    : "conversation-run-time";
  return <small className={className}>{label}</small>;
}
