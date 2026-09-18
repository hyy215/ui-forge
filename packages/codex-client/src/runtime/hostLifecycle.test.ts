import { afterEach, expect, it, vi } from "vitest";
import { bindHostLifecycle } from "./hostLifecycle.js";

const removers: Array<() => void> = [];
afterEach(() => {
  for (const remove of removers.splice(0)) remove();
  vi.restoreAllMocks();
});

it("shares host listeners, closes all connections on IPC disconnect, and removes listeners after release", async () => {
  const before = process.listenerCount("disconnect");
  const first = vi.fn(async () => {});
  const second = vi.fn(async () => {});
  const removeFirst = bindHostLifecycle(first);
  const removeSecond = bindHostLifecycle(second);
  removers.push(removeFirst, removeSecond);
  expect(process.listenerCount("disconnect")).toBe(before + 1);
  process.emit("disconnect");
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
  removeFirst();
  removeSecond();
  expect(process.listenerCount("disconnect")).toBe(before);
});

it("cleans up on a host signal without re-sending the signal to an existing host handler", async () => {
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  const hostHandler = vi.fn();
  process.on("SIGTERM", hostHandler);
  removers.push(() => process.off("SIGTERM", hostHandler));
  const close = vi.fn(async () => {
    remove();
  });
  const remove = bindHostLifecycle(close);
  removers.push(remove);
  process.emit("SIGTERM");
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(hostHandler).toHaveBeenCalledOnce();
  expect(kill).not.toHaveBeenCalled();
});
