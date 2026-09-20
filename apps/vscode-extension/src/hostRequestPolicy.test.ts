import { expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { realpath } from "node:fs/promises";
import {
  createCommunicationRequestMessage,
  sessionMethods,
  instructionMethods,
} from "@ui-forge/shared-protocol";
import { authorizeHostRequest } from "./hostRequestPolicy.js";
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
