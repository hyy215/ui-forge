import { expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
  createCommunicationRequestMessage,
  sessionMethods,
  instructionMethods,
  diagnosticMethods,
  deliveryMethods,
  designMethods,
} from "@ui-forge/shared-protocol";
import { authorizeHostRequest } from "./hostRequestPolicy.js";

const taskOperations = [
  { method: sessionMethods.send, params: { taskId: "task", text: "change" } },
  { method: sessionMethods.stop, params: { taskId: "task", turnId: "turn" } },
  {
    method: sessionMethods.respond,
    params: { taskId: "task", token: "approval-token", result: { decision: "decline" } },
  },
] as const;

function taskSnapshot(cwd: string, taskId = "task") {
  return {
    thread: {
      id: taskId,
      cwd,
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

it.each(taskOperations)(
  "rejects untrusted $method before reading task history",
  async ({ method, params }) => {
    const read = vi.fn();
    await expect(
      authorizeHostRequest(
        createCommunicationRequestMessage("operation", method, params),
        { trusted: false, projectPath: tmpdir() },
        read,
      ),
    ).rejects.toThrow("信任");
    expect(read).not.toHaveBeenCalled();
  },
);

it.each(taskOperations)(
  "requires a workspace for $method before reading task history",
  async ({ method, params }) => {
    const read = vi.fn();
    await expect(
      authorizeHostRequest(
        createCommunicationRequestMessage("operation", method, params),
        { trusted: true },
        read,
      ),
    ).rejects.toThrow("工作区");
    expect(read).not.toHaveBeenCalled();
  },
);

it.each(taskOperations)(
  "rejects a different task identity for $method even in the same directory",
  async ({ method, params }) => {
    const read = vi.fn(async () => taskSnapshot(tmpdir(), "another-task"));
    await expect(
      authorizeHostRequest(
        createCommunicationRequestMessage("operation", method, params),
        { trusted: true, projectPath: tmpdir() },
        read,
      ),
    ).rejects.toThrow("任务");
    expect(read).toHaveBeenCalledExactlyOnceWith("task");
  },
);

it.each(taskOperations)(
  "authorizes $method once for the matching task and canonical directory",
  async ({ method, params }) => {
    const read = vi.fn(async () => taskSnapshot(tmpdir()));
    const message = createCommunicationRequestMessage("operation", method, params);
    await expect(
      authorizeHostRequest(message, { trusted: true, projectPath: tmpdir() }, read),
    ).resolves.toEqual(message);
    expect(read).toHaveBeenCalledExactlyOnceWith("task");
  },
);

it.each(taskOperations)("rejects another workspace for $method", async ({ method, params }) => {
  const read = vi.fn(async () => taskSnapshot("/"));
  await expect(
    authorizeHostRequest(
      createCommunicationRequestMessage("operation", method, params),
      { trusted: true, projectPath: tmpdir() },
      read,
    ),
  ).rejects.toThrow("不一致");
  expect(read).toHaveBeenCalledExactlyOnceWith("task");
});

it("accepts a workspace symlink only when its canonical directory matches the task", async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-forge-host-policy-"));
  const target = join(root, "target");
  const alias = join(root, "alias");
  try {
    await mkdir(target);
    await symlink(target, alias, "dir");
    const read = vi.fn(async () => taskSnapshot(target));
    for (const { method, params } of taskOperations) {
      const message = createCommunicationRequestMessage("operation", method, params);
      await expect(
        authorizeHostRequest(message, { trusted: true, projectPath: alias }, read),
      ).resolves.toEqual(message);
    }
    const create = createCommunicationRequestMessage("create", sessionMethods.create, {
      projectPath: "/ignored-page-path",
      prompt: "task",
    });
    await expect(
      authorizeHostRequest(create, { trusted: true, projectPath: alias }, read),
    ).resolves.toMatchObject({ params: { projectPath: await realpath(target) } });
    expect(read).toHaveBeenCalledTimes(taskOperations.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("requires trust and validates design checks without loading a task", async () => {
  const message = createCommunicationRequestMessage("design", designMethods.check, {
    source: {
      kind: "mastergo",
      url: "https://mastergo.com/file/doc?layer_id=1:2",
      connection: { kind: "vibe" },
    },
  });
  const read = vi.fn();
  await expect(authorizeHostRequest(message, { trusted: false }, read)).rejects.toThrow("信任");
  await expect(authorizeHostRequest(message, { trusted: true }, read)).resolves.toMatchObject({
    params: { source: { connection: { kind: "vibe", endpoint: "http://127.0.0.1:20678/mcp" } } },
  });
  await expect(
    authorizeHostRequest(
      { ...message, params: { source: { kind: "local", command: "run" } } },
      { trusted: true },
      read,
    ),
  ).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
it("forwards read-only diagnostics without loading a task or authorizing mutations", async () => {
  const message = createCommunicationRequestMessage("diagnostics", diagnosticMethods.read, {
    taskId: "known-task",
  });
  const read = vi.fn();
  await expect(authorizeHostRequest(message, { trusted: false }, read)).resolves.toEqual(message);
  expect(read).not.toHaveBeenCalled();
});
it("validates delivery reads without requiring trust, loading history, or accepting a report path", async () => {
  const message = createCommunicationRequestMessage("delivery", deliveryMethods.read, {
    taskId: "known-task",
  });
  const read = vi.fn();
  await expect(authorizeHostRequest(message, { trusted: false }, read)).resolves.toEqual(message);
  await expect(
    authorizeHostRequest(
      { ...message, params: { taskId: "known-task", path: "/private/secret" } },
      { trusted: false },
      read,
    ),
  ).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
it("binds creates to the trusted workspace and rejects untrusted mutations", async () => {
  const message = createCommunicationRequestMessage("r", sessionMethods.create, {
    projectPath: "/other",
    prompt: "task",
    images: [],
  });
  const read = vi.fn();
  await expect(
    authorizeHostRequest(message, { trusted: false, projectPath: tmpdir() }, read),
  ).rejects.toThrow("信任");
  expect(
    (await authorizeHostRequest(message, { trusted: true, projectPath: tmpdir() }, read)).params,
  ).toMatchObject({ projectPath: await realpath(tmpdir()) });
  await expect(
    authorizeHostRequest(
      createCommunicationRequestMessage("r", instructionMethods.save, {}),
      { trusted: false },
      read,
    ),
  ).rejects.toThrow("信任");
  expect(read).not.toHaveBeenCalled();
});
it("rejects cross-workspace input before forwarding it", async () => {
  const message = createCommunicationRequestMessage("r", sessionMethods.send, {
    taskId: "t",
    text: "change",
  });
  const read = vi.fn(async () => ({
    thread: {
      id: "t",
      cwd: "/",
      name: null,
      preview: "task",
      createdAt: 1,
      updatedAt: 1,
      status: { type: "idle" },
      turns: [],
    },
    pendingRequests: [],
  }));
  await expect(
    authorizeHostRequest(message, { trusted: true, projectPath: tmpdir() }, read),
  ).rejects.toThrow("不一致");
});
