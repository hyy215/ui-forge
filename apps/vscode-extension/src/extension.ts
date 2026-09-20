/** 注册 ui-forge 项目历史侧边栏、原任务导航和原工作区继续入口。 */
import * as vscode from "vscode";
import { taskHistoryEntrySchema } from "@ui-forge/shared-protocol";
import { UiForgePanelManager } from "./UiForgePanelManager.js";
import { UiForgeSidebarProvider } from "./UiForgeSidebarProvider.js";
import { TaskHistoryClient } from "./TaskHistoryClient.js";
import { resolveServerEndpoint } from "./serverEndpoint.js";

/** 激活侧边栏及主工作台，恢复跨工作区导航只保存任务标识。 */
export async function activate(context: vscode.ExtensionContext) {
  const setting = vscode.workspace
    .getConfiguration("ui-forge")
    .inspect<unknown>("serverUrl")?.globalValue;
  const endpoint = resolveServerEndpoint(setting, process.env.UI_FORGE_SERVER_URL);
  const client = new TaskHistoryClient(endpoint);
  const sidebarProvider = new UiForgeSidebarProvider((offset, signal) =>
    client.list(offset, signal),
  );
  const panelManager = new UiForgePanelManager(context.extensionUri, endpoint, () => {
    void sidebarProvider.refresh();
  });
  const tree = vscode.window.createTreeView(UiForgeSidebarProvider.viewType, {
    treeDataProvider: sidebarProvider,
  });
  const pendingKey = "uiForge.pendingHistoryTask";
  /** 校验树命令参数；跨工作区继续时由 VS Code 打开正确的项目。 */
  const openTask = async (input: unknown, continueRequested: boolean) => {
    const value =
      input &&
      typeof input === "object" &&
      "kind" in input &&
      input.kind === "task" &&
      "task" in input
        ? input.task
        : input;
    const task = taskHistoryEntrySchema.parse(value);
    if (
      continueRequested &&
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath !== task.projectPath
    ) {
      if (!task.projectPath) throw new Error("历史任务没有绑定项目目录。");
      await context.globalState.update(pendingKey, {
        taskId: task.taskId,
        projectPath: task.projectPath,
      });
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(task.projectPath), {
        forceNewWindow: true,
      });
      return;
    }
    await panelManager.openHistoryTask(task.taskId, continueRequested);
  };
  context.subscriptions.push(
    panelManager,
    sidebarProvider,
    tree,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("ui-forge.serverUrl")) return;
      void vscode.window
        .showInformationMessage(
          "ui-forge 后端地址已修改，重新加载窗口后生效。请先保存未提交的输入。",
          "重新加载窗口",
        )
        .then((action) => {
          if (action) void vscode.commands.executeCommand("workbench.action.reloadWindow");
        });
    }),
    tree.onDidChangeVisibility((event) => sidebarProvider.setVisible(event.visible)),
    vscode.commands.registerCommand("ui-forge.refreshHistory", () => sidebarProvider.refresh()),
    vscode.commands.registerCommand("ui-forge.loadMoreTasks", () => sidebarProvider.loadMore()),
    vscode.commands.registerCommand("ui-forge.openHistoryTask", (input: unknown) =>
      openTask(input, false),
    ),
    vscode.commands.registerCommand("ui-forge.continueTask", (input: unknown) =>
      openTask(input, true),
    ),
    vscode.commands.registerCommand("ui-forge.createTask", () => panelManager.openTaskSetup()),
    vscode.commands.registerCommand("ui-forge.openSettings", () => panelManager.openSettings()),
    vscode.commands.registerCommand("ui-forge.open", () => panelManager.open()),
  );
  sidebarProvider.setVisible(tree.visible);
  const pending = context.globalState.get<unknown>(pendingKey);
  if (
    pending &&
    typeof pending === "object" &&
    "taskId" in pending &&
    typeof pending.taskId === "string" &&
    "projectPath" in pending &&
    pending.projectPath === vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  ) {
    await context.globalState.update(pendingKey, undefined);
    await panelManager.openHistoryTask(pending.taskId, true);
  }
}

/** 所有资源由 ExtensionContext subscriptions 回收。 */
export function deactivate() {}
