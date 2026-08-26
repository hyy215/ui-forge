/** 注册 UiForge 侧边栏视图及其任务入口命令。 */
import * as vscode from "vscode";
import { UiForgePanelManager } from "./UiForgePanelManager.js";
import { createUiForgeServerTaskClient } from "./UiForgeServerTaskClient.js";
import { UiForgeSidebarProvider } from "./UiForgeSidebarProvider.js";

/** 激活 Extension，注册 Workspace 任务树及其打开、重命名、归档和删除命令。 */
export function activate(context: vscode.ExtensionContext) {
  const getProjectPath = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const serverEndpoint = `${process.env.UI_FORGE_SERVER_URL ?? "http://127.0.0.1:4310"}/api/communication`;
  const taskClient = createUiForgeServerTaskClient({ endpoint: serverEndpoint, getProjectPath });
  const sidebarProvider = new UiForgeSidebarProvider(taskClient, getProjectPath);
  const panelManager = new UiForgePanelManager(context.extensionUri, () => sidebarProvider.refresh());

  /** 统一显示任务管理命令失败并刷新可能过期的 revision。 */
  async function runTaskOperation(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
      sidebarProvider.refresh();
    } catch (error: unknown) {
      sidebarProvider.refresh();
      await vscode.window.showErrorMessage(
        error instanceof Error ? error.message : "任务操作失败。",
      );
    }
  }

  context.subscriptions.push(
    sidebarProvider,
    vscode.window.registerTreeDataProvider(
      UiForgeSidebarProvider.viewType,
      sidebarProvider,
    ),
    vscode.commands.registerCommand("ui-forge.createTask", async () => {
      await panelManager.openTaskSetup();
    }),
    vscode.commands.registerCommand("ui-forge.open", async () => {
      await panelManager.open();
    }),
    vscode.commands.registerCommand("ui-forge.openTask", async (input: unknown) => {
      const task = sidebarProvider.resolveTask(input);
      if (task) await panelManager.openTask(task.taskId);
    }),
    vscode.commands.registerCommand("ui-forge.renameTask", async (input: unknown) => {
      const task = sidebarProvider.resolveTask(input);
      if (!task) return;
      const displayName = await vscode.window.showInputBox({
        title: "重命名 ui-forge 任务",
        value: task.displayName,
        prompt: "输入 1 到 120 个字符的任务名称",
        validateInput: (value) => {
          const length = value.trim().length;
          return length === 0 || length > 120 ? "任务名称必须位于 1 到 120 个字符之间。" : undefined;
        },
      });
      if (displayName === undefined || displayName.trim() === task.displayName) return;
      await runTaskOperation(() => taskClient.renameTask(task, displayName));
    }),
    vscode.commands.registerCommand("ui-forge.archiveTask", async (input: unknown) => {
      const task = sidebarProvider.resolveTask(input);
      if (task) await runTaskOperation(() => taskClient.archiveTask(task));
    }),
    vscode.commands.registerCommand("ui-forge.restoreTask", async (input: unknown) => {
      const task = sidebarProvider.resolveTask(input);
      if (task) await runTaskOperation(() => taskClient.restoreTask(task));
    }),
    vscode.commands.registerCommand("ui-forge.deleteTask", async (input: unknown) => {
      const task = sidebarProvider.resolveTask(input);
      if (!task) return;
      const confirmation = await vscode.window.showWarningMessage(
        `永久删除任务“${task.displayName}”？`,
        {
          modal: true,
          detail: "将删除任务及全部中间状态，且无法恢复。审计日志仍按既有保留策略保存。",
        },
        "删除",
      );
      if (confirmation !== "删除") return;
      await runTaskOperation(() => taskClient.deleteTask(task));
    }),
    vscode.commands.registerCommand("ui-forge.refreshTasks", () => sidebarProvider.refresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => sidebarProvider.refresh()),
  );
}

/** VS Code 停用 Extension 时无需额外处理。 */
export function deactivate() {}
