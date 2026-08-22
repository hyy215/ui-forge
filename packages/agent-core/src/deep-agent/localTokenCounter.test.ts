/** 验证本地 Token 统计不访问网络并能处理中文和结构化文本块。 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { countMessageTokensLocally } from "./localTokenCounter.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local token counter", () => {
  it("counts text locally without fetching a remote encoding", () => {
    const fetchImplementation = vi.fn();
    vi.stubGlobal("fetch", fetchImplementation);

    const count = countMessageTokensLocally("生成客户列表并保留 React component structure");

    expect(count).toBeGreaterThan(0);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("counts only text from structured message content", () => {
    const count = countMessageTokensLocally([
      { type: "text", text: "客户列表" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
    ]);

    expect(count).toBe(countMessageTokensLocally("客户列表"));
  });
});
