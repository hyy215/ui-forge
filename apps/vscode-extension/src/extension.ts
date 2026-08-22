/** 注册 UiForge 侧边栏视图及其任务入口命令。 */
import * as vscode from "vscode";
import { UiForgePanelManager } from "./UiForgePanelManager.js";
import { UiForgeSidebarProvider } from "./UiForgeSidebarProvider.js";

/** 激活 Extension，注册侧边栏 Webview 和创建任务命令。 */
export function activate(context: vscode.ExtensionContext) {
  const panelManager = new UiForgePanelManager(context.extensionUri);
  const sidebarProvider = new UiForgeSidebarProvider();

  context.subscriptions.push(
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
  );
}

/** VS Code 停用 Extension 时无需额外处理。 */
export function deactivate() {}
