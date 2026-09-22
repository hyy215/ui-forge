import { expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { realpath } from "node:fs/promises";
import {
  createCommunicationRequestMessage,
  sessionMethods,
  instructionMethods,
  diagnosticMethods,
  designMethods,
} from "@ui-forge/shared-protocol";
import { authorizeHostRequest } from "./hostRequestPolicy.js";
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
