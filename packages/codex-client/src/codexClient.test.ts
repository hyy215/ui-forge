import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexClient, type CodexEvent } from "./codexClient.js";
import { CodexProcessError, CodexRpcError, CodexTimeoutError } from "./errors.js";
import { checkCodexVersion } from "./version.js";
import type {
  NativeMethods,
  NativeReplies,
  ServerNotification,
  ServerRequest,
} from "./generated/native.js";
import {
  approval,
  capacityFailureScenario,
  startResponse,
  thread,
  turn,
} from "./testing/payloads.js";

const clients: CodexClient[] = [];
const directories: string[] = [];
type Step = {
  method: string;
  result?: unknown;
  error?: unknown;
  before?: unknown[];
  after?: unknown[];
  delay?: number;
  hang?: boolean;
  exit?: boolean;
  raw?: string;
  fragment?: boolean;
};
async function setup(steps: Step[], requestTimeoutMs = 2_000) {
  const cwd = await mkdtemp(join(tmpdir(), "codex-client-test-"));
  directories.push(cwd);
  const executable = join(cwd, "codex");
  const fixture = await readFile(new URL("./testing/nativeServer.cjs", import.meta.url), "utf8");
  await writeFile(
    executable,
    `#!${process.execPath}\nif (process.argv[2] === '--version') { console.log('codex-cli 0.153.4'); process.exit(0); }\n${fixture}`,
    { mode: 0o700 },
  );
  await writeFile(join(cwd, "scenario.json"), JSON.stringify({ steps }));
  const client = new CodexClient({ executable, cwd, requestTimeoutMs });
  clients.push(client);
  const events: CodexEvent[] = [];
  client.subscribe((event) => events.push(event));
  const wire = async (): Promise<Array<Record<string, unknown>>> =>
    (await readFile(join(cwd, "wire.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { client, cwd, executable, events, wire };
}
const interrupt = { threadId: thread.id, turnId: turn.id };
const resolved: ServerNotification = {
  method: "serverRequest/resolved",
  params: { threadId: thread.id, requestId: approval.id },
};
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.unstubAllEnvs();
});

describe("native Codex connection", () => {
  it("uses the same PATH installation for version checks and app-server with a minimal environment", async () => {
    const fixture = await setup([]);
    await fixture.client.close();
    vi.stubEnv("PATH", fixture.cwd);
    const client = new CodexClient({ cwd: fixture.cwd });
    clients.push(client);
    expect((await checkCodexVersion()).runtimeVersion).toBe("0.153.4");
    expect((await client.connect()).userAgent).toBe("fixture");
  });

  it("shares initialization and forwards native configuration without feature or policy overrides", async () => {
    const { client, cwd, wire } = await setup([{ method: "thread/start", result: startResponse }]);
    const [first, second] = await Promise.all([client.connect(), client.connect()]);
    expect(first).toEqual(second);
    const params: NativeMethods["thread/start"]["params"] = {
      cwd,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      developerInstructions: "Use the project rules",
      multiAgentMode: "proactive",
      config: {
        mcp_servers: { design: { url: "https://example.com/mcp" } },
        "features.memories": true,
      },
    };
    expect(await client.request("thread/start", params)).toEqual(startResponse);
    const requests = await wire();
    expect(requests.map((request) => request.method)).toEqual([
      "initialize",
      "initialized",
      "thread/start",
    ]);
    expect(requests[2]?.params).toEqual(params);
    expect(JSON.parse(await readFile(join(cwd, "argv.json"), "utf8"))).toEqual([
      "app-server",
      "--listen",
      "stdio://",
    ]);
  });

  it("passes file/design inputs to Codex and forwards subagent events arriving before the response", async () => {
    const notification: ServerNotification = {
      method: "item/agentMessage/delta",
      params: { threadId: "subagent-9", turnId: "sub-turn", itemId: "item-9", delta: "设计识别" },
    };
    const { client, events, wire } = await setup([
      { method: "turn/start", result: { turn }, before: [notification], fragment: true },
    ]);
    const params: NativeMethods["turn/start"]["params"] = {
      threadId: thread.id,
      input: [
        {
          type: "text",
          text: "Read ./requirements.pdf and https://example.com/design",
          text_elements: [],
        },
        { type: "localImage", path: "/not-preprocessed/design.png" },
      ],
    };
    expect(await client.request("turn/start", params)).toEqual({ turn });
    expect(events).toContainEqual({ type: "notification", notification });
    expect((await wire()).at(-1)?.params).toEqual(params);
  });

  it("applies scalar process overrides before initialization without shell expansion or changing the default client", async () => {
    const fixture = await setup([]);
    await fixture.client.close();
    const configOverrides = {
      "features.computer_use": false,
      "plugins.unified-computer-use@openai-bundled.enabled": false,
      model: 'literal "quoted" value with $(echo untouched)',
    };
    const client = new CodexClient({
      cwd: fixture.cwd,
      executable: fixture.executable,
      configOverrides,
    });
    clients.push(client);
    await client.connect();
    expect(JSON.parse(await readFile(join(fixture.cwd, "argv.json"), "utf8"))).toEqual([
      "app-server",
      "--listen",
      "stdio://",
      "-c",
      "features.computer_use=false",
      "-c",
      "plugins.unified-computer-use@openai-bundled.enabled=false",
      "-c",
      `model=${JSON.stringify(configOverrides.model)}`,
    ]);
    expect(
      () =>
        new CodexClient({
          cwd: fixture.cwd,
          configOverrides: { invalid: [] },
        } as unknown as ConstructorParameters<typeof CodexClient>[0]),
    ).toThrow();
  });

  it("uses native resume, read, review, steer and interrupt without local turn prerequisites", async () => {
    const resumed: NativeMethods["thread/resume"]["result"] = {
      ...startResponse,
      initialTurnsPage: null,
      turnsBackwardsCursor: null,
      itemsBackwardsCursor: null,
    };
    const review: NativeMethods["review/start"]["result"] = {
      turn,
      reviewThreadId: "review-thread",
    };
    const { client } = await setup([
      { method: "thread/resume", result: resumed },
      { method: "thread/read", result: { thread } },
      { method: "review/start", result: review },
      { method: "turn/steer", result: { turnId: turn.id } },
      { method: "turn/interrupt", result: {} },
    ]);
    expect(await client.request("thread/resume", { threadId: thread.id })).toEqual(resumed);
    expect(
      await client.request("thread/read", { threadId: thread.id, includeTurns: true }),
    ).toEqual({ thread });
    expect(
      await client.request("review/start", {
        threadId: thread.id,
        target: { type: "uncommittedChanges" },
        delivery: "detached",
      }),
    ).toEqual(review);
    expect(
      await client.request("turn/steer", {
        threadId: thread.id,
        expectedTurnId: turn.id,
        input: [],
      }),
    ).toEqual({ turnId: turn.id });
    expect(await client.request("turn/interrupt", interrupt)).toEqual({});
  });

  it("correlates out-of-order RPC replies and preserves unknown response fields", async () => {
    const { client } = await setup([
      {
        method: "thread/list",
        result: { data: [], nextCursor: "older", backwardsCursor: null },
        delay: 30,
      },
      {
        method: "account/read",
        result: { account: null, requiresOpenaiAuth: true, extensionField: "中文" },
        fragment: true,
      },
    ]);
    const [list, account] = await Promise.all([
      client.request("thread/list", {}),
      client.request("account/read", {}),
    ]);
    expect(list.nextCursor).toBe("older");
    expect(account).toEqual({ account: null, requiresOpenaiAuth: true, extensionField: "中文" });
  });

  it("preserves native errors instead of manufacturing an empty history", async () => {
    const error = { code: -32600, message: "Thread has no rollout", data: { threadId: thread.id } };
    const { client } = await setup([{ method: "thread/read", error }]);
    await expect(
      client.request("thread/read", { threadId: thread.id, includeTurns: true }),
    ).rejects.toMatchObject({ ...error, name: "CodexRpcError" });
    expect(new CodexRpcError(error)).toBeInstanceOf(Error);
  });

  it("forwards native capacity retries and failure without replaying work before an explicit continuation", async () => {
    const scenario = capacityFailureScenario;
    const activeThread = {
      ...thread,
      status: { type: "active", activeFlags: [] },
      turns: [scenario.activeTurn],
    } satisfies NativeMethods["thread/read"]["result"]["thread"];
    const failedThread = {
      ...thread,
      turns: [scenario.failedTurn],
    } satisfies NativeMethods["thread/read"]["result"]["thread"];
    const continuedThread = {
      ...activeThread,
      turns: [scenario.failedTurn, scenario.continuedTurn],
    } satisfies NativeMethods["thread/read"]["result"]["thread"];
    const { client, events, wire } = await setup([
      { method: "turn/start", result: { turn }, before: scenario.retrying },
      { method: "thread/read", result: { thread: activeThread } },
      { method: "thread/read", result: { thread: failedThread }, before: scenario.failed },
      {
        method: "turn/start",
        result: { turn: scenario.continuedTurn },
        before: scenario.continued,
      },
      { method: "thread/read", result: { thread: continuedThread } },
    ]);
    await client.request("turn/start", {
      threadId: thread.id,
      input: [{ type: "text", text: "Build the page", text_elements: [] }],
    });
    expect(events).toEqual(
      scenario.retrying.map((notification) => ({ type: "notification", notification })),
    );
    expect(
      await client.request("thread/read", { threadId: thread.id, includeTurns: true }),
    ).toEqual({
      thread: activeThread,
    });
    expect((await wire()).filter((request) => request.method === "turn/start")).toHaveLength(1);

    expect(
      await client.request("thread/read", { threadId: thread.id, includeTurns: true }),
    ).toEqual({
      thread: failedThread,
    });
    expect(events).toEqual(
      [...scenario.retrying, ...scenario.failed].map((notification) => ({
        type: "notification",
        notification,
      })),
    );
    expect((await wire()).map((request) => request.method)).toEqual([
      "initialize",
      "initialized",
      "turn/start",
      "thread/read",
      "thread/read",
    ]);

    const continuation: NativeMethods["turn/start"]["params"] = {
      threadId: thread.id,
      input: [
        {
          type: "text",
          text: "Check existing work and continue unfinished changes",
          text_elements: [],
        },
      ],
    };
    expect(await client.request("turn/start", continuation)).toEqual({
      turn: scenario.continuedTurn,
    });
    expect(
      await client.request("thread/read", { threadId: thread.id, includeTurns: true }),
    ).toEqual({
      thread: continuedThread,
    });
    const requests = await wire();
    expect(requests.filter((request) => request.method === "turn/start")).toHaveLength(2);
    expect(requests.filter((request) => request.method === "turn/start").at(-1)?.params).toEqual(
      continuation,
    );
    expect(
      requests.some(
        (request) => request.method === "turn/steer" || request.method === "thread/start",
      ),
    ).toBe(false);
    expect(events).toEqual(
      [...scenario.retrying, ...scenario.failed, ...scenario.continued].map((notification) => ({
        type: "notification",
        notification,
      })),
    );
  });

  it("validates external input before starting a process and validates native responses", async () => {
    const { client, wire } = await setup([
      { method: "thread/read", result: { thread: { id: 1 } } },
    ]);
    // @ts-expect-error Runtime callers can provide invalid protocol input.
    await expect(client.request("turn/start", { threadId: 17, input: [] })).rejects.toThrow(
      "Invalid Codex",
    );
    await expect(wire()).rejects.toThrow();
    await expect(client.request("thread/read", { threadId: thread.id })).rejects.toThrow(
      "Invalid Codex",
    );
    expect(() => new CodexClient({ cwd: "relative" })).toThrow();
  });
});

describe("native interactions", () => {
  it.each(["accept", "acceptForSession", "decline", "cancel"] as const)(
    "forwards command and file %s unchanged and rejects duplicate replies",
    async (decision) => {
      const fileApproval: ServerRequest = {
        method: "item/fileChange/requestApproval",
        id: "file-approval",
        params: { threadId: thread.id, turnId: turn.id, itemId: "file-1", startedAtMs: 0 },
      };
      const { client, wire } = await setup([
        { method: "turn/interrupt", result: {}, before: [approval, fileApproval] },
      ]);
      await client.request("turn/interrupt", interrupt);
      const pending = client.pendingRequests()[0]!;
      expect(pending.request).toEqual(approval);
      await expect(client.respond(pending.token, { decision: "approve" })).rejects.toThrow(
        "Invalid Codex",
      );
      expect(client.pendingRequests()).toHaveLength(2);
      await client.respond(pending.token, { decision });
      await expect(client.respond(pending.token, { decision })).rejects.toThrow(
        "no longer pending",
      );
      await expect.poll(wire).toContainEqual({ id: approval.id, result: { decision } });
      await client.respond(client.pendingRequests()[0]!.token, { decision });
      await expect.poll(wire).toContainEqual({ id: fileApproval.id, result: { decision } });
    },
  );

  it("keeps pending interactions while UI is disconnected and expires them on native resolution", async () => {
    const { client, wire } = await setup([
      { method: "turn/interrupt", result: {}, before: [approval] },
      { method: "turn/interrupt", result: {}, before: [resolved, approval] },
    ]);
    const unsubscribe = client.subscribe(() => {
      throw new Error("broken UI");
    });
    unsubscribe();
    await client.request("turn/interrupt", interrupt);
    const stale = client.pendingRequests()[0]!;
    await client.request("turn/interrupt", interrupt);
    const current = client.pendingRequests()[0]!;
    expect(current.token).not.toBe(stale.token);
    await expect(client.respond(stale.token, { decision: "accept" })).rejects.toThrow(
      "no longer pending",
    );
    expect((await wire()).filter((message) => !message.method)).toEqual([]);
    await client.respond(current.token, { decision: "cancel" });
    expect(client.pendingRequests()).toEqual([]);
  });

  it("passes permission denial, user answers and MCP cancellation through their native reply schemas", async () => {
    const requests: ServerRequest[] = [
      {
        id: 1,
        method: "item/permissions/requestApproval",
        params: {
          threadId: thread.id,
          turnId: turn.id,
          itemId: "p",
          environmentId: null,
          startedAtMs: 0,
          cwd: "/fixture",
          reason: null,
          permissions: { network: null, fileSystem: null },
        },
      },
      {
        id: 2,
        method: "item/tool/requestUserInput",
        params: {
          threadId: thread.id,
          turnId: turn.id,
          itemId: "q",
          questions: [],
          isBlocking: true,
          autoResolutionMs: null,
        },
      },
      {
        id: 3,
        method: "mcpServer/elicitation/request",
        params: {
          threadId: thread.id,
          turnId: null,
          serverName: "design",
          mode: "url",
          _meta: null,
          message: "Authenticate",
          url: "https://example.com",
          elicitationId: "e",
        },
      },
    ];
    const replies = [
      {
        permissions: {},
        scope: "turn",
      } satisfies NativeReplies["item/permissions/requestApproval"],
      {
        answers: { question: { answers: ["Use the existing component"] } },
      } satisfies NativeReplies["item/tool/requestUserInput"],
      {
        action: "cancel",
        content: null,
        _meta: null,
      } satisfies NativeReplies["mcpServer/elicitation/request"],
    ];
    const { client, wire } = await setup([
      { method: "turn/interrupt", result: {}, before: requests },
    ]);
    await client.request("turn/interrupt", interrupt);
    for (const [index, pending] of client.pendingRequests().entries())
      await client.respond(pending.token, replies[index]);
    await expect
      .poll(async () => (await wire()).filter((message) => !message.method))
      .toEqual(replies.map((result, index) => ({ id: index + 1, result })));
  });
});

describe("transport failures", () => {
  it("forwards unknown notifications and rejects unsupported server requests without stopping known interactions", async () => {
    const notification = { method: "future/progress", params: { progress: 3 } };
    const { client, events, wire } = await setup([
      {
        method: "turn/interrupt",
        result: {},
        before: [
          notification,
          { id: "future-request", method: "future/approval", params: {} },
          approval,
        ],
      },
    ]);
    await client.request("turn/interrupt", interrupt);
    expect(events).toContainEqual({ type: "unknownNotification", notification });
    expect(events).toContainEqual({
      type: "unsupportedRequest",
      requestId: "future-request",
      method: "future/approval",
    });
    expect(events.some((event) => event.type === "close")).toBe(false);
    expect(client.pendingRequests()).toHaveLength(1);
    await client.respond(client.pendingRequests()[0]!.token, { decision: "decline" });
    await expect.poll(wire).toContainEqual({
      id: "future-request",
      error: { code: -32601, message: "Unsupported Codex server request" },
    });
    await expect.poll(wire).toContainEqual({ id: approval.id, result: { decision: "decline" } });
  });

  it("returns a typed timeout and forwards the late response under the same request ID", async () => {
    const { client, events, wire } = await setup(
      [{ method: "thread/start", result: startResponse, delay: 1_500 }],
      1_000,
    );
    const error: unknown = await client
      .request("thread/start", {})
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(CodexTimeoutError);
    expect(error).toMatchObject({
      requestId: 2,
      method: "thread/start",
      timeoutMs: 1_000,
      executionStatus: "unknown",
    });
    await expect
      .poll(() => events)
      .toContainEqual({
        type: "lateResponse",
        requestId: 2,
        method: "thread/start",
        response: { id: 2, result: startResponse },
      });
    expect((await wire()).filter((request) => request.method === "thread/start")).toHaveLength(1);
  });

  it("forwards a late RPC error and keeps only the latest 128 timeout associations", async () => {
    const steps = Array.from({ length: 129 }, () => ({
      method: "thread/read",
      delay: 1_800,
      error: { code: -32600, message: "Not found" },
    }));
    const { client, events } = await setup(steps, 1_000);
    await client.connect();
    const results = await Promise.allSettled(
      steps.map(() => client.request("thread/read", { threadId: "missing" })),
    );
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    await expect
      .poll(() => events.filter((event) => event.type === "lateResponse").length, {
        timeout: 3_000,
      })
      .toBe(128);
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "lateResponse", requestId: 2 }),
    );
    expect(events).toContainEqual({
      type: "lateResponse",
      requestId: 130,
      method: "thread/read",
      response: { id: 130, error: { code: -32600, message: "Not found" } },
    });
  }, 10_000);

  it("preserves startup diagnostics while redacting authentication lines split across chunks", async () => {
    const { client, executable } = await setup([]);
    await writeFile(
      executable,
      `#!${process.execPath}\nprocess.stderr.write('Invalid TOML at line 12\\nAuthoriza'); setTimeout(() => { process.stderr.write('tion: Bearer fixture-secret\\nMG_MCP_TOKEN=fixture-token\\n'); process.exit(12); }, 20);`,
      { mode: 0o700 },
    );
    const error: unknown = await client.connect().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(CodexProcessError);
    expect(error).toMatchObject({
      exitCode: 12,
      signal: null,
      diagnostics: expect.stringContaining("Invalid TOML at line 12"),
    });
    expect(String(error)).not.toContain("fixture-secret");
    expect(String(error)).not.toContain("fixture-token");
  });

  it("binds an AbortSignal to the host lifetime and rejects pending work when it is aborted", async () => {
    const fixture = await setup([{ method: "thread/read", hang: true, before: [approval] }]);
    await fixture.client.close();
    const controller = new AbortController();
    const client = new CodexClient({
      cwd: fixture.cwd,
      executable: fixture.executable,
      signal: controller.signal,
    });
    clients.push(client);
    const request = client.request("thread/read", { threadId: thread.id });
    const rejected = expect(request).rejects.toThrow("closed by host");
    await expect.poll(() => client.pendingRequests().length).toBe(1);
    controller.abort();
    await rejected;
    await client.close();
    expect(client.pendingRequests()).toEqual([]);
    await expect(client.connect()).rejects.toThrow("closed");
    const unused = new CodexClient({
      cwd: fixture.cwd,
      executable: fixture.executable,
      signal: controller.signal,
    });
    await expect(unused.connect()).rejects.toThrow("closed");
  });

  it("reports matching and differing CLI versions without starting app-server", async () => {
    const { executable } = await setup([]);
    for (const version of ["0.153.4", "0.154.0"]) {
      await writeFile(
        executable,
        `#!${process.execPath}\nif (process.argv[2] !== '--version') process.exit(2); console.log('codex-cli ${version}');`,
        { mode: 0o700 },
      );
      expect(await checkCodexVersion(executable)).toEqual({
        runtimeVersion: version,
        protocolVersion: "0.153.4",
        matches: version === "0.153.4",
      });
    }
  });

  it("times out once without retrying or stopping other requests", async () => {
    const { client, wire } = await setup(
      [
        { method: "thread/read", result: { thread }, delay: 1_500 },
        { method: "account/read", result: { account: null, requiresOpenaiAuth: true } },
      ],
      1_000,
    );
    await expect(client.request("thread/read", { threadId: thread.id })).rejects.toThrow(
      "timed out",
    );
    expect(await client.request("account/read", {})).toEqual({
      account: null,
      requiresOpenaiAuth: true,
    });
    expect((await wire()).filter((request) => request.method === "thread/read")).toHaveLength(1);
  });

  it.each([
    { raw: "not-json\n", hang: true },
    { before: [{ method: "thread/status/changed", params: { threadId: 5 } }], hang: true },
    { before: [approval, approval], hang: true },
    { exit: true },
  ])(
    "closes on malformed traffic or process exit and invalidates pending replies",
    async (failure) => {
      const { client, events } = await setup([{ method: "thread/read", ...failure }]);
      await expect(client.request("thread/read", { threadId: thread.id })).rejects.toThrow();
      expect(events.filter((event) => event.type === "close")).toHaveLength(1);
      expect(client.pendingRequests()).toEqual([]);
      await expect(client.connect()).rejects.toThrow("closed");
    },
  );

  it("closes pending RPCs and isolates subscriber exceptions", async () => {
    const { client } = await setup([{ method: "thread/read", hang: true, before: [approval] }]);
    client.subscribe(() => {
      throw new Error("UI error");
    });
    const request = client.request("thread/read", { threadId: thread.id });
    const rejected = expect(request).rejects.toThrow("closed by host");
    await expect.poll(() => client.pendingRequests().length).toBe(1);
    const token = client.pendingRequests()[0]!.token;
    await client.close();
    await rejected;
    await expect(client.respond(token, { decision: "accept" })).rejects.toThrow(
      "no longer pending",
    );
  });

  it("reports an unavailable executable and can close before initialization", async () => {
    const client = new CodexClient({ cwd: tmpdir(), executable: "/nonexistent/codex" });
    clients.push(client);
    await expect(client.connect()).rejects.toThrow(/ENOENT[\s\S]*UI_FORGE_CODEX_PATH/);
    await expect(checkCodexVersion("/nonexistent/codex")).rejects.toThrow(
      /ENOENT[\s\S]*UI_FORGE_CODEX_PATH/,
    );
    const unused = new CodexClient({ cwd: tmpdir() });
    await unused.close();
    await expect(unused.connect()).rejects.toThrow("closed");
  });

  it("reports a deleted target directory separately from a missing executable", async () => {
    const fixture = await setup([]);
    const client = new CodexClient({
      cwd: join(fixture.cwd, "missing"),
      executable: fixture.executable,
    });
    clients.push(client);
    await expect(client.connect()).rejects.toThrow("工作区不存在或不可访问");
  });
});
