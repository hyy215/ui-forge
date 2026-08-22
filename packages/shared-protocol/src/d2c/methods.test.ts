/** 验证 D2C 工作流方法名称在统一通信入口中保持唯一。 */
import { describe, expect, it } from "vitest";
import { d2cWorkflowMethods } from "./methods.js";

describe("D2C workflow methods", () => {
  it("uses a unique method name for every workflow operation", () => {
    const methods = Object.values(d2cWorkflowMethods);
    expect(new Set(methods).size).toBe(methods.length);
  });
});
