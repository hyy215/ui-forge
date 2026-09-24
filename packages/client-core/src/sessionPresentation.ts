/** 将原生事件归并为消息展示缓存；不调度执行、不推断验收结论。 */
import {
  nativeItemSchema,
  nativeTurnSchema,
  type NativeItem,
  type NativeNotification,
  type NativeTurn,
  type PendingRequest,
  type SessionEvent,
  type SessionSnapshot,
} from "@ui-forge/shared-protocol";
import { z } from "zod";

/** 会话展示副本；Server 和页面使用相同归并规则，不作为执行状态的来源。 */
export interface SessionPresentation {
  /** 当前主线程历史及展示中的待处理请求。 */
  snapshot?: SessionSnapshot;
  /** 历史之外的计划、差异及子线程活动，保留待审批 item 的预览。 */
  activities: NativeNotification[];
  /** 当前订阅的连接状态。 */
  connection: "connecting" | "connected" | "closed";
  /** 最近的连接错误或诊断信息。 */
  notice: string;
}
/** 新订阅等待原生快照。 */
export function emptyPresentation(): SessionPresentation {
  return { activities: [], connection: "connecting", notice: "" };
}
/** 从可序列化载荷读取字符串，未知内容不做类型断言。 */
export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 用完整的线程、轮次和 item 标识关联审批预览，避免误用同名子任务的内容。 */
export function requestItem(
  state: SessionPresentation,
  pending: PendingRequest,
): NativeItem | undefined {
  const { threadId, turnId, itemId } = pending.request.params;
  if (state.snapshot && threadId === state.snapshot.thread.id)
    return state.snapshot.thread.turns
      .find((turn) => turn.id === turnId)
      ?.items.find((item) => item.id === itemId);
  for (const activity of state.activities.toReversed()) {
    const params = z
      .object({ threadId: z.string(), turnId: z.string(), item: nativeItemSchema })
      .safeParse(activity.params);
    if (
      params.success &&
      params.data.threadId === threadId &&
      params.data.turnId === turnId &&
      params.data.item.id === itemId
    )
      return params.data.item;
  }
  return undefined;
}

/** 归并原生消息 ID；完成事件以完整 item 替换流式文本。 */
export function applySessionEvent(
  state: SessionPresentation,
  event: SessionEvent,
): SessionPresentation {
  if (event.type === "snapshot")
    return {
      ...state,
      snapshot: event.snapshot,
      activities: [],
      connection: "connected",
      notice: "",
    };
  if (event.type === "close")
    return {
      ...state,
      connection: "closed",
      notice: event.message,
      ...(state.snapshot ? { snapshot: { ...state.snapshot, pendingRequests: [] } } : {}),
    };
  if (event.type === "diagnostic") return { ...state, notice: event.message };
  if (!state.snapshot) return state;
  const snapshot = state.snapshot;
  if (event.type === "resolved")
    return {
      ...state,
      snapshot: {
        ...snapshot,
        pendingRequests: snapshot.pendingRequests.filter((entry) => entry.token !== event.token),
      },
    };
  if (event.type === "request")
    return {
      ...state,
      snapshot: {
        ...snapshot,
        pendingRequests: [
          ...snapshot.pendingRequests.filter((entry) => entry.token !== event.pending.token),
          event.pending,
        ],
      },
    };
  const { method, params = {} } = event.notification;
  if (method === "serverRequest/resolved")
    return {
      ...state,
      snapshot: {
        ...snapshot,
        pendingRequests: snapshot.pendingRequests.filter(
          (entry) => entry.request.id !== params.requestId,
        ),
      },
    };
  if (typeof params.threadId === "string" && params.threadId !== snapshot.thread.id) {
    if (
      method.endsWith("Delta") ||
      method.endsWith("/delta") ||
      method === "thread/tokenUsage/updated"
    )
      return state;
    return addActivity(state, method, params);
  }
  if (method === "thread/status/changed") {
    const status = z.object({ type: z.string() }).catchall(z.json()).safeParse(params.status);
    return status.success
      ? { ...state, snapshot: { ...snapshot, thread: { ...snapshot.thread, status: status.data } } }
      : state;
  }
  if (method === "turn/started" || method === "turn/completed") {
    const turn = nativeTurnSchema.safeParse(params.turn);
    if (!turn.success) return state;
    const previous = snapshot.thread.turns.find((entry) => entry.id === turn.data.id);
    // 同一轮次的终态不可被迟到或重复的启动事件降回运行中，也不能丢掉结果和错误。
    if (
      method === "turn/started" &&
      previous &&
      ["completed", "failed", "interrupted"].includes(previous.status)
    )
      return state;
    const merged = {
      ...turn.data,
      items: turn.data.items.length ? turn.data.items : (previous?.items ?? []),
    };
    return {
      ...state,
      snapshot: {
        ...snapshot,
        pendingRequests:
          method === "turn/completed"
            ? snapshot.pendingRequests.filter(
                (entry) => entry.request.params.turnId !== turn.data.id,
              )
            : snapshot.pendingRequests,
        thread: { ...snapshot.thread, turns: upsertTurn(snapshot.thread.turns, merged) },
      },
    };
  }
  const turnId = stringValue(params.turnId);
  if (method === "item/started" || method === "item/completed") {
    const item = nativeItemSchema.safeParse(params.item);
    if (!item.success || !turnId) return state;
    const previous = snapshot.thread.turns
      .find((turn) => turn.id === turnId)
      ?.items.find((entry) => entry.id === item.data.id);
    // 终态 item 的重复通知不代表当前重试已经取得新进展。
    const hasProgress =
      !previous ||
      previous.type !== item.data.type ||
      previous.status !== item.data.status ||
      (typeof item.data.text === "string" &&
        item.data.text.length > 0 &&
        previous.text !== item.data.text) ||
      (typeof item.data.aggregatedOutput === "string" &&
        item.data.aggregatedOutput.length > 0 &&
        previous.aggregatedOutput !== item.data.aggregatedOutput);
    return updateItem(
      hasProgress ? clearNativeRetry(state, params.threadId, turnId) : state,
      turnId,
      item.data,
    );
  }
  const itemId = stringValue(params.itemId);
  const delta = stringValue(params.delta);
  if (turnId && itemId && typeof params.delta === "string") {
    const previous = snapshot.thread.turns
      .find((turn) => turn.id === turnId)
      ?.items.find((item) => item.id === itemId);
    if (method === "item/agentMessage/delta" || method === "item/plan/delta")
      return updateItem(delta ? clearNativeRetry(state, params.threadId, turnId) : state, turnId, {
        ...previous,
        id: itemId,
        type: previous?.type ?? (method.includes("agentMessage") ? "agentMessage" : "plan"),
        text: stringValue(previous?.text) + delta,
      });
    if (method === "item/commandExecution/outputDelta")
      return updateItem(delta ? clearNativeRetry(state, params.threadId, turnId) : state, turnId, {
        ...previous,
        id: itemId,
        type: "commandExecution",
        aggregatedOutput: stringValue(previous?.aggregatedOutput) + delta,
      });
    if (method === "item/reasoning/summaryTextDelta") {
      const summary = z.array(z.string()).catch([]).parse(previous?.summary);
      const index =
        typeof params.summaryIndex === "number" &&
        Number.isInteger(params.summaryIndex) &&
        params.summaryIndex >= 0
          ? params.summaryIndex
          : 0;
      if (index < 1000) {
        while (summary.length <= index) summary.push("");
        summary[index] = (summary[index] ?? "") + delta;
      }
      return updateItem(
        delta && index < 1000 ? clearNativeRetry(state, params.threadId, turnId) : state,
        turnId,
        { ...previous, id: itemId, type: "reasoning", summary },
      );
    }
  }
  if (
    method === "thread/started" ||
    method === "thread/tokenUsage/updated" ||
    method === "item/reasoning/textDelta" ||
    method === "item/reasoning/summaryPartAdded"
  )
    return state;
  return addActivity(state, method, params);
}

/** 真实主线程活动恢复后移除过期重试提示；不改变轮次、审批或原始历史。 */
function clearNativeRetry(
  state: SessionPresentation,
  threadId: unknown,
  turnId: string,
): SessionPresentation {
  if (
    threadId !== state.snapshot?.thread.id ||
    !state.snapshot?.thread.turns.some((turn) => turn.id === turnId && turn.status === "inProgress")
  )
    return state;
  const activities = state.activities.filter(
    (activity) =>
      !(
        activity.method === "error" &&
        activity.params?.threadId === threadId &&
        activity.params?.turnId === turnId &&
        activity.params?.willRetry === true
      ),
  );
  return activities.length === state.activities.length ? state : { ...state, activities };
}

/** 替换同一轮次的补丁/计划与同一子任务 item 的更新，避免重复堆积整份 JSON。 */
function addActivity(
  state: SessionPresentation,
  method: string,
  params: NonNullable<NativeNotification["params"]>,
): SessionPresentation {
  const key = (name: string, value: Record<string, unknown>) => {
    const item = nativeItemSchema.safeParse(value.item);
    return [
      name === "item/started" || name === "item/completed" ? "item" : name,
      stringValue(value.threadId),
      stringValue(value.turnId),
      item.success ? item.data.id : stringValue(value.itemId),
    ].join(":");
  };
  const replaceable = [
    "turn/diff/updated",
    "turn/plan/updated",
    "item/mcpToolCall/progress",
    "item/started",
    "item/completed",
  ].includes(method);
  const index = replaceable
    ? state.activities.findIndex((activity) => {
        const previous = z.record(z.string(), z.unknown()).safeParse(activity.params);
        return previous.success && key(activity.method, previous.data) === key(method, params);
      })
    : -1;
  const activities =
    index < 0
      ? [...state.activities, { method, params }]
      : state.activities.map((activity, current) =>
          current === index ? { method, params } : activity,
        );
  const retained = activities.filter((activity, current) => {
    if (current >= activities.length - 80) return true;
    const item = nativeItemSchema.safeParse(activity.params?.item);
    return (
      item.success &&
      state.snapshot?.pendingRequests.some(
        ({ request }) =>
          request.params.threadId === activity.params?.threadId &&
          request.params.turnId === activity.params?.turnId &&
          request.params.itemId === item.data.id,
      )
    );
  });
  return {
    ...state,
    activities: retained,
  };
}

/** 替换一个原生轮次，维持历史顺序。 */
function upsertTurn(turns: NativeTurn[], turn: NativeTurn): NativeTurn[] {
  return turns.some((entry) => entry.id === turn.id)
    ? turns.map((entry) => (entry.id === turn.id ? turn : entry))
    : [...turns, turn];
}
/** 仅修改对应原生 item 的展示数据。 */
function updateItem(
  state: SessionPresentation,
  turnId: string,
  item: NativeItem,
): SessionPresentation {
  const snapshot = state.snapshot;
  if (!snapshot) return state;
  const turn = snapshot.thread.turns.find((entry) => entry.id === turnId);
  if (!turn) return state;
  const items = turn.items.some((entry) => entry.id === item.id)
    ? turn.items.map((entry) => (entry.id === item.id ? item : entry))
    : [...turn.items, item];
  return {
    ...state,
    snapshot: {
      ...snapshot,
      thread: { ...snapshot.thread, turns: upsertTurn(snapshot.thread.turns, { ...turn, items }) },
    },
  };
}
