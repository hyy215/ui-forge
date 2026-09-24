/** 展示原生轮次耗时和当前连接观测值；本地计时不触发网络请求或控制任务。 */
import { useEffect, useState } from "react";
import {
  formatObservedDuration,
  nativeTurnElapsedMs,
  type TaskObservation,
} from "@ui-forge/client-core";
import type { NativeThread, PendingRequest } from "@ui-forge/shared-protocol";
import styles from "./Sessions.module.css";

interface TaskRuntimeStatusProps {
  thread: NativeThread;
  connected: boolean;
  observation: TaskObservation | null;
  pendingRequests: readonly PendingRequest[];
}

/** 只在已连接且有运行轮次时刷新时钟，不把缺活动、Token 或终态当成验收结论。 */
export function TaskRuntimeStatus({
  thread,
  connected,
  observation,
  pendingRequests,
}: TaskRuntimeStatusProps) {
  const turn =
    thread.turns.findLast((entry) => entry.status === "inProgress") ?? thread.turns.at(-1);
  const running = turn?.status === "inProgress";
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!connected || !running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [connected, running, turn?.id]);
  const current = observation?.taskId === thread.id ? observation : null;
  const flags =
    thread.status.type === "active" && Array.isArray(thread.status.activeFlags)
      ? thread.status.activeFlags
      : [];
  const waitingForInput =
    pendingRequests.some((pending) =>
      ["item/tool/requestUserInput", "mcpServer/elicitation/request"].includes(
        pending.request.method,
      ),
    ) || flags.includes("waitingOnUserInput");
  const waitingForApproval =
    pendingRequests.some((pending) =>
      [
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
        "item/permissions/requestApproval",
        "execCommandApproval",
        "applyPatchApproval",
      ].includes(pending.request.method),
    ) || flags.includes("waitingOnApproval");
  const waiting = !running
    ? null
    : waitingForInput
      ? "等待用户输入"
      : waitingForApproval
        ? "等待审批"
        : pendingRequests.length
          ? "等待响应"
          : null;
  const recent = !connected
    ? "未知（连接中断）"
    : (waiting ??
      (current?.lastEventAtMs == null
        ? "本次连接暂未收到新活动"
        : running
          ? `${formatObservedDuration(Math.max(0, now - current.lastEventAtMs))}前收到活动`
          : `最后收到于 ${new Date(current.lastEventAtMs).toLocaleTimeString("zh-CN", { hour12: false })}`));
  // Completed and failed turns do not need a second summary strip once the
  // connection is healthy; keep it for active, pending, or disconnected work.
  if (connected && !running && pendingRequests.length === 0 && current?.lastEventAtMs == null)
    return null;
  return (
    <section className={styles.runtimeStatus} aria-label="运行信息">
      <dl>
        <div>
          <dt>{running ? "本轮已用时（含等待）" : "本轮耗时（含等待）"}</dt>
          <dd data-testid="runtime-elapsed">
            {connected
              ? formatObservedDuration(nativeTurnElapsedMs(turn, now))
              : "未知（连接中断）"}
          </dd>
        </div>
        <div>
          <dt>最近活动（本次连接）</dt>
          <dd data-testid="runtime-activity">{recent}</dd>
        </div>
        <div>
          <dt>Token · 本线程累计（最近观测）</dt>
          <dd data-testid="runtime-tokens">
            {current?.totalTokens == null ? "未知" : current.totalTokens.toLocaleString("zh-CN")}
            {current?.tokenObservedAtMs != null && (
              <small>
                {connected ? "记录于 " : "断线前记录于 "}
                {new Date(current.tokenObservedAtMs).toLocaleTimeString("zh-CN", { hour12: false })}
              </small>
            )}
          </dd>
        </div>
      </dl>
      {!connected && <p>连接已中断，当前执行状态未知。</p>}
    </section>
  );
}
