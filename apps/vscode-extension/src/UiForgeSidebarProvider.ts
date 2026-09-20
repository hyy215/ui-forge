/** Extension 原生侧边栏：按项目展示已运行任务，分页查询与刷新只更新展示缓存。 */
import * as vscode from "vscode";
import type { TaskHistoryEntry, TaskHistoryPage } from "@ui-forge/shared-protocol";

/** 原生树节点只持有展示与导航数据，权威状态来自 Server。 */
export type HistoryTreeNode =
  | { kind: "project"; path: string }
  | { kind: "task"; task: TaskHistoryEntry }
  | { kind: "more" }
  | { kind: "message"; text: string };
/** 管理有界轮询、分页和树刷新，关闭扩展后停止请求。 */
export class UiForgeSidebarProvider
  implements vscode.TreeDataProvider<HistoryTreeNode>, vscode.Disposable
{
  /** 与扩展清单一致的侧边栏标识。 */
  static readonly viewType = "ui-forge.sidebar";
  private readonly changed = new vscode.EventEmitter<HistoryTreeNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly entries = new Map<string, TaskHistoryEntry>();
  private nextOffset: number | null = null;
  private pending: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly controller = new AbortController();
  private error: string | undefined;
  private visible = false;
  private loaded = false;

  /** 注入查询能力；构造时不启动后台请求。 */
  constructor(
    private readonly query: (offset: number, signal: AbortSignal) => Promise<TaskHistoryPage>,
  ) {}
  /** 仅在侧边栏可见时刷新，保留服务不可用时的历史展示。 */
  setVisible(visible: boolean): void {
    this.visible = visible;
    clearTimeout(this.timer);
    if (visible) void this.refresh();
  }
  /** 停用扩展后取消查询、计时器和事件订阅。 */
  dispose(): void {
    this.controller.abort();
    clearTimeout(this.timer);
    this.changed.dispose();
  }
  /** 合并最新一页，实时任务不改变其他分页条目的身份。 */
  refresh(): Promise<void> {
    return this.load(0);
  }
  /** 请求明确的下一页，避免一次加载全部任务正文。 */
  loadMore(): Promise<void> {
    return this.nextOffset === null ? Promise.resolve() : this.load(this.nextOffset);
  }
  /** 将领域摘要转成 VS Code TreeItem，不将设计文本解释为命令或 Markdown。 */
  getTreeItem(node: HistoryTreeNode): vscode.TreeItem {
    if (node.kind === "project") {
      const name = node.path.split(/[\\/]/).filter(Boolean).at(-1) ?? "未绑定项目";
      const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `project:${node.path}`;
      item.tooltip = node.path;
      item.description = node.path;
      item.iconPath = new vscode.ThemeIcon("folder");
      return item;
    }
    if (node.kind === "task") {
      const task = node.task;
      const item = new vscode.TreeItem(task.title, vscode.TreeItemCollapsibleState.None);
      item.id = task.taskId;
      item.contextValue = "historyTask";
      item.description = new Date(task.updatedAt).toLocaleString();
      item.tooltip = `${task.title}\n${task.projectPath}`;
      item.iconPath = new vscode.ThemeIcon("comment-discussion");
      item.command = { command: "ui-forge.openHistoryTask", title: "打开任务", arguments: [task] };
      return item;
    }
    const item = new vscode.TreeItem(node.kind === "more" ? "加载更多任务…" : node.text);
    if (node.kind === "more")
      item.command = { command: "ui-forge.loadMoreTasks", title: "加载更多任务" };
    return item;
  }
  /** 按项目归组，项目与任务均按最近更新时间排序。 */
  getChildren(node?: HistoryTreeNode): HistoryTreeNode[] {
    const tasks = [...this.entries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (node?.kind === "project")
      return tasks
        .filter((task) => task.projectPath === node.path)
        .map((task) => ({ kind: "task", task }));
    if (node) return [];
    const roots: HistoryTreeNode[] = [...new Set(tasks.map((task) => task.projectPath))].map(
      (path) => ({ kind: "project", path }),
    );
    if (this.error) roots.push({ kind: "message", text: `历史暂不可用：${this.error}` });
    else if (!tasks.length)
      roots.push({
        kind: "message",
        text: this.loaded ? "暂无历史任务，点击 + 创建任务" : "正在读取历史任务…",
      });
    if (this.nextOffset !== null) roots.push({ kind: "more" });
    return roots;
  }
  /** 串行查询避免刷新覆盖分页游标；失败可在后续刷新中恢复。 */
  private load(offset: number): Promise<void> {
    if (this.controller.signal.aborted) return Promise.resolve();
    if (this.pending) return this.pending;
    clearTimeout(this.timer);
    this.pending = this.query(offset, this.controller.signal)
      .then((page) => {
        for (const task of page.tasks) this.entries.set(task.taskId, task);
        if (offset > 0 || !this.loaded || (this.nextOffset === null && this.entries.size <= 30))
          this.nextOffset = page.nextOffset;
        this.error = undefined;
        this.loaded = true;
      })
      .catch((error: unknown) => {
        if (!this.controller.signal.aborted)
          this.error = error instanceof Error ? error.message : "查询失败";
      })
      .finally(() => {
        this.pending = undefined;
        if (!this.controller.signal.aborted) {
          this.changed.fire(undefined);
          if (this.visible)
            this.timer = setTimeout(
              () => {
                void this.refresh();
              },
              this.error ? 15000 : 5000,
            );
        }
      });
    return this.pending;
  }
}
