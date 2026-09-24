import { expect, it } from "vitest";
import type { NativeNotification, NativeThread } from "@ui-forge/shared-protocol";
import { currentNativeRetry } from "./currentNativeRetry";

const thread: NativeThread = {
  id: "main",
  cwd: "/tmp/project",
  preview: "",
  name: null,
  createdAt: 1,
  updatedAt: 1,
  status: { type: "active" },
  turns: [{ id: "current", status: "inProgress", items: [], error: null }],
};
const retry: NativeNotification = {
  method: "error",
  params: { threadId: "main", turnId: "current", willRetry: true, error: { message: "retry" } },
};

it("only shows an explicit retry for the current main thread turn", () => {
  expect(currentNativeRetry(thread, [retry])).toBe(true);
  expect(
    currentNativeRetry(thread, [{ ...retry, params: { ...retry.params, threadId: "child" } }]),
  ).toBe(false);
  expect(
    currentNativeRetry(thread, [{ ...retry, params: { ...retry.params, turnId: "old" } }]),
  ).toBe(false);
  expect(
    currentNativeRetry(thread, [{ method: "error", params: { error: { message: "retry" } } }]),
  ).toBe(false);
  expect(
    currentNativeRetry(thread, [{ ...retry, params: { ...retry.params, willRetry: "true" } }]),
  ).toBe(false);
});

it("does not infer retries from text or preserve them after a newer terminal error", () => {
  expect(
    currentNativeRetry(thread, [
      retry,
      { ...retry, params: { ...retry.params, willRetry: false } },
    ]),
  ).toBe(false);
  expect(
    currentNativeRetry(thread, [
      {
        ...retry,
        params: { threadId: "main", turnId: "current", error: { message: "Will retry" } },
      },
    ]),
  ).toBe(false);
});

it.each(["completed", "failed", "interrupted"])("hides old retry activity after %s", (status) => {
  expect(
    currentNativeRetry({ ...thread, turns: [{ id: "current", status, items: [], error: null }] }, [
      retry,
    ]),
  ).toBe(false);
  expect(currentNativeRetry(undefined, [retry])).toBe(false);
});
