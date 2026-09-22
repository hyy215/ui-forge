/** 复用客户端展示归并生成重连快照；缓存不参与 start、steer 或 interrupt 决策。 */
import {
  applySessionEvent,
  emptyPresentation,
  type SessionPresentation,
} from "@ui-forge/client-core";
import { nativeThreadSchema, type SessionEvent } from "@ui-forge/shared-protocol";

/** 保存会话展示副本及历史之外的活动，审批执行依据仍来自 Codex。 */
export class SessionViewCache {
  private readonly views = new Map<string, SessionPresentation>();

  /** 以新建或恢复返回的原生历史开始接收增量。 */
  seed(thread: unknown): void {
    const parsed = nativeThreadSchema.parse(thread);
    this.views.set(
      parsed.id,
      applySessionEvent(emptyPresentation(), {
        type: "snapshot",
        snapshot: { thread: parsed, pendingRequests: [] },
      }),
    );
  }

  /** 同步复制同一事件边界上的历史、活动与展示请求。 */
  read(
    taskId: string,
  ): SessionPresentation & { snapshot: NonNullable<SessionPresentation["snapshot"]> } {
    const view = this.views.get(taskId);
    if (!view?.snapshot) throw new Error("会话历史尚未加载。");
    return structuredClone({ ...view, snapshot: view.snapshot });
  }

  /** 连接关闭后清理该工作区展示副本，下次装载重新读取原生历史。 */
  removeWorkspace(cwd: string): void {
    for (const [id, view] of this.views)
      if (view.snapshot?.thread.cwd === cwd) this.views.delete(id);
  }

  /** 隔离连接关闭只清理该连接装载过的任务，不影响同目录的其他设计来源。 */
  removeTasks(taskIds: ReadonlySet<string>): void {
    for (const taskId of taskIds) this.views.delete(taskId);
  }

  /** 使用与页面相同的归并规则，并为待审批子任务保留必要的补丁预览。 */
  apply(taskId: string, event: SessionEvent): void {
    const view = this.views.get(taskId);
    if (view) this.views.set(taskId, applySessionEvent(view, event));
  }
}
