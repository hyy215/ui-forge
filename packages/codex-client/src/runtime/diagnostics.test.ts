import { expect, it } from "vitest";
import { StderrTail } from "./diagnostics.js";

it("bounds diagnostics and drops a truncated secret-bearing line instead of exposing its tail", () => {
  const tail = new StderrTail();
  tail.append(Buffer.from(`Authorization: ${"x".repeat(20_000)}`));
  expect(tail.read()).toBe("[truncated stderr line omitted]");
  tail.append(Buffer.from("\nLast useful error\n"));
  expect(tail.read()).toBe("Last useful error");
  expect(tail.read().length).toBeLessThan(16 * 1024);
});

it("preserves fragmented UTF-8 and removes ANSI colors before redacting credentials", () => {
  const tail = new StderrTail();
  for (const byte of Buffer.from(
    "配置失败\n\x1b[31mCookie: private=value\x1b[0m\nurl?api_key=secret-value\n",
  ))
    tail.append(Buffer.from([byte]));
  expect(tail.read()).toContain("配置失败");
  expect(tail.read()).not.toContain("private=value");
  expect(tail.read()).not.toContain("secret-value");
  tail.append(Buffer.from("token\n".repeat(2_000)));
  expect(tail.read().length).toBeLessThanOrEqual(16 * 1024);
});
