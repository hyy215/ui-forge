import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import { join } from "node:path";
import {
  createCommunicationNotificationMessage,
  createCommunicationStreamRequestMessage,
  createCommunicationRequestMessage,
  createSuccessfulCommunicationResponseMessage,
  createFailedCommunicationResponseMessage,
  communicationTransportMethods,
  sessionMethods,
  sessionFileMethods,
} from "@ui-forge/shared-protocol";

interface TestPanel {
  webview: {
    html: string;
    cspSource: string;
    asWebviewUri: (uri: { fsPath: string }) => string;
    postMessage: Mock<() => Promise<boolean>>;
    onDidReceiveMessage: (callback: (input: unknown) => void) => void;
  };
  receive: (input: unknown) => void;
  onDidDispose: (callback: () => void) => void;
  dispose: Mock<() => void>;
  reveal: Mock<() => void>;
}

const host = vi.hoisted(() => ({
  panels: [] as TestPanel[],
  create: vi.fn(),
  openFile: vi.fn(async () => undefined),
  readHtml: vi.fn(async () => '<html><head><meta charset="UTF-8" /></head></html>'),
  access: vi.fn(),
}));

vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  readFile: host.readHtml,
  access: host.access,
}));
vi.mock("vscode", () => ({
  Uri: {
    joinPath: (uri: { fsPath: string }, ...parts: string[]) => ({
      fsPath: join(uri.fsPath, ...parts),
    }),
    file: (fsPath: string) => ({ scheme: "file", fsPath }),
  },
  Range: class {
    constructor(
      readonly startLine: number,
      readonly startColumn: number,
      readonly endLine: number,
      readonly endColumn: number,
    ) {}
  },
  commands: { executeCommand: host.openFile },
  ViewColumn: { One: 1 },
  workspace: { workspaceFolders: [], isTrusted: true },
  window: { createWebviewPanel: host.create },
}));

import { UiForgePanelManager } from "./UiForgePanelManager.js";
import * as vscode from "vscode";

let manager: UiForgePanelManager;
beforeEach(() => {
  host.panels.length = 0;
  host.create.mockClear();
  host.readHtml.mockClear();
  host.access.mockReset().mockResolvedValue(undefined);
  host.openFile.mockReset();
  host.create.mockImplementation(() => {
    let disposed: (() => void) | undefined;
    let received: ((input: unknown) => void) | undefined;
    const panel: TestPanel = {
      webview: {
        html: "",
        cspSource: "test-resource:",
        asWebviewUri: (uri) => uri.fsPath,
        postMessage: vi.fn(async () => true),
        onDidReceiveMessage: (callback) => {
          received = callback;
        },
      },
      receive: (input) => received?.(input),
      onDidDispose: (callback) => {
        disposed = callback;
      },
      dispose: vi.fn(() => disposed?.()),
      reveal: vi.fn(),
    };
    host.panels.push(panel);
    return panel;
  });
  manager = new UiForgePanelManager(
    vscode.Uri.joinPath({ fsPath: "/ui-forge/apps" } as vscode.Uri, "vscode-extension"),
    "http://127.0.0.1:5321/api/communication",
  );
});

it("opens resolved images and source line locations with VS Code's file editor", async () => {
  await manager.open();
  expect(host.readHtml).toHaveBeenCalledWith(
    "/ui-forge/apps/vscode-extension/webview/index.html",
    "utf8",
  );
  const panel = host.panels[0]!;
  const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
    const message = JSON.parse(String(init.body)) as { requestId: string };
    return Response.json(
      createSuccessfulCommunicationResponseMessage(
        message.requestId,
        message.requestId === "image"
          ? { path: "/ui-forge/runtime/screenshot.png" }
          : { path: "/target/App.tsx", line: 12, column: 3 },
      ),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  panel.receive(
    createCommunicationRequestMessage("image", sessionFileMethods.open, {
      taskId: "task",
      path: "/ui-forge/runtime/screenshot.png",
    }),
  );
  await vi.waitFor(() =>
    expect(host.openFile).toHaveBeenCalledWith(
      "vscode.open",
      { scheme: "file", fsPath: "/ui-forge/runtime/screenshot.png" },
      { preview: true },
    ),
  );
  panel.receive(
    createCommunicationRequestMessage("code", sessionFileMethods.open, {
      taskId: "task",
      path: "App.tsx:12:3",
    }),
  );
  await vi.waitFor(() =>
    expect(host.openFile).toHaveBeenCalledWith(
      "vscode.open",
      { scheme: "file", fsPath: "/target/App.tsx" },
      { preview: true, selection: expect.objectContaining({ startLine: 11, startColumn: 2 }) },
    ),
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    fetcher.mock.calls.every(([url]) => url === "http://127.0.0.1:5321/api/communication"),
  ).toBe(true);
});

it("uses the sibling Webview build when running from the source checkout", async () => {
  host.access.mockRejectedValueOnce(new Error("ENOENT"));
  await manager.open();
  expect(host.readHtml).toHaveBeenCalledWith(
    "/ui-forge/apps/agent-webview/dist/index.html",
    "utf8",
  );
});

it("reports rejected or failed file opens to the page and never opens an unvalidated path", async () => {
  await manager.open();
  const panel = host.panels[0]!;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(createFailedCommunicationResponseMessage("missing", "文件不存在")),
    ),
  );
  panel.receive(
    createCommunicationRequestMessage("missing", sessionFileMethods.open, {
      taskId: "task",
      path: "missing.md",
    }),
  );
  await vi.waitFor(() =>
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "missing", success: false }),
    ),
  );
  expect(host.openFile).not.toHaveBeenCalled();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        createSuccessfulCommunicationResponseMessage("failed", { path: "/target/report.md" }),
      ),
    ),
  );
  host.openFile.mockRejectedValueOnce(new Error("文件预览失败"));
  panel.receive(
    createCommunicationRequestMessage("failed", sessionFileMethods.open, {
      taskId: "task",
      path: "report.md",
    }),
  );
  await vi.waitFor(() =>
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "failed",
        success: false,
        error: expect.objectContaining({ message: "文件预览失败" }),
      }),
    ),
  );
});
afterEach(() => {
  manager.dispose();
  vi.unstubAllGlobals();
});

it("opens a separate settings editor and retains both pages when revealing them again", async () => {
  await manager.openHistoryTask("task-1");
  const conversation = host.panels[0]!;
  const conversationHtml = conversation.webview.html;
  await manager.openSettings();
  const settings = host.panels[1]!;
  expect(host.create.mock.calls.map((call) => call[0])).toEqual([
    "ui-forge.agent",
    "ui-forge.settings",
  ]);
  expect(settings.webview.html).toContain("#/settings");
  expect(conversation.webview.html).toBe(conversationHtml);
  // 模拟仍在内存中的页面内容，重复点击入口不能重建 HTML。
  settings.webview.html = "unsaved settings draft";
  await manager.openSettings();
  await manager.open();
  expect(host.create).toHaveBeenCalledTimes(2);
  expect(host.readHtml).toHaveBeenCalledTimes(2);
  expect(settings.webview.html).toBe("unsaved settings draft");
  expect(conversation.webview.html).toBe(conversationHtml);
  expect(settings.reveal).toHaveBeenCalled();
  expect(conversation.reveal).toHaveBeenCalled();
  expect(host.create.mock.calls[0]?.[3]).toMatchObject({
    enableCommandUris: ["ui-forge.openSettings", "ui-forge.open"],
  });
});

it("isolates streams with identical request ids when opening, cancelling and closing settings", async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal!;
          signals.push(signal);
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    ),
  );
  const message = createCommunicationStreamRequestMessage("same-id", sessionMethods.subscribe, {
    taskId: "task-1",
  });
  await manager.open();
  host.panels[0]!.receive(message);
  await manager.openSettings();
  expect(signals[0]?.aborted).toBe(false);
  host.panels[1]!.receive(message);
  expect(signals).toHaveLength(2);
  expect(signals[0]?.aborted).toBe(false);
  host.panels[1]!.receive(
    createCommunicationNotificationMessage(communicationTransportMethods.cancelStream, {
      requestId: "same-id",
    }),
  );
  expect(signals[1]?.aborted).toBe(true);
  expect(signals[0]?.aborted).toBe(false);
  host.panels[1]!.receive(message);
  expect(signals).toHaveLength(3);
  host.panels[1]!.dispose();
  expect(signals[2]?.aborted).toBe(true);
  expect(signals[0]?.aborted).toBe(false);
  manager.dispose();
  expect(signals[0]?.aborted).toBe(true);
});

it("navigates tasks without touching the open settings page and can reopen a closed settings tab", async () => {
  await manager.openSettings();
  const settings = host.panels[0]!;
  settings.webview.html = "draft";
  await manager.openTaskSetup();
  await manager.openHistoryTask("another-task");
  expect(settings.webview.html).toBe("draft");
  expect(host.panels[1]!.webview.html).toContain("another-task");
  settings.dispose();
  await manager.openSettings();
  expect(host.create).toHaveBeenCalledTimes(3);
  expect(host.panels[1]!.dispose).not.toHaveBeenCalled();
  expect(host.panels[2]!.webview.html).toContain("#/settings");
});
