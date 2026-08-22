/** 为 UiForge 侧边栏提供暂时为空的任务管理内容。 */
import * as vscode from "vscode";

/** 提供 UiForge 原生侧边栏结构，后续可在此接入任务列表。 */
export class UiForgeSidebarProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  /** VS Code 清单中注册的稳定侧边栏视图标识。 */
  static readonly viewType = "ui-forge.sidebar";

  /** 返回 VS Code 要求的原生树节点。 */
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  /** 当前不展示任务内容，因此返回空的根节点集合。 */
  getChildren(_element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    return [];
  }
}
