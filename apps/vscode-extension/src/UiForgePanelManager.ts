/** 承载 Webview 并转发真实会话消息，关闭页面只清理传输订阅。 */
import { randomBytes, randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import * as vscode from "vscode";
import {
  communicationInboundMessageSchema,
  communicationResponseMessageSchema,
  communicationTransportMethods,
  cancelCommunicationStreamInputSchema,
  createCommunicationRequestMessage,
  createFailedCommunicationResponseMessage,
  createCommunicationStreamErrorMessage,
  sessionMethods,
  sessionFileMethods,
  sessionFileInputSchema,
  sessionFileSchema,
  type CommunicationInboundMessage,
} from "@ui-forge/shared-protocol";
import { readCommunicationStream } from "@ui-forge/client-core";
import {
  authorizeHostRequest,
  requiresWorkspaceTrust,
  type HostWorkspace,
} from "./hostRequestPolicy.js";

/** 复制当前授权上下文，避免异步校验复用已变化的工作区对象。 */
function currentWorkspace(): HostWorkspace {
  const projectPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return { trusted: vscode.workspace.isTrusted, ...(projectPath ? { projectPath } : {}) };
}

/** 每个页面独立持有订阅，避免不同 Webview 使用相同请求标识时相互取消。 */
interface PanelState {
  panel: vscode.WebviewPanel;
  streams: Map<string, AbortController>;
}

/** 管理页面资源、严格关联的转发和当前工作区授权。 */
export class UiForgePanelManager {
  private readonly panels = new Map<"conversation" | "settings", PanelState>();
  /** 绑定已构建页面位置、当前窗口固定的通信端点及历史刷新回调。 */
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly endpoint: string,
    private readonly historyChanged?: () => void,
  ) {}
  /** 停用扩展只断开浏览器消息流。 */
  dispose(): void {
    for (const state of this.panels.values()) {
      this.cancelStreams(state);
      state.panel.dispose();
    }
    this.panels.clear();
  }
  /** 打开已有面板或首页。 */
  async open(): Promise<void> {
    await this.openPanel();
  }
  /** 打开或聚焦独立配置面板，保留对话和配置中尚未保存的输入。 */
  async openSettings(): Promise<void> {
    await this.openPanel("#/settings");
  }
  /** 创建任务入口不在导航时执行模型。 */
  async openTaskSetup(): Promise<void> {
    await this.openPanel("#/tasks");
  }
  /** 原任务继续入口只打开会话，用户从同一输入框继续。 */
  async openHistoryTask(taskId: string, _continueRequested = false): Promise<void> {
    if (!taskId || taskId.length > 200) throw new Error("任务标识无效。");
    await this.openPanel(`#/tasks?taskId=${encodeURIComponent(taskId)}`);
  }
  /** 配置与对话使用独立标签页；只有显式切换任务才重建对话页面。 */
  private async openPanel(hash?: string): Promise<void> {
    let root = vscode.Uri.joinPath(this.extensionUri, "webview");
    try {
      await access(vscode.Uri.joinPath(root, "index.html").fsPath);
    } catch {
      root = vscode.Uri.joinPath(this.extensionUri, "..", "agent-webview", "dist");
    }
    const kind = hash === "#/settings" ? "settings" : "conversation";
    let state = this.panels.get(kind);
    if (!state) {
      const panel = vscode.window.createWebviewPanel(
        kind === "settings" ? "ui-forge.settings" : "ui-forge.agent",
        kind === "settings" ? "ui-forge · 规则配置" : "ui-forge",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [root],
          enableCommandUris: ["ui-forge.openSettings", "ui-forge.open"],
        },
      );
      const created: PanelState = { panel, streams: new Map() };
      state = created;
      this.panels.set(kind, created);
      panel.onDidDispose(() => {
        this.cancelStreams(created);
        if (this.panels.get(kind) === created) this.panels.delete(kind);
      });
      panel.webview.onDidReceiveMessage((input: unknown) => {
        const parsed = communicationInboundMessageSchema.safeParse(input);
        if (parsed.success) void this.forward(created, parsed.data);
      });
    } else {
      state.panel.reveal(vscode.ViewColumn.One);
      if (!hash || kind === "settings") return;
      this.cancelStreams(state);
    }
    const webview = state.panel.webview;
    try {
      const nonce = randomBytes(16).toString("base64");
      const html = await readFile(vscode.Uri.joinPath(root, "index.html").fsPath, "utf8");
      const context = JSON.stringify({
        projectPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      }).replaceAll("<", "\\u003c");
      const route = JSON.stringify(hash ?? "#/").replaceAll("<", "\\u003c");
      webview.html = html
        .replace("<head>", `<head><base href="${webview.asWebviewUri(root)}/">`)
        .replace(
          '<meta charset="UTF-8" />',
          `<meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource};"><script nonce="${nonce}">window.uiForgeHost=${context};window.location.hash=${route};</script>`,
        );
    } catch {
      webview.html =
        "<!doctype html><html><body><p>Webview 尚未构建，请运行 npm run build。</p></body></html>";
    }
  }
  /** 在关闭或导航时终止网络订阅，不向 Server 发送 turn/interrupt。 */
  private cancelStreams(state: PanelState): void {
    for (const controller of state.streams.values()) controller.abort();
    state.streams.clear();
  }
  /** 向固定端点发出有界请求。 */
  private async readTask(taskId: string): Promise<unknown> {
    const requestId = randomUUID();
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        createCommunicationRequestMessage(requestId, sessionMethods.read, { taskId }),
      ),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = communicationResponseMessageSchema.parse(await response.json());
    if (result.requestId !== requestId) throw new Error("会话响应身份无效。");
    if (!result.success) throw new Error(result.error.message);
    return result.data;
  }
  /** 校验请求、授权并逐条转发原生消息信封。 */
  private async forward(
    { panel: { webview }, streams }: PanelState,
    original: CommunicationInboundMessage,
  ): Promise<void> {
    if (original.kind === "notification") {
      if (original.method === communicationTransportMethods.cancelStream) {
        const input = cancelCommunicationStreamInputSchema.safeParse(original.params);
        if (input.success) streams.get(input.data.requestId)?.abort();
      }
      return;
    }
    const controller = new AbortController();
    let seq = 0;
    try {
      const workspace = currentWorkspace();
      if (original.method === sessionFileMethods.open)
        sessionFileInputSchema.parse(original.params);
      const message =
        original.kind === "request"
          ? await authorizeHostRequest(original, workspace, (taskId) => this.readTask(taskId))
          : original;
      if (message.kind === "request" && requiresWorkspaceTrust(message.method)) {
        const current = currentWorkspace();
        if (current.trusted !== workspace.trusted || current.projectPath !== workspace.projectPath)
          throw new Error("工作区或信任状态已变化，请确认当前工作区后重新操作。");
      }
      if (message.kind === "stream-request") {
        streams.get(message.requestId)?.abort();
        streams.set(message.requestId, controller);
      }
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
        signal:
          message.kind === "stream-request" ? controller.signal : AbortSignal.timeout(180_000),
      });
      if (!response.ok) throw new Error(`Agent Server HTTP ${response.status}`);
      if (message.kind === "request") {
        const result = communicationResponseMessageSchema.parse(await response.json());
        if (result.requestId !== message.requestId) throw new Error("响应标识无效。");
        if (result.success && message.method === sessionFileMethods.open) {
          const file = sessionFileSchema.parse(result.data);
          await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file.path), {
            preview: true,
            ...(file.line
              ? {
                  selection: new vscode.Range(
                    file.line - 1,
                    (file.column ?? 1) - 1,
                    file.line - 1,
                    (file.column ?? 1) - 1,
                  ),
                }
              : {}),
          });
        }
        await webview.postMessage(result);
        if (
          result.success &&
          [sessionMethods.create, sessionMethods.send].some((method) => method === message.method)
        )
          this.historyChanged?.();
        return;
      }
      if (!response.body) throw new Error("会话没有响应流。");
      for await (const event of readCommunicationStream(
        response.body,
        message.requestId,
        controller.signal,
      )) {
        seq = event.seq;
        await webview.postMessage(event);
      }
    } catch (error) {
      if (!controller.signal.aborted)
        await webview.postMessage(
          original.kind === "stream-request"
            ? createCommunicationStreamErrorMessage(
                original.requestId,
                seq + 1,
                error instanceof Error ? error.message : "通信失败",
              )
            : createFailedCommunicationResponseMessage(
                original.requestId,
                error instanceof Error ? error.message : "通信失败",
              ),
        );
    } finally {
      if (streams.get(original.requestId) === controller) streams.delete(original.requestId);
      controller.abort();
    }
  }
}
