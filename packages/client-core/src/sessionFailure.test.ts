import { expect, it } from "vitest";
import { getSessionFailure } from "./sessionFailure.js";

it.each([{ codexErrorInfo: "serverOverloaded" }, { codex_error_info: "server_overloaded" }])(
  "recognizes native and persisted capacity errors: %j",
  (code) => {
    expect(getSessionFailure({ ...code, message: "Selected model is at capacity." })).toEqual({
      title: "模型暂时繁忙",
      message: "模型服务暂时没有可用容量，本轮未能完成。",
      guidance: expect.stringContaining("服务不一定已经恢复"),
      details: "Selected model is at capacity.",
      canContinue: true,
    });
  },
);

it.each([
  ["contextWindowExceeded", "会话上下文已达上限"],
  ["usageLimitExceeded", "使用额度已达上限"],
  ["sessionBudgetExceeded", "会话预算已达上限"],
  ["rateLimitExceeded", "请求频率已达上限"],
])("does not classify %s as unavailable model capacity", (code, title) => {
  expect(getSessionFailure({ codexErrorInfo: code, message: "Original error" })).toEqual({
    title,
    message: expect.any(String),
    guidance: expect.any(String),
    details: "Original error",
    canContinue: false,
  });
});

it.each([
  { codexErrorInfo: "other", message: "Selected model is at capacity." },
  { message: "Unrecognized failure" },
  { codexErrorInfo: { serverOverloaded: {} }, message: "Malformed capacity" },
  { codexErrorInfo: "__proto__", message: "Unknown code" },
  { codexErrorInfo: { httpConnectionFailed: null }, message: "Malformed connection" },
  { codexErrorInfo: { responseStreamDisconnected: "bad" }, message: "Malformed stream" },
  { codexErrorInfo: "httpConnectionFailed", message: "Malformed variant" },
])("preserves unclassified errors without guessing capacity: %j", (error) => {
  expect(getSessionFailure(error)).toEqual({
    title: "Codex 返回错误",
    message: "本轮执行失败，尚不能确定具体原因。",
    guidance: expect.stringContaining("不要仅凭错误文字推断"),
    details: error.message,
    canContinue: false,
  });
});

it("handles absent, string and malformed errors", () => {
  expect(getSessionFailure(null)).toBeUndefined();
  expect(getSessionFailure(undefined)).toBeUndefined();
  expect(getSessionFailure("Failure")).toEqual({
    title: "Codex 返回错误",
    message: "本轮执行失败，尚不能确定具体原因。",
    guidance: expect.any(String),
    details: "Failure",
    canContinue: false,
  });
  expect(getSessionFailure({ message: 12, token: "secret" })?.details).toBe(
    "未提供可显示的错误信息。",
  );
});

it.each([
  [{ httpConnectionFailed: { httpStatusCode: 503 } }, "上游服务连接失败"],
  [{ responseStreamConnectionFailed: { httpStatusCode: null } }, "模型响应中断"],
  [{ response_stream_disconnected: { http_status_code: 502 } }, "模型响应中断"],
  [{ responseTooManyFailedAttempts: { httpStatusCode: 429 } }, "模型响应中断"],
  ["unauthorized", "身份验证失败"],
  ["sandboxError", "沙箱执行受限"],
  ["badRequest", "请求未被接受"],
])("explains explicit failure codes without reclassifying them as capacity: %j", (code, title) => {
  const result = getSessionFailure({
    codexErrorInfo: code,
    message: "Original failure",
    privateData: "secret",
  });
  expect(result).toMatchObject({ title, canContinue: false, details: "Original failure" });
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(result?.message).not.toContain("Original failure");
});

it("does not stringify arbitrary objects and bounds raw messages", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(getSessionFailure(cyclic)?.details).toBe("未提供可显示的错误信息。");
  expect(getSessionFailure(1n)?.canContinue).toBe(false);
  const failure = getSessionFailure({ message: "x".repeat(20_000), codexErrorInfo: "other" });
  expect(failure?.details.length).toBeLessThan(12_100);
  expect(failure?.details).toContain("已截断");
});
