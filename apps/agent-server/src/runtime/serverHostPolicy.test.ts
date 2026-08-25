/** 验证 Agent Server 仅接受规范化的本机回环监听地址。 */

import { describe, expect, it } from "vitest";
import { normalizeLoopbackHost } from "./serverHostPolicy.js";

describe("Agent Server host policy", () => {
  it("normalizes supported loopback hosts", () => {
    expect(normalizeLoopbackHost(undefined)).toBe("127.0.0.1");
    expect(normalizeLoopbackHost(" LOCALHOST. ")).toBe("127.0.0.1");
    expect(normalizeLoopbackHost("127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeLoopbackHost("127.42.3.9")).toBe("127.42.3.9");
    expect(normalizeLoopbackHost("::1")).toBe("::1");
    expect(normalizeLoopbackHost("[0:0:0:0:0:0:0:1]")).toBe("::1");
  });

  it.each([
    "0.0.0.0",
    "192.168.1.10",
    "::",
    "server.example.com",
    "127.0.0.1.example.com",
  ])("rejects the non-loopback host %s", (host) => {
    expect(() => normalizeLoopbackHost(host)).toThrow("只允许监听本机 loopback");
  });
});
