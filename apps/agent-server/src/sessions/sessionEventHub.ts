/** 管理会话展示缓存、父子线程事件路由与客户端订阅；不启动或停止模型执行。 */
import type { CodexEvent, PendingRequest } from "@ui-forge/codex-client";
import {
  nativeTurnSchema,
  sessionSnapshotSchema,
  type SessionEvent,
  type DesignBinding,
} from "@ui-forge/shared-protocol";
import { eventThreadId, SessionEventQueue, toSessionEvent } from "./sessionEvents.js";
import { SessionViewCache } from "./sessionViewCache.js";

/** 将连接事件汇入任务，再为每个客户端提供同一边界上的快照和增量。 */
export class SessionEventHub {
  private readonly listeners = new Map<string, Set<(event: SessionEvent) => void>>();
  private readonly views = new SessionViewCache();
  private readonly parents = new Map<string, { parentId: string; cwd: string }>();

  /** 通过导航索引校验任务，并定位连接级事件应通知的订阅。 */
  constructor(
    private readonly projectPath: (taskId: string) => string,
    private readonly binding: (taskId: string) => DesignBinding | undefined = () => undefined,
  ) {}

  /** 以新建或恢复返回的原生历史建立展示副本。 */
  seed(thread: unknown): void {
    this.views.seed(thread);
  }
  /** 在同步边界读取快照，边界后的事件进入订阅队列。 */
  async *subscribe(
    taskId: string,
    signal: AbortSignal,
    loadClient: () => Promise<{ pendingRequests(): readonly PendingRequest[] }>,
  ): AsyncIterable<SessionEvent | undefined> {
    this.projectPath(taskId);
    const queue = new SessionEventQueue();
    let ready = false;
    const listener = (event: SessionEvent) => {
      if (ready) queue.push(event);
    };
    const listeners = this.listeners.get(taskId) ?? new Set();
    this.listeners.set(taskId, listeners);
    listeners.add(listener);
    try {
      const client = await loadClient();
      const pendingRequests = client
        .pendingRequests()
        .filter((pending) => this.requestBelongsTo(pending, taskId));
      const view = this.views.read(taskId);
      // JavaScript 在这里不会让出执行权：之前的事件已经进入 view，之后的事件进入 queue。
      ready = true;
      const snapshot = sessionSnapshotSchema.parse({
        thread: view.snapshot.thread,
        pendingRequests,
        ...(this.binding(taskId) ? { designBinding: this.binding(taskId) } : {}),
      });
      yield { type: "snapshot", snapshot };
      for (const notification of view.activities) {
        if (signal.aborted) return;
        yield { type: "notification", notification };
      }
      while (!signal.aborted) {
        const event = await queue.next(signal);
        if (signal.aborted) break;
        yield event;
        if (event?.type === "close") break;
      }
    } finally {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(taskId);
    }
  }
  /** 启动响应只补入缺失轮次；检查和发布同步完成，不覆盖或重播已收到的通知。 */
  publishTurnStart(taskId: string, value: unknown): void {
    const turn = nativeTurnSchema.parse(value);
    const { snapshot } = this.views.read(taskId);
    if (snapshot.thread.turns.some((entry) => entry.id === turn.id)) return;
    this.publish(taskId, {
      type: "notification",
      notification: { method: "turn/started", params: { threadId: taskId, turn } },
    });
  }
  /** 先更新原生展示副本，再向当前订阅转发事件。 */
  publish(taskId: string, event: SessionEvent): void {
    this.views.apply(taskId, event);
    for (const listener of this.listeners.get(taskId) ?? []) listener(event);
  }
  /** 将子线程请求关联到所属 ui-forge 任务，保留其原生 thread ID。 */
  private rootTask(threadId: string): string {
    const seen = new Set<string>();
    let id = threadId;
    while (this.parents.has(id) && !seen.has(id)) {
      seen.add(id);
      id = this.parents.get(id)!.parentId;
    }
    return id;
  }
  /** 当前请求必须属于主线程或其原生子线程。 */
  requestBelongsTo(pending: PendingRequest, taskId: string): boolean {
    const id = eventThreadId(pending.request.params);
    return id !== undefined && this.rootTask(id) === taskId;
  }
  /** 记录原生父子关联，只广播所属连接的消息。 */
  onEvent(cwd: string, native: CodexEvent, affectedTasks?: ReadonlySet<string>): void {
    if (native.type === "notification" && native.notification.method === "thread/started") {
      const thread = native.notification.params.thread;
      if (thread.parentThreadId)
        this.parents.set(thread.id, { parentId: thread.parentThreadId, cwd });
      else if (
        typeof thread.source === "object" &&
        "subAgent" in thread.source &&
        typeof thread.source.subAgent === "object" &&
        "thread_spawn" in thread.source.subAgent
      )
        this.parents.set(thread.id, {
          parentId: thread.source.subAgent.thread_spawn.parent_thread_id,
          cwd,
        });
    }
    const event = toSessionEvent(native);
    if (!event) return;
    const threadId =
      native.type === "notification" || native.type === "unknownNotification"
        ? eventThreadId(native.notification.params)
        : native.type === "request"
          ? eventThreadId(native.request.params)
          : undefined;
    if (threadId) {
      this.publish(this.rootTask(threadId), event);
      return;
    }
    if (event.type === "request") return;
    if (event.type === "close") {
      if (affectedTasks) {
        this.views.removeTasks(affectedTasks);
        const children = [...this.parents.keys()].filter((id) =>
          affectedTasks.has(this.rootTask(id)),
        );
        for (const id of children) this.parents.delete(id);
      } else {
        this.views.removeWorkspace(cwd);
        for (const [id, parent] of this.parents) if (parent.cwd === cwd) this.parents.delete(id);
      }
    }
    for (const id of this.listeners.keys())
      if (this.projectPath(id) === cwd && (!affectedTasks || affectedTasks.has(id)))
        this.publish(id, event);
  }
}
