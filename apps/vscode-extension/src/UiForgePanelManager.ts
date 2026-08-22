/** 管理编辑器主区域中的 UiForge Webview Panel 及其宿主通信。 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  cancelCommunicationStreamInputSchema,
  communicationInboundMessageSchema,
  communicationResponseMessageSchema,
  communicationStreamMessageSchema,
  communicationTransportMethods,
  createFailedCommunicationResponseMessage,
  createCommunicationStreamErrorMessage,
  d2cWorkflowMethods,
} from "@ui-forge/shared-protocol";
import * as vscode from "vscode";

/** 创建、复用并驱动编辑器主区域中的 UiForge Webview。 */
export class UiForgePanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private readonly activeStreamControllers = new Map<string, AbortController>();

  /** 保存 Extension 根目录，用于解析构建后的 Webview 静态资源。 */
  constructor(private readonly extensionUri: vscode.Uri) {}

  /** 打开或聚焦 UiForge 主视图，不主动改变当前 Webview 页面。 */
  async open(): Promise<void> {
    await this.resolvePanel();
  }

  /** 打开主视图，并直接以任务设置路由初始化 Webview。 */
  async openTaskSetup(): Promise<void> {
    await this.resolvePanel("#/task-workflow");
  }

  /** 复用现有 Panel，或按指定初始路由创建并加载主视图 Panel。 */
  private async resolvePanel(initialHash?: string): Promise<vscode.WebviewPanel> {
    const webviewRoot = vscode.Uri.joinPath(
      this.extensionUri,
      "..",
      "agent-webview",
      "dist",
    );
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      if (initialHash) {
        this.panel.webview.html = await this.loadWebviewHtml(
          this.panel.webview,
          webviewRoot,
          initialHash,
        );
      }
      return this.panel;
    }

    const panel = vscode.window.createWebviewPanel(
      "ui-forge.agent",
      "ui-forge",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewRoot],
      },
    );
    this.panel = panel;
    panel.onDidDispose(() => {
      for (const controller of this.activeStreamControllers.values()) controller.abort();
      this.activeStreamControllers.clear();
      this.panel = undefined;
    });

    const serverEndpoint = `${process.env.UI_FORGE_SERVER_URL ?? "http://127.0.0.1:4310"}/api/communication`;
    panel.webview.onDidReceiveMessage((message: unknown) => this.forwardCommunicationInput(
      panel.webview,
      serverEndpoint,
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      message,
    ));
    panel.webview.html = await this.loadWebviewHtml(panel.webview, webviewRoot, initialHash);
    return panel;
  }

  /** 校验 Webview 输入，并将合法通信消息转发给 Agent Server。 */
  private async forwardCommunicationInput(
    webview: vscode.Webview,
    serverEndpoint: string,
    projectPath: string | undefined,
    input: unknown,
  ): Promise<void> {
    const messageResult = communicationInboundMessageSchema.safeParse(input);
    if (!messageResult.success) return;
    await this.forwardCommunicationMessage(webview, serverEndpoint, projectPath, messageResult.data);
  }

  /** 读取 Webview HTML，并注入资源地址、CSP 和可选的初始 hash 路由。 */
  private async loadWebviewHtml(
    webview: vscode.Webview,
    webviewRoot: vscode.Uri,
    initialHash?: string,
  ): Promise<string> {
    try {
      const indexUri = vscode.Uri.joinPath(webviewRoot, "index.html");
      const html = await readFile(indexUri.fsPath, "utf8");
      const baseUri = webview.asWebviewUri(webviewRoot).toString();
      const nonce = randomBytes(16).toString("base64");
      const initialRouteScript = initialHash
        ? `<script nonce="${nonce}">window.location.hash=${JSON.stringify(initialHash)};</script>`
        : "";

      return html
        .replace("<head>", `<head><base href="${baseUri}/">`)
        .replace(
          "<meta charset=\"UTF-8\" />",
          `<meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource};">${initialRouteScript}`,
        );
    } catch {
      return "<!doctype html><html><body><p>Webview 尚未构建，请先在仓库根目录运行 npm run build。</p></body></html>";
    }
  }

  /** 将已校验消息补入宿主上下文并转发给 Agent Server。 */
  private async forwardCommunicationMessage(
    webview: vscode.Webview,
    serverEndpoint: string,
    projectPath: string | undefined,
    message: ReturnType<typeof communicationInboundMessageSchema.parse>,
  ): Promise<void> {
    if (message.kind === "notification"
      && message.method === communicationTransportMethods.cancelStream) {
      const inputResult = cancelCommunicationStreamInputSchema.safeParse(message.params);
      if (!inputResult.success) return;
      this.activeStreamControllers.get(inputResult.data.requestId)?.abort();
      this.activeStreamControllers.delete(inputResult.data.requestId);
      return;
    }

    const forwardedMessage = message.kind === "request"
      && message.method === d2cWorkflowMethods.initialize
      && projectPath
      ? { ...message, params: { projectPath } }
      : message;

    if (forwardedMessage.kind === "stream-request") {
      await this.forwardStreamCommunicationMessage(
        webview,
        serverEndpoint,
        forwardedMessage,
      );
      return;
    }

    try {
      const response = await fetch(serverEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(forwardedMessage),
      });
      if (message.kind === "notification") return;
      if (!response.ok) throw new Error(`Agent Server 返回 ${response.status}。`);
      const responseMessage = communicationResponseMessageSchema.parse(await response.json());
      await webview.postMessage(responseMessage);
    } catch (error: unknown) {
      if (message.kind === "notification") return;
      const errorMessage = error instanceof Error ? error.message : "Agent Server 通信失败。";
      await webview.postMessage(createFailedCommunicationResponseMessage(message.requestId, errorMessage));
    }
  }

  /** 转发 NDJSON 流，并在每条信封通过关联与顺序校验后立即发送到 Webview。 */
  private async forwardStreamCommunicationMessage(
    webview: vscode.Webview,
    serverEndpoint: string,
    message: Extract<ReturnType<typeof communicationInboundMessageSchema.parse>, { kind: "stream-request" }>,
  ): Promise<void> {
    let lastSeq = 0;
    const controller = new AbortController();
    this.activeStreamControllers.get(message.requestId)?.abort();
    this.activeStreamControllers.set(message.requestId, controller);
    try {
      const response = await fetch(serverEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Agent Server 返回 ${response.status}。`);
      if (!response.body) throw new Error("Agent Server 没有返回流式响应体。");
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      /** 校验并转发单行流信封。 */
      const forwardLine = async (line: string): Promise<void> => {
        if (!line.trim()) return;
        const streamMessage = communicationStreamMessageSchema.parse(JSON.parse(line));
        if (streamMessage.requestId !== message.requestId) {
          throw new Error("Agent Server 流关联标识不匹配。");
        }
        if (streamMessage.seq !== lastSeq + 1) {
          throw new Error("Agent Server 流事件顺序无效。");
        }
        lastSeq = streamMessage.seq;
        finished = streamMessage.kind === "stream-complete"
          || streamMessage.kind === "stream-error";
        await webview.postMessage(streamMessage);
      };

      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          await forwardLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
      }
      buffer += decoder.decode();
      await forwardLine(buffer);
      if (!finished) throw new Error("Agent Server 流在完成消息前结束。");
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      const errorMessage = error instanceof Error ? error.message : "Agent Server 流式通信失败。";
      await webview.postMessage(createCommunicationStreamErrorMessage(
        message.requestId,
        lastSeq + 1,
        errorMessage,
      ));
    } finally {
      if (this.activeStreamControllers.get(message.requestId) === controller) {
        this.activeStreamControllers.delete(message.requestId);
      }
    }
  }
}
