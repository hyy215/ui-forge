/** 汇总本次连接的主线程消息与 Token 观测，仅用于展示，不控制任务执行。 */
import type { NativeTurn, SessionEvent } from "@ui-forge/shared-protocol";
import { z } from "zod";

/** 当前连接的观测值；收到消息不代表工具取得进展，Token 也不代表预算余额。 */
export interface TaskObservation {
  /** 只接受此主线程的事件。 */
  taskId: string;
  /** 本次连接或同任务快照建立基准的时间，单位为 Unix 毫秒。 */
  connectedAtMs: number;
  /** 本次连接最后收到主线程原生通知或请求的时间，未收到时为 null。 */
  lastEventAtMs: number | null;
  /** 本次连接最后观测的主线程累计 Token，不累加事件或子线程。 */
  totalTokens: number | null;
  /** 累计 Token 最近发生变化的接收时间，重复累计值不刷新。 */
  tokenObservedAtMs: number | null;
}

const tokenUsageSchema = z.object({
  total: z.object({ totalTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
});
const terminalStatuses = new Set(["completed", "failed", "interrupted"]);

function validMilliseconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nativeTimestampMs(value: unknown): number | null {
  if (!validMilliseconds(value) || !Number.isSafeInteger(value * 1000)) return null;
  return value * 1000;
}

/** 建立无事件的连接观测；调用方必须提供有效的 Unix 毫秒时间，否则抛出 RangeError。 */
export function emptyTaskObservation(taskId: string, nowMs: number): TaskObservation {
  if (!validMilliseconds(nowMs)) throw new RangeError("Invalid observation timestamp");
  return {
    taskId,
    connectedAtMs: nowMs,
    lastEventAtMs: null,
    totalTokens: null,
    tokenObservedAtMs: null,
  };
}

/** 只归并精确匹配主线程的接收事件；重连快照清空本连接观测，不代表新的执行进展。 */
export function observeTaskEvent(
  previous: TaskObservation,
  event: SessionEvent,
  nowMs: number,
): TaskObservation {
  if (!validMilliseconds(nowMs)) return previous;
  if (event.type === "snapshot")
    return event.snapshot.thread.id === previous.taskId
      ? emptyTaskObservation(previous.taskId, nowMs)
      : previous;
  const params =
    event.type === "notification"
      ? event.notification.params
      : event.type === "request"
        ? event.pending.request.params
        : undefined;
  if (params?.threadId !== previous.taskId) return previous;
  const observed = { ...previous, lastEventAtMs: nowMs };
  if (event.type !== "notification" || event.notification.method !== "thread/tokenUsage/updated")
    return observed;
  const usage = tokenUsageSchema.safeParse(params.tokenUsage);
  if (!usage.success || usage.data.total.totalTokens === previous.totalTokens) return observed;
  return {
    ...observed,
    totalTokens: usage.data.total.totalTokens,
    tokenObservedAtMs: nowMs,
  };
}

/** 从原生轮次计算展示耗时；原生时间戳为秒，不以连接时间补造缺失的轮次起点。 */
export function nativeTurnElapsedMs(turn: NativeTurn | undefined, nowMs: number): number | null {
  if (!turn) return null;
  const terminal = terminalStatuses.has(turn.status);
  if (terminal && validMilliseconds(turn.durationMs)) return turn.durationMs;
  if (!terminal && turn.status !== "inProgress") return null;
  const startedAtMs = nativeTimestampMs(turn.startedAt);
  if (startedAtMs === null || !validMilliseconds(nowMs) || startedAtMs > nowMs) return null;
  if (turn.status === "inProgress") return nowMs - startedAtMs;
  const completedAtMs = nativeTimestampMs(turn.completedAt);
  return completedAtMs !== null && completedAtMs >= startedAtMs && completedAtMs <= nowMs
    ? completedAtMs - startedAtMs
    : null;
}

/** 用统一中文格式显示已知耗时，舍去不足一秒；缺失或无效值明确显示未知。 */
export function formatObservedDuration(milliseconds: number | null): string {
  if (!validMilliseconds(milliseconds)) return "未知";
  const totalSeconds = Math.floor(milliseconds / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const padded = (value: number) => String(value).padStart(2, "0");
  if (hours) return `${hours}小时${padded(minutes)}分${padded(seconds)}秒`;
  if (totalMinutes) return `${totalMinutes}分${padded(seconds)}秒`;
  return `${seconds}秒`;
}
