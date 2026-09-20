/** 验证应用错误边界会把渲染异常转换为稳定失败状态。 */

import { describe, expect, it } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";

describe("AppErrorBoundary", () => {
  it("enters the fallback state after a render error", () => {
    expect(AppErrorBoundary.getDerivedStateFromError()).toEqual({ hasError: true });
  });
});
