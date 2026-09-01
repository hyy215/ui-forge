/** 在 VS Code 原生侧边栏中展示可恢复、可管理的 Workspace 任务树。 */

import type { D2CTaskSummary } from "@ui-forge/shared-protocol";
import * as vscode from "vscode";
import type { UiForgeTaskClient } from "./UiForgeServerTaskClient.js";
import { loadTaskSummaryPages } from "./taskSummaryPageLoader.js";
import { groupTaskSummaries, type TaskTreeGroup } from "./taskTreeModel.js";

type TaskTreeElement =
  | { kind: "group"; group: TaskTreeGroup }
  | { kind: "task"; task: D2CTaskSummary }
  | { kind: "message"; label: string; icon: string };

/** 提供按处理语义分类的 Workspace 任务树及其刷新能力。 */
export class UiForgeSidebarProvider implements vscode.TreeDataProvider<TaskTreeElement>, vscode.Disposable {
  /** VS Code 清单中注册的稳定侧边栏视图标识。 */
  static readonly viewType = "ui-forge.sidebar";

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private tasks: D2CTaskSummary[] = [];
  private loading: Promise<void> | undefined;
  private loadError: string | undefined;
  private loadGeneration = 0;

  /** 通知 VS Code 任务树内容已经失效。 */
  readonly onDidChangeTreeData = this.changeEmitter.event;

  /** 保存任务客户端和当前 Workspace 路径解析器。 */
  constructor(
    private readonly taskClient: UiForgeTaskClient,
    private readonly getProjectPath: () => string | undefined,
  ) {}

  /** 释放侧边栏事件资源。 */
  dispose(): void {
    this.changeEmitter.dispose();
  }

  /** 清除缓存并重新读取持久化任务摘要。 */
  refresh(): void {
    this.loadGeneration += 1;
    this.tasks = [];
    this.loading = undefined;
    this.loadError = undefined;
    this.changeEmitter.fire();
  }

  /** 从当前缓存定位命令要操作的任务摘要。 */
  getTask(taskId: string): D2CTaskSummary | undefined {
    return this.tasks.find((task) => task.taskId === taskId);
  }

  /** 解析命令传入的任务 ID 或原生树节点。 */
  resolveTask(input: unknown): D2CTaskSummary | undefined {
    if (typeof input === "string") return this.getTask(input);
    if (!input || typeof input !== "object" || !("task" in input)) return undefined;
    const task = (input as { task?: unknown }).task;
    if (!task || typeof task !== "object" || !("taskId" in task)) return undefined;
    const taskId = (task as { taskId?: unknown }).taskId;
    return typeof taskId === "string" ? this.getTask(taskId) : undefined;
  }

  /** 将业务树节点投影为 VS Code 原生 TreeItem。 */
  getTreeItem(element: TaskTreeElement): vscode.TreeItem {
    if (element.kind === "message") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(element.icon);
      return item;
    }
    if (element.kind === "group") {
      const item = new vscode.TreeItem(element.group.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(element.group.tasks.length);
      item.contextValue = "uiForgeTaskGroup";
      return item;
    }
    const item = new vscode.TreeItem(element.task.displayName, vscode.TreeItemCollapsibleState.None);
    item.id = element.task.taskId;
    item.description = element.task.nextAction;
    item.contextValue = element.task.archivedAt ? "uiForgeArchivedTask" : "uiForgeActiveTask";
    item.iconPath = new vscode.ThemeIcon(element.task.archivedAt ? "archive" : taskIcon(element.task));
    item.tooltip = createTaskTooltip(element.task);
    item.command = {
      command: "ui-forge.openTask",
      title: "打开任务",
      arguments: [element.task.taskId],
    };
    return item;
  }

  /** 读取根分组或指定分组内的任务节点。 */
  async getChildren(element?: TaskTreeElement): Promise<TaskTreeElement[]> {
    if (element?.kind === "group") {
      return element.group.tasks.map((task) => ({ kind: "task", task }));
    }
    if (element) return [];
    if (!this.getProjectPath()) {
      return [{ kind: "message", label: "请先打开项目文件夹", icon: "folder-opened" }];
    }
    await this.ensureTasksLoaded();
    if (this.loadError) {
      return [{ kind: "message", label: this.loadError, icon: "warning" }];
    }
    const groups = groupTaskSummaries(this.tasks);
    if (groups.length === 0) {
      return [{ kind: "message", label: "当前项目还没有任务", icon: "inbox" }];
    }
    return groups.map((group) => ({ kind: "group", group }));
  }

  /** 串行读取所有分页，避免 VS Code 并发刷新重复请求。 */
  private async ensureTasksLoaded(): Promise<void> {
    const generation = this.loadGeneration;
    this.loading ??= this.loadAllTasks(generation).catch((error: unknown) => {
      if (generation === this.loadGeneration) {
        this.loadError = error instanceof Error ? error.message : "任务列表加载失败。";
      }
    });
    await this.loading;
  }

  /** 遍历服务端不透明游标并保存完整摘要缓存。 */
  private async loadAllTasks(generation: number): Promise<void> {
    const tasks = await loadTaskSummaryPages(
      this.taskClient,
      () => generation === this.loadGeneration,
    );
    if (tasks && generation === this.loadGeneration) this.tasks = tasks;
  }
}

/** 按稳定业务阶段选择任务图标。 */
function taskIcon(task: D2CTaskSummary): string {
  if (task.attention === "required") return "bell-dot";
  if (task.attention === "completed") return "pass-filled";
  return "play-circle";
}

/** 创建不包含绝对路径或完整任务内容的任务提示。 */
function createTaskTooltip(task: D2CTaskSummary): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString(undefined, true);
  tooltip.appendMarkdown(`**${task.displayName}**\n\n`);
  tooltip.appendText(`下一步：${task.nextAction}\n`);
  tooltip.appendText(`最近更新：${new Date(task.updatedAt).toLocaleString()}`);
  if (task.blockingReason) tooltip.appendText(`\n阻塞原因：${task.blockingReason}`);
  return tooltip;
}
