/** 根据当前主线程和关联的原生错误活动展示重试，不调度或推断执行。 */
import type { NativeNotification, NativeThread } from "@ui-forge/shared-protocol";

/** 只接受当前运行轮次最后一条结构化重试标志；终态和子线程活动不能延续提示。 */
export function currentNativeRetry(
  thread: NativeThread | undefined,
  activities: readonly NativeNotification[],
): boolean {
  const turn = thread?.turns.findLast((entry) => entry.status === "inProgress");
  if (!thread || !turn) return false;
  const latest = activities.findLast(
    (activity) =>
      activity.method === "error" &&
      activity.params?.threadId === thread.id &&
      activity.params.turnId === turn.id,
  );
  return latest?.params?.willRetry === true;
}
