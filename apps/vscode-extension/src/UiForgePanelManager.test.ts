import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  communicationInboundMessageSchema,
  communicationRequestMessageSchema,
  createCommunicationNotificationMessage,
  createCommunicationStreamRequestMessage,
  createCommunicationRequestMessage,
  createSuccessfulCommunicationResponseMessage,
  createFailedCommunicationResponseMessage,
  communicationTransportMethods,
  sessionMethods,
  sessionFileMethods,
  diagnosticMethods,
  deliveryMethods,
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
  realpath: vi.fn<(path: string) => Promise<string>>(),
  workspace: { trusted: true, projectPath: undefined as string | undefined },
}));

vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  readFile: host.readHtml,
  access: host.access,
  realpath: host.realpath,
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
  workspace: {
    get workspaceFolders() {
      return host.workspace.projectPath ? [{ uri: { fsPath: host.workspace.projectPath } }] : [];
    },
    get isTrusted() {
      return host.workspace.trusted;
    },
  },
  window: { createWebviewPanel: host.create },
}));

import { UiForgePanelManager } from "./UiForgePanelManager.js";
import * as vscode from "vscode";

let manager: UiForgePanelManager;

const taskOperations = [
  { method: sessionMethods.send, params: { taskId: "task", text: "change" } },
  { method: sessionMethods.stop, params: { taskId: "task", turnId: "turn" } },
  {
    method: sessionMethods.respond,
    params: { taskId: "task", token: "approval-token", result: { decision: "decline" } },
  },
] as const;

const workspaceChanges = [
  {
    change: "switches directory",
    apply: () => {
      host.workspace.projectPath = "/";
    },
  },
  {
    change: "removes the workspace",
    apply: () => {
      host.workspace.projectPath = undefined;
    },
  },
  {
    change: "revokes trust",
    apply: () => {
      host.workspace.trusted = false;
    },
  },
] as const;

function taskSnapshot(taskId = "task") {
  return {
    thread: {
      id: taskId,
      cwd: tmpdir(),
      name: null,
      preview: "task",
      createdAt: 1,
      updatedAt: 1,
      status: { type: "idle" },
      turns: [],
    },
    pendingRequests: [],
  };
}

function deferredRead() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

beforeEach(async () => {
  const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  host.panels.length = 0;
  host.create.mockClear();
  host.readHtml.mockClear();
  host.access.mockReset().mockResolvedValue(undefined);
  host.openFile.mockReset();
  host.realpath.mockReset().mockImplementation((path) => fs.realpath(path));
  host.workspace.trusted = true;
  host.workspace.projectPath = undefined;
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

it.each(
  taskOperations.flatMap((operation) =>
    workspaceChanges.map((change) => ({ ...operation, ...change })),
  ),
)(
  "does not forward $method when the host $change during task authorization",
  async ({ method, params, apply }) => {
    host.workspace.projectPath = tmpdir();
    const pendingRead = deferredRead();
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        const message = communicationRequestMessageSchema.parse(JSON.parse(String(init.body)));
        methods.push(message.method);
        if (message.method === sessionMethods.read) await pendingRead.promise;
        return Response.json(
          createSuccessfulCommunicationResponseMessage(
            message.requestId,
            message.method === sessionMethods.read ? taskSnapshot() : { accepted: true },
          ),
        );
      }),
    );
    await manager.open();
    const panel = host.panels[0]!;
    panel.receive(createCommunicationRequestMessage("operation", method, params));
    await vi.waitFor(() => expect(methods).toEqual([sessionMethods.read]));
    apply();
    pendingRead.release();
    await vi.waitFor(() =>
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "operation",
          success: false,
          error: expect.objectContaining({
            message: expect.stringContaining("工作区或信任状态已变化"),
          }),
        }),
      ),
    );
    expect(methods).toEqual([sessionMethods.read]);
  },
);

it.each(taskOperations)(
  "forwards $method once after stable workspace authorization",
  async ({ method, params }) => {
    host.workspace.projectPath = tmpdir();
    const pendingRead = deferredRead();
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        const message = communicationRequestMessageSchema.parse(JSON.parse(String(init.body)));
        methods.push(message.method);
        if (message.method === sessionMethods.read) await pendingRead.promise;
        return Response.json(
          createSuccessfulCommunicationResponseMessage(
            message.requestId,
            message.method === sessionMethods.read ? taskSnapshot() : { accepted: true },
          ),
        );
      }),
    );
    await manager.open();
    const panel = host.panels[0]!;
    panel.receive(createCommunicationRequestMessage("operation", method, params));
    await vi.waitFor(() => expect(methods).toEqual([sessionMethods.read]));
    pendingRead.release();
    await vi.waitFor(() =>
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "operation", success: true }),
      ),
    );
    expect(methods).toEqual([sessionMethods.read, method]);
  },
);

it.each(taskOperations)(
  "does not forward $method for a different task returned in the same workspace",
  async ({ method, params }) => {
    host.workspace.projectPath = tmpdir();
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        const message = communicationRequestMessageSchema.parse(JSON.parse(String(init.body)));
        methods.push(message.method);
        return Response.json(
          createSuccessfulCommunicationResponseMessage(
            message.requestId,
            taskSnapshot("other-task"),
          ),
        );
      }),
    );
    await manager.open();
    const panel = host.panels[0]!;
    panel.receive(createCommunicationRequestMessage("operation", method, params));
    await vi.waitFor(() =>
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "operation",
          success: false,
          error: expect.objectContaining({ message: expect.stringContaining("任务身份不一致") }),
        }),
      ),
    );
    expect(methods).toEqual([sessionMethods.read]);
  },
);

it.each(workspaceChanges)(
  "does not create a task when the host $change while resolving the workspace",
  async ({ apply }) => {
    host.workspace.projectPath = tmpdir();
    const pendingPath = deferredRead();
    host.realpath.mockImplementationOnce(async (path) => {
      await pendingPath.promise;
      return path;
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await manager.open();
    const panel = host.panels[0]!;
    panel.receive(
      createCommunicationRequestMessage("create", sessionMethods.create, {
        projectPath: "/ignored-page-path",
        prompt: "task",
      }),
    );
    await vi.waitFor(() => expect(host.realpath).toHaveBeenCalledExactlyOnceWith(tmpdir()));
    apply();
    pendingPath.release();
    await vi.waitFor(() =>
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "create",
          success: false,
          error: expect.objectContaining({
            message: expect.stringContaining("工作区或信任状态已变化"),
          }),
        }),
      ),
    );
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it("forwards a stable create once using the resolved host directory", async () => {
  host.workspace.projectPath = tmpdir();
  const canonicalPath = "/canonical-target";
  host.realpath.mockResolvedValueOnce(canonicalPath);
  const messages: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const message = communicationRequestMessageSchema.parse(JSON.parse(String(init.body)));
      messages.push(message);
      return Response.json(
        createSuccessfulCommunicationResponseMessage(message.requestId, { taskId: "task" }),
      );
    }),
  );
  await manager.open();
  const panel = host.panels[0]!;
  panel.receive(
    createCommunicationRequestMessage("create", sessionMethods.create, {
      projectPath: "/ignored-page-path",
      prompt: "task",
    }),
  );
  await vi.waitFor(() =>
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "create", success: true }),
    ),
  );
  expect(messages).toEqual([
    expect.objectContaining({
      method: sessionMethods.create,
      params: expect.objectContaining({ projectPath: canonicalPath }),
    }),
  ]);
});

it.each([diagnosticMethods.read, deliveryMethods.read])(
  "forwards read-only %s without trust or a task history read",
  async (method) => {
    host.workspace.trusted = false;
    const methods: string[] = [];
    const response = createSuccessfulCommunicationResponseMessage("read-only", { taskId: "task" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        const message = communicationRequestMessageSchema.parse(JSON.parse(String(init.body)));
        methods.push(message.method);
        return Response.json(response);
      }),
    );
    await manager.open();
    const panel = host.panels[0]!;
    panel.receive(createCommunicationRequestMessage("read-only", method, { taskId: "task" }));
    await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalledWith(response));
    expect(methods).toEqual([method]);
    expect(host.realpath).not.toHaveBeenCalled();
  },
);

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
  const methods: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          methods.push(
            communicationInboundMessageSchema.parse(JSON.parse(String(init.body))).method,
          );
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
  expect(methods).toEqual(Array.from({ length: 3 }, () => sessionMethods.subscribe));
});

it("only cancels the old subscription when navigating to another task", async () => {
  const methods: string[] = [];
  let subscriptionSignal: AbortSignal | null | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: unknown, init: RequestInit) => {
      methods.push(communicationInboundMessageSchema.parse(JSON.parse(String(init.body))).method);
      subscriptionSignal = init.signal;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    }),
  );
  await manager.openHistoryTask("task-1");
  const panel = host.panels[0]!;
  panel.receive(
    createCommunicationStreamRequestMessage("subscription", sessionMethods.subscribe, {
      taskId: "task-1",
    }),
  );
  expect(subscriptionSignal?.aborted).toBe(false);
  await manager.openHistoryTask("task-2");
  expect(subscriptionSignal?.aborted).toBe(true);
  expect(methods).toEqual([sessionMethods.subscribe]);
  expect(panel.webview.html).toContain("task-2");
});

it("authorizes each new request against the current workspace rather than the one that opened the panel", async () => {
  host.workspace.projectPath = tmpdir();
  await manager.open();
  host.workspace.projectPath = "/";
  const methods: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const message = communicationRequestMessageSchema.parse(JSON.parse(String(init.body)));
      methods.push(message.method);
      return Response.json(
        createSuccessfulCommunicationResponseMessage(message.requestId, taskSnapshot()),
      );
    }),
  );
  const panel = host.panels[0]!;
  panel.receive(
    createCommunicationRequestMessage("send", sessionMethods.send, {
      taskId: "task",
      text: "change",
    }),
  );
  await vi.waitFor(() =>
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "send",
        success: false,
        error: expect.objectContaining({ message: expect.stringContaining("不一致") }),
      }),
    ),
  );
  expect(methods).toEqual([sessionMethods.read]);
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
