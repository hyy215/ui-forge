import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sessionMethods,
  diagnosticMethods,
  designMethods,
  deliveryMethods,
  taskDeliverySchema,
  taskDiagnosticsSchema,
  type TaskDelivery,
  type TaskDiagnostics,
  type SessionSnapshot,
} from "@ui-forge/shared-protocol";
import { runCli } from "./cli.js";

const runtime = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  request: vi.fn<(method: string, params: unknown, schema: unknown) => Promise<unknown>>(),
  watch: vi.fn<() => Promise<number>>(),
  version: vi.fn<() => Promise<unknown>>(),
  account: vi.fn<() => Promise<unknown>>(),
  closeCodex: vi.fn<() => Promise<void>>(),
  listen: vi.fn<() => Promise<string>>(),
  closeServer: vi.fn<() => Promise<void>>(),
}));
vi.mock("./client.js", () => ({
  LocalClient: class {
    connect = runtime.connect;
    request = runtime.request;
  },
}));
vi.mock("./taskSession.js", () => ({ watchTask: runtime.watch }));
vi.mock("@ui-forge/codex-client", () => ({
  checkCodexVersion: runtime.version,
  CodexClient: class {
    request = runtime.account;
    close = runtime.closeCodex;
  },
}));
vi.mock("@ui-forge/agent-server", () => ({
  AgentServer: class {
    listen = runtime.listen;
    close = runtime.closeServer;
  },
}));

const snapshot: SessionSnapshot = {
  thread: {
    id: "task-1",
    cwd: "/tmp/app",
    preview: "任务",
    name: null,
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    turns: [],
  },
  pendingRequests: [],
};
const activeSnapshot: SessionSnapshot = {
  ...snapshot,
  thread: {
    ...snapshot.thread,
    turns: [{ id: "turn-1", status: "inProgress", items: [], error: null }],
  },
};
const diagnostics: TaskDiagnostics = {
  reportVersion: 2,
  generatedAt: "2026-09-20T00:00:00.000Z",
  taskId: "task-1",
  source: "codex-thread-read",
  scope: "thread-tree",
  status: "idle",
  model: null,
  modelProvider: null,
  reasoningEffort: null,
  codexVersion: null,
  protocolVersion: "0.153.4",
  runtime: null,
  agents: [],
  ruleFingerprints: null,
  tokenUsage: null,
  turns: [],
  warnings: ["rulesUnavailable", "tokenUsageUnavailable"],
};
const originalExitCode = process.exitCode;
const originalTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
let stdout: string[];
let stderr: string[];
let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "ui-forge-cli-"));
  await writeFile(join(directory, "design.png"), "reference");
  await writeFile(join(directory, "design.svg"), "<svg/>");
  await writeFile(join(directory, "large.png"), "");
  await truncate(join(directory, "large.png"), 5 * 1024 * 1024 + 1);
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

beforeEach(() => {
  vi.resetAllMocks();
  stdout = [];
  stderr = [];
  process.exitCode = undefined;
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.spyOn(process, "loadEnvFile").mockImplementation(() => undefined);
  vi.stubEnv("UI_FORGE_PORT", "4310");
  vi.stubEnv("UI_FORGE_CODEX_PATH", "codex");
  runtime.connect.mockResolvedValue();
  runtime.watch.mockResolvedValue(0);
  runtime.request.mockResolvedValue(snapshot);
  runtime.version.mockResolvedValue({
    runtimeVersion: "0.153.4",
    protocolVersion: "0.153.4",
    matches: true,
  });
  runtime.account.mockResolvedValue({ account: { type: "chatgpt" } });
  runtime.closeCodex.mockResolvedValue();
  runtime.listen.mockResolvedValue("http://127.0.0.1:4310");
  runtime.closeServer.mockResolvedValue();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = originalExitCode;
  if (originalTty) Object.defineProperty(process.stdin, "isTTY", originalTty);
  else Reflect.deleteProperty(process.stdin, "isTTY");
});

describe("command parsing and output", () => {
  it("checks a design connection without creating, reading, resuming or watching a task", async () => {
    const source = {
      kind: "mastergo",
      url: "https://mastergo.com/file/file?layer_id=2:3",
      connection: { kind: "magic" },
    };
    const report = { source, tools: ["get_design_context"] };
    runtime.request.mockResolvedValueOnce(report);
    await runCli([
      "design-check",
      "--json",
      "--design-source",
      "mastergo",
      "--mastergo-connection",
      "magic",
      "--design-url",
      source.url,
    ]);
    expect(runtime.request).toHaveBeenCalledExactlyOnceWith(
      designMethods.check,
      { source },
      expect.anything(),
    );
    expect(runtime.watch).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.join(""))).toEqual(report);
    expect(stderr).toEqual([]);
  });

  it.each([
    ["--design-url", "https://mastergo.com/file/file?layer_id=2:3"],
    ["--design-source", "local", "--mastergo-connection", "magic"],
    ["--design-source", "mastergo", "--design-url", "https://mastergo.com/file/file"],
    ["--design-source", "figma"],
  ])("rejects invalid design options before connecting %j", async (...options) => {
    await runCli(["run", "--target", "/tmp/app", ...options, "--", "需求"]);
    expect(process.exitCode).toBe(1);
    expect(runtime.connect).not.toHaveBeenCalled();
  });
  it.each([[], ["help"], ["--help"], ["-h"]])(
    "shows top-level help without connecting for %j",
    async (...argv) => {
      await runCli(argv);
      expect(stdout.join("")).toContain("Commands:");
      expect(stdout.join("")).toContain("doctor");
      expect(stderr).toEqual([]);
      expect(process.exitCode ?? 0).toBe(0);
      expect(runtime.connect).not.toHaveBeenCalled();
      expect(runtime.version).not.toHaveBeenCalled();
      expect(runtime.listen).not.toHaveBeenCalled();
    },
  );

  it.each([
    "doctor",
    "serve",
    "run",
    "list",
    "status",
    "resume",
    "diagnostics",
    "delivery",
    "design-check",
  ])("shows help for %s before checking required inputs", async (command) => {
    await runCli([command, "--help"]);
    expect(stdout.join("")).toContain(`Usage: ui-forge ${command}`);
    expect(stdout.join("")).toContain("--json");
    expect(stderr).toEqual([]);
    expect(process.exitCode ?? 0).toBe(0);
    expect(runtime.connect).not.toHaveBeenCalled();
    expect(runtime.version).not.toHaveBeenCalled();
    expect(runtime.listen).not.toHaveBeenCalled();
  });

  it("supports help run and documents only the selected command's options", async () => {
    await runCli(["help", "run"]);
    expect(stdout.join("")).toContain("--target <directory>");
    expect(stdout.join("")).toContain("--image <path>");
    stdout.length = 0;
    await runCli(["list", "--help"]);
    expect(stdout.join("")).not.toContain("--image");
  });

  it.each([
    ["unknown"],
    ["list", "extra"],
    ["doctor", "extra"],
    ["serve", "extra"],
    ["list", "--image", "a.png"],
    ["status", "task-1", "--target", "/tmp/app"],
    ["run", "--target"],
    ["run", "hello"],
    ["run", "--target", ""],
    ["run", "--target", "/tmp/app"],
    ["status"],
    ["diagnostics"],
    ["diagnostics", " "],
    ["diagnostics", "one", "two"],
    ["diagnostics", "task-1", "--target", "/tmp/app"],
    ["delivery"],
    ["delivery", " "],
    ["delivery", "one", "two"],
    ["delivery", "task-1", "--target", "/tmp/app"],
    ["resume"],
    ["status", " "],
    ["resume", "one", "two"],
    ["resume", "task-1", "--extra-rounds", "1"],
    ["run", "--target", "/tmp/app", "--auto-approve", "hello"],
  ])("rejects invalid command arguments %j before connecting", async (...argv) => {
    await runCli(argv);
    expect(process.exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toHaveLength(1);
    expect(runtime.connect).not.toHaveBeenCalled();
    expect(runtime.account).not.toHaveBeenCalled();
    expect(runtime.listen).not.toHaveBeenCalled();
  });

  it.each([
    ["--json", "list"],
    ["list", "--json"],
  ])("accepts global JSON options before and after the command %j", async (...argv) => {
    runtime.request.mockResolvedValue({ tasks: [], nextOffset: null });
    await runCli(argv);
    expect(stdout).toEqual(['{"tasks":[],"nextOffset":null}\n']);
    expect(stderr).toEqual([]);
  });

  it("emits one JSON error for parser failures, including JSON flags after the invalid argument", async () => {
    await runCli(["list", "--unknown", "--json"]);
    expect(stdout).toEqual([]);
    expect(stderr).toHaveLength(1);
    expect(JSON.parse(stderr[0] ?? "")).toMatchObject({
      type: "error",
      message: expect.stringContaining("--unknown"),
    });
    expect(process.exitCode).toBe(1);
  });

  it("reports asynchronous failures in the same JSON error format", async () => {
    runtime.connect.mockRejectedValue(new Error("服务不可达"));
    await runCli(["status", "task-1", "--json"]);
    expect(stderr).toEqual(['{"type":"error","message":"服务不可达"}\n']);
    expect(stdout).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it.each([false, true])(
    "filters terminal controls only in human error output (json=%s)",
    async (json) => {
      const message = "\u001b[31m服务不可达\u001b[0m\r\b\u001b]52;c;c2VjcmV0\u0007";
      runtime.connect.mockRejectedValue(new Error(message));
      await runCli(["status", "task-1", ...(json ? ["--json"] : [])]);
      expect(stderr).toEqual([
        json ? `${JSON.stringify({ type: "error", message })}\n` : "服务不可达\n",
      ]);
      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
    },
  );

  it("does not interpret JSON-looking requirement text after -- as an output flag", async () => {
    runtime.connect.mockRejectedValue(new Error("服务不可达"));
    await runCli(["run", "--target", "/tmp/app", "--", "--json"]);
    expect(stderr).toEqual(["服务不可达\n"]);
  });

  it.each(["run", "resume"])(
    "requires JSON mode for non-TTY %s before connecting",
    async (command) => {
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
      await runCli(
        command === "run" ? ["run", "--target", "/tmp/app", "hello"] : ["resume", "task-1"],
      );
      expect(stderr.join("")).toContain("脚本运行请使用 --json");
      expect(runtime.connect).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    },
  );
});

describe("command execution", () => {
  it.each([
    ["delivery", "task-1", "--json"],
    ["--json", "delivery", "task-1"],
  ])("reads delivery without executing or watching a task: %j", async (...argv) => {
    const delivery: TaskDelivery = {
      version: 1,
      taskId: "task-1",
      checkedAt: "2026-09-23T01:00:00.000Z",
      availability: "missing",
      issue: null,
      report: null,
      reportSha256: null,
      source: { state: "unverifiable", manifestFingerprint: null, files: [] },
      evidence: [],
      history: "not-requested",
    };
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
    runtime.request.mockResolvedValue(delivery);
    await runCli(argv);
    expect(runtime.request).toHaveBeenCalledExactlyOnceWith(
      deliveryMethods.read,
      { taskId: "task-1" },
      taskDeliverySchema,
    );
    expect(JSON.parse(stdout.join(""))).toEqual(delivery);
    expect(runtime.watch).not.toHaveBeenCalled();
    expect(runtime.account).not.toHaveBeenCalled();
    expect(stderr).toEqual([]);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("reports delivery read errors without retrying or resuming", async () => {
    runtime.request.mockRejectedValueOnce(new Error("交付记录无法读取"));
    await runCli(["delivery", "task-1", "--json"]);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['{"type":"error","message":"交付记录无法读取"}\n']);
    expect(runtime.request).toHaveBeenCalledTimes(1);
    expect(runtime.watch).not.toHaveBeenCalled();
    expect(runtime.account).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it.each([
    ["diagnostics", "task-1", "--json"],
    ["--json", "diagnostics", "task-1"],
  ])("exports diagnostics with one read-only request: %j", async (...argv) => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
    runtime.request.mockResolvedValue(diagnostics);
    await runCli(argv);
    expect(runtime.request).toHaveBeenCalledExactlyOnceWith(
      diagnosticMethods.read,
      { taskId: "task-1" },
      taskDiagnosticsSchema,
    );
    expect(JSON.parse(stdout.join(""))).toEqual(diagnostics);
    expect(runtime.watch).not.toHaveBeenCalled();
    expect(runtime.account).not.toHaveBeenCalled();
    expect(stderr).toEqual([]);
  });

  it("shows missing diagnostics as unknown without inventing zero usage", async () => {
    runtime.request.mockResolvedValue({
      ...diagnostics,
      turns: [
        {
          turnId: "old-failure",
          status: "failed",
          startedAt: null,
          completedAt: null,
          durationMs: null,
          errorCode: null,
          tools: [],
        },
      ],
    } satisfies TaskDiagnostics);
    await runCli(["diagnostics", "task-1"]);
    expect(stdout.join("")).toContain("原生累计 Token：未知");
    expect(stdout.join("")).toContain("未记录任务创建时的规则指纹");
    expect(stdout.join("")).not.toContain("/tmp/app");
    expect(stdout.join("")).toContain("old-failure | failed | 未知 | 错误码：未记录");
  });

  it("prints observed zero usage, capacity errors and known tool timings separately", async () => {
    runtime.request.mockResolvedValue({
      ...diagnostics,
      model: "fixture-model",
      tokenUsage: {
        observedAt: diagnostics.generatedAt,
        total: {
          totalTokens: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        },
      },
      turns: [
        {
          turnId: "turn-1",
          status: "failed",
          startedAt: null,
          completedAt: null,
          durationMs: 10,
          errorCode: "serverOverloaded",
          tools: [
            {
              type: "commandExecution",
              count: 1,
              completed: 1,
              failed: 0,
              inProgress: 0,
              other: 0,
              timedCount: 1,
              knownDurationMs: 25,
            },
          ],
        },
      ],
    } satisfies TaskDiagnostics);
    await runCli(["diagnostics", "task-1"]);
    expect(stdout.join("")).toContain("原生累计 Token：0");
    expect(stdout.join("")).toContain("turn-1 | failed | 10 ms | 错误码：serverOverloaded");
    expect(stdout.join("")).toContain("已知耗时 25 ms（1 项）");
    expect(stdout.join("")).toContain("不等于轮次耗时");
  });

  it("reports a failed diagnostic read without retrying, resuming or watching", async () => {
    runtime.request.mockRejectedValueOnce(new Error("诊断历史不可用"));
    await runCli(["diagnostics", "task-1", "--json"]);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['{"type":"error","message":"诊断历史不可用"}\n']);
    expect(runtime.request).toHaveBeenCalledTimes(1);
    expect(runtime.watch).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("keeps literal requirements, resolves file paths and sends text, links and images together", async () => {
    runtime.request
      .mockResolvedValueOnce({ taskId: "task-1", warning: "启动警告" })
      .mockResolvedValueOnce(activeSnapshot);
    const literal = "keep `literal` $(text)\n--help";
    await runCli([
      "run",
      "--json",
      "--target",
      "./app",
      "--image",
      join(directory, "design.png"),
      "--design-url",
      "https://mastergo.com/file/file?layer_id=2:3",
      "--design-source",
      "mastergo",
      "--mastergo-connection",
      "magic",
      "--",
      literal,
      "--json",
    ]);
    expect(runtime.request).toHaveBeenNthCalledWith(
      1,
      sessionMethods.create,
      {
        projectPath: resolve("./app"),
        prompt: `${literal} --json`,
        designSource: {
          kind: "mastergo",
          url: "https://mastergo.com/file/file?layer_id=2:3",
          connection: { kind: "magic" },
        },
        images: [
          {
            name: "design.png",
            dataUrl: `data:image/png;base64,${Buffer.from("reference").toString("base64")}`,
          },
        ],
      },
      expect.anything(),
    );
    expect(runtime.watch).toHaveBeenCalledWith(expect.anything(), activeSnapshot, true);
    expect(stderr).toEqual(["启动警告\n"]);
    expect(process.exitCode).toBe(0);
  });

  it.each(["text", "link", "image"])(
    "accepts %s as the only design input in non-TTY JSON mode",
    async (kind) => {
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
      runtime.request
        .mockResolvedValueOnce({ taskId: "task-1" })
        .mockResolvedValueOnce(activeSnapshot);
      const input =
        kind === "text"
          ? ["--", "hello"]
          : kind === "link"
            ? [
                "--design-source",
                "mastergo",
                "--mastergo-connection",
                "magic",
                "--design-url",
                "https://mastergo.com/file/file?layer_id=2:3",
              ]
            : ["--image", join(directory, "design.png")];
      await runCli(["run", "--json", "--target", "/tmp/app", ...input]);
      expect(runtime.watch).toHaveBeenCalledWith(expect.anything(), activeSnapshot, true);
      expect(stderr).toEqual([]);
      expect(process.exitCode).toBe(0);
    },
  );

  it.each(["design.svg", "large.png", "missing.png"])(
    "rejects invalid image %s before starting a server or task",
    async (filename) => {
      await runCli(["run", "--target", "/tmp/app", "--image", join(directory, filename)]);
      expect(process.exitCode).toBe(1);
      expect(stderr).toHaveLength(1);
      expect(runtime.connect).not.toHaveBeenCalled();
      expect(runtime.request).not.toHaveBeenCalled();
    },
  );

  it("lists the first task page in readable output", async () => {
    const page = { tasks: [], nextOffset: null };
    runtime.request.mockResolvedValue(page);
    await runCli(["list"]);
    expect(runtime.request).toHaveBeenCalledExactlyOnceWith(
      sessionMethods.list,
      { offset: 0 },
      expect.anything(),
    );
    expect(stdout).toEqual([`${JSON.stringify(page, null, 2)}\n`]);
  });

  it("reads status without sending a continuation or subscribing", async () => {
    await runCli(["status", "task-1", "--json"]);
    expect(runtime.request).toHaveBeenCalledExactlyOnceWith(
      sessionMethods.read,
      { taskId: "task-1" },
      expect.anything(),
    );
    expect(runtime.watch).not.toHaveBeenCalled();
    expect(stdout).toEqual([`${JSON.stringify(snapshot)}\n`]);
  });

  it("continues an idle task once and subscribes to the refreshed snapshot", async () => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
    runtime.request.mockResolvedValueOnce({ accepted: true }).mockResolvedValueOnce(activeSnapshot);
    await runCli(["resume", "task-1", "--json"]);
    expect(runtime.request.mock.calls.map(([method]) => method)).toEqual([
      sessionMethods.send,
      sessionMethods.read,
    ]);
    expect(runtime.request).toHaveBeenNthCalledWith(
      1,
      sessionMethods.send,
      {
        taskId: "task-1",
        text: "继续当前任务，先检查原会话记录、实际工作区及已有验证结果，只处理尚未完成的工作。复用仍有效的验证结果，避免重复已完成的修改或有副作用的操作；无法确认时先核实当前状态。",
        startOnlyIfIdle: true,
      },
      expect.anything(),
    );
    expect(runtime.watch).toHaveBeenCalledWith(expect.anything(), activeSnapshot, true);
  });

  it("attaches to an active task without steering it and preserves the session exit code", async () => {
    runtime.request.mockResolvedValueOnce({ accepted: true }).mockResolvedValueOnce(activeSnapshot);
    runtime.watch.mockResolvedValue(1);
    await runCli(["resume", "task-1"]);
    expect(runtime.request.mock.calls.map(([method]) => method)).toEqual([
      sessionMethods.send,
      sessionMethods.read,
    ]);
    expect(runtime.request).toHaveBeenNthCalledWith(
      1,
      sessionMethods.send,
      {
        taskId: "task-1",
        text: "继续当前任务，先检查原会话记录、实际工作区及已有验证结果，只处理尚未完成的工作。复用仍有效的验证结果，避免重复已完成的修改或有副作用的操作；无法确认时先核实当前状态。",
        startOnlyIfIdle: true,
      },
      expect.anything(),
    );
    expect(runtime.watch).toHaveBeenCalledWith(expect.anything(), activeSnapshot, false);
    expect(process.exitCode).toBe(1);
  });

  it("reports rejected continuation requests without subscribing", async () => {
    runtime.request.mockRejectedValueOnce(new Error("拒绝继续任务"));
    await runCli(["resume", "task-1", "--json"]);
    expect(runtime.watch).not.toHaveBeenCalled();
    expect(stderr).toEqual(['{"type":"error","message":"拒绝继续任务"}\n']);
    expect(process.exitCode).toBe(1);
  });

  it.each([true, false])(
    "doctor reports login state %s and closes its connection",
    async (authenticated) => {
      if (!authenticated) runtime.account.mockResolvedValue({ account: null });
      await runCli(["doctor", "--json"]);
      expect(runtime.version).toHaveBeenCalledWith("codex");
      expect(runtime.account).toHaveBeenCalledWith("account/read", { refreshToken: false });
      expect(JSON.parse(stdout[0] ?? "")).toEqual({
        runtimeVersion: "0.153.4",
        protocolVersion: "0.153.4",
        matches: true,
        authenticated,
      });
      expect(runtime.closeCodex).toHaveBeenCalledOnce();
      expect(process.exitCode ?? 0).toBe(authenticated ? 0 : 1);
    },
  );

  it("doctor closes its connection when version checking fails", async () => {
    runtime.version.mockRejectedValue(new Error("版本检查失败"));
    await runCli(["doctor"]);
    expect(runtime.closeCodex).toHaveBeenCalledOnce();
    expect(runtime.account).not.toHaveBeenCalled();
    expect(stderr).toEqual(["版本检查失败\n"]);
  });

  it("serve listens locally and closes on a registered termination signal", async () => {
    const once = vi.spyOn(process, "once").mockReturnValue(process);
    vi.stubEnv("UI_FORGE_PORT", "4321");
    await runCli(["serve"]);
    expect(runtime.listen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 4321 });
    expect(once.mock.calls.map(([signal]) => signal)).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
    const handler = once.mock.calls.find(([signal]) => signal === "SIGTERM")?.[1];
    expect(handler).toBeDefined();
    handler?.();
    expect(runtime.closeServer).toHaveBeenCalledOnce();
  });

  it("serve closes resources and removes signal listeners when listening fails", async () => {
    const once = vi.spyOn(process, "once").mockReturnValue(process);
    const remove = vi.spyOn(process, "removeListener");
    runtime.listen.mockRejectedValue(new Error("端口占用"));
    await runCli(["serve", "--json"]);
    expect(runtime.closeServer).toHaveBeenCalledOnce();
    for (const [signal, handler] of once.mock.calls)
      expect(remove).toHaveBeenCalledWith(signal, handler);
    expect(stderr).toEqual(['{"type":"error","message":"端口占用"}\n']);
    expect(process.exitCode).toBe(1);
  });
});
