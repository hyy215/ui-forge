import { afterEach, expect, it } from "vitest";
import { fork, execFile } from "node:child_process";
import { access, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { CodexClient, type CodexEvent } from "./codexClient.js";
import type { NativeMethods, ServerNotification } from "./generated/native.js";

const live = process.env.UI_FORGE_CODEX_LIVE === "1";
const executable = process.env.UI_FORGE_CODEX_PATH || "codex";
const clients: CodexClient[] = [];
const directories: string[] = [];
async function temporary() {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "ui-forge-live-")));
  directories.push(cwd);
  return cwd;
}
async function until<T>(read: () => T | undefined, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await delay(50);
  }
  throw new Error("Timed out waiting for a native Codex event");
}
function observe(client: CodexClient) {
  const notifications: ServerNotification[] = [];
  let failure: Error | undefined;
  client.subscribe((event) => {
    if (event.type === "notification") notifications.push(event.notification);
    if (event.type === "close") failure = event.error;
  });
  return {
    notifications,
    async completed(threadId: string, turnId: string) {
      return until(() => {
        if (failure) throw failure;
        const event = notifications.find(
          (item) =>
            item.method === "turn/completed" &&
            item.params.threadId === threadId &&
            item.params.turn.id === turnId,
        );
        return event?.method === "turn/completed" ? event.params.turn : undefined;
      });
    },
  };
}
const input = (text: string): NativeMethods["turn/start"]["params"]["input"] => [
  { type: "text", text, text_elements: [] },
];
function isExactCommand(display: string | null | undefined, command: string): boolean {
  if (display === command) return true;
  const quoted = [
    `'${command.replaceAll("'", "'\\''")}'`,
    `'${command.replaceAll("'", `'"'"'`)}'`,
    JSON.stringify(command),
  ];
  return ["/bin/zsh", "/bin/bash", "/bin/sh"].some((shell) =>
    ["-lc", "-c"].some((flag) => quoted.some((text) => display === `${shell} ${flag} ${text}`)),
  );
}
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it.skipIf(!live)(
  "runs real coding, approval/denial, interruption, recovery and review in a temporary project",
  async () => {
    const cwd = await temporary();
    await writeFile(
      join(cwd, "design.md"),
      "本次仅验证原生协议，无设计稿或页面任务，不调用浏览器、MCP 或 subagent。",
    );
    await writeFile(
      join(cwd, "project.md"),
      "所有新建 .mjs 文件的首行必须是 // UI_FORGE_LIVE_RULE。只操作目标目录，不安装依赖，不调用网络，不创建 subagent。输出简短。",
    );
    const options = {
      prompt: "实现一个模块",
      designInstructions: "design.md",
      projectInstructions: "project.md",
    };
    const first = new CodexClient({ cwd, executable, requestTimeoutMs: 180_000 });
    clients.push(first);
    const observed = observe(first);
    const prepared = await first.prepareD2C(options);
    const settings = {
      ...prepared.thread,
      sandbox: "workspace-write" as const,
      approvalPolicy: "on-request" as const,
      approvalsReviewer: "user" as const,
    };
    const started = await first.request("thread/start", settings);
    const threadId = started.thread.id;
    const write = await first.request("turn/start", {
      threadId,
      input: input(
        "创建 calc.mjs，导出 add(a,b) 函数，返回 a+b。只创建这个文件，无需计划或额外说明。",
      ),
    });
    expect(await observed.completed(threadId, write.turn.id)).toMatchObject({
      status: "completed",
      error: null,
    });
    expect((await readFile(join(cwd, "calc.mjs"), "utf8")).split("\n")[0]).toBe(
      "// UI_FORGE_LIVE_RULE",
    );
    await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import {add} from './calc.mjs'; if (add(2,3)!==5) process.exit(1)",
      ],
      { cwd },
    );
    console.log("LIVE: coding and custom rules passed");

    for (const decision of ["accept", "decline"] as const) {
      const filename = join(cwd, `${decision}.txt`);
      const command = `printf '${decision}' > '${filename}'`;
      const approvals: Array<Promise<void>> = [];
      let received = false;
      let unexpected: string | undefined;
      const unsubscribe = first.subscribe((event: CodexEvent) => {
        if (event.type !== "request") return;
        const request = event.request;
        if (
          request.method === "item/commandExecution/requestApproval" &&
          request.params.threadId === threadId &&
          isExactCommand(request.params.command, command)
        ) {
          received = true;
          approvals.push(first.respond(event.token, { decision }));
        } else if (
          request.method === "item/commandExecution/requestApproval" ||
          request.method === "item/fileChange/requestApproval"
        ) {
          unexpected =
            request.method === "item/commandExecution/requestApproval"
              ? (request.params.command ?? request.method)
              : request.method;
          approvals.push(first.respond(event.token, { decision: "decline" }));
        } else {
          unexpected = request.method;
        }
      });
      try {
        const turn = await first.request("turn/start", {
          threadId,
          sandboxPolicy: { type: "readOnly", networkAccess: false },
          input: input(
            `这是一次命令审批协议测试。只用 exec_command 执行以下完整命令，保持命令文本原样：\n${command}\n主动使用 require_escalated 申请本次命令审批，不申请永久权限。拒绝后立即停止，不换工具或重试。`,
          ),
        });
        expect(await observed.completed(threadId, turn.turn.id)).toMatchObject({
          status: "completed",
          error: null,
        });
        await Promise.all(approvals);
        expect(unexpected).toBeUndefined();
        expect(received).toBe(true);
        expect(first.pendingRequests()).toEqual([]);
        if (decision === "accept") expect(await readFile(filename, "utf8")).toBe(decision);
        else await expect(access(filename)).rejects.toMatchObject({ code: "ENOENT" });
        console.log(`LIVE: approval ${decision} passed`);
      } finally {
        unsubscribe();
      }
    }

    const waiting = await first.request("turn/start", {
      threadId,
      input: input("只执行 sleep 30，等待完成后再回复。不要调用其他工具。"),
    });
    await until(() =>
      observed.notifications.some(
        (event) =>
          event.method === "item/started" &&
          event.params.threadId === threadId &&
          event.params.turnId === waiting.turn.id &&
          event.params.item.type === "commandExecution",
      )
        ? true
        : undefined,
    );
    await first.request("turn/interrupt", { threadId, turnId: waiting.turn.id });
    expect(await observed.completed(threadId, waiting.turn.id)).toMatchObject({
      status: "interrupted",
    });
    expect(first.pendingRequests()).toEqual([]);
    await first.close();
    console.log("LIVE: interrupt and close passed");

    const restored = new CodexClient({ cwd, executable, requestTimeoutMs: 180_000 });
    clients.push(restored);
    const restoredEvents = observe(restored);
    const restoredInput = await restored.prepareD2C(options);
    const resumed = await restored.request("thread/resume", {
      ...settings,
      ...restoredInput.thread,
      threadId,
    });
    expect(resumed.cwd).toBe(cwd);
    expect(resumed.approvalPolicy).toBe("on-request");
    expect(resumed.sandbox.type).toBe("workspaceWrite");
    const resumedTurn = await restored.request("turn/start", {
      threadId,
      input: input("创建 resume.mjs，导出 const resumed = true。只创建这个文件，无需说明。"),
    });
    expect(await restoredEvents.completed(threadId, resumedTurn.turn.id)).toMatchObject({
      status: "completed",
      error: null,
    });
    expect((await readFile(join(cwd, "resume.mjs"), "utf8")).split("\n")[0]).toBe(
      "// UI_FORGE_LIVE_RULE",
    );
    const history = await restored.request("thread/read", { threadId, includeTurns: true });
    expect(history.thread.turns.some((turn) => turn.id === write.turn.id)).toBe(true);
    const review = await restored.request("review/start", {
      threadId,
      delivery: "inline",
      target: {
        type: "custom",
        instructions:
          "只读审查 calc.mjs 和 resume.mjs 的实现及项目规则遵循情况，仅报告实际问题，不改文件，不调用 subagent。",
      },
    });
    expect(await restoredEvents.completed(review.reviewThreadId, review.turn.id)).toMatchObject({
      status: "completed",
      error: null,
    });
    console.log("LIVE: resume, persisted history, rules and native review passed");
  },
  600_000,
);

it.skipIf(!live || process.platform === "win32")(
  "stops active native Codex when its host exits, is killed, disconnects or aborts",
  async () => {
    const cwd = await temporary();
    const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
    for (const action of ["exit", "SIGTERM", "SIGKILL", "disconnect", "abort"] as const) {
      const host = fork(
        fileURLToPath(new URL("./testing/liveHost.cjs", import.meta.url)),
        [entry, executable, cwd],
        { stdio: ["ignore", "ignore", "pipe", "ipc"] },
      );
      let ready = false;
      let failed = false;
      let codexPid: number | undefined;
      host.on("message", (message: unknown) => {
        if (message === "ready") ready = true;
        else if (message === "failed") failed = true;
      });
      host.stderr?.resume();
      try {
        await until(() => {
          if (failed) throw new Error("Native lifetime fixture failed");
          return ready ? true : undefined;
        });
        const { stdout } = await promisify(execFile)("pgrep", ["-P", String(host.pid)]);
        const pids = stdout.trim().split(/\s+/).map(Number);
        expect(pids).toHaveLength(1);
        codexPid = pids[0]!;
        if (action === "disconnect") host.disconnect();
        else if (action === "SIGTERM" || action === "SIGKILL") host.kill(action);
        else host.send(action);
        await until(() => {
          try {
            process.kill(codexPid!, 0);
            return undefined;
          } catch {
            return true;
          }
        }, 15_000);
        console.log(`LIVE: host ${action} stopped active Codex`);
      } finally {
        host.kill("SIGKILL");
        if (codexPid) {
          try {
            process.kill(codexPid, "SIGKILL");
          } catch {
            /* Test process already exited. */
          }
        }
      }
    }
  },
  180_000,
);
