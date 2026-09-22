import { expect, it } from "vitest";
import { getSessionFailure } from "./sessionFailure.js";

it.each([{ codexErrorInfo: "serverOverloaded" }, { codex_error_info: "server_overloaded" }])(
  "recognizes native and persisted capacity errors: %j",
  (code) => {
    expect(getSessionFailure({ ...code, message: "Selected model is at capacity." })).toEqual({
      title: "模型暂时繁忙",
      message: expect.stringContaining("Selected model is at capacity."),
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
    message: expect.stringContaining("Original error"),
    canContinue: false,
  });
});

it.each([
  { codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 503 } }, message: "Unavailable" },
  { codexErrorInfo: "other", message: "Selected model is at capacity." },
  { message: "Unrecognized failure" },
])("preserves unclassified errors without guessing capacity: %j", (error) => {
  expect(getSessionFailure(error)).toEqual({
    title: "Codex 返回错误",
    message: error.message,
    canContinue: false,
  });
});

it("handles absent, string and malformed errors", () => {
  expect(getSessionFailure(null)).toBeUndefined();
  expect(getSessionFailure(undefined)).toBeUndefined();
  expect(getSessionFailure("Failure")).toEqual({
    title: "Codex 返回错误",
    message: "Failure",
    canContinue: false,
  });
  expect(getSessionFailure({ message: 12 })?.message).toBe('{"message":12}');
});
