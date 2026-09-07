import { describe, expect, it } from "vitest";
import { createModelInferenceParameters, resolveModelConnection } from "./modelInferenceConfiguration.js";

describe("Bailian inference capabilities", () => {
  it("routes Bailian DeepSeek to the Bailian endpoint", () => {
    expect(resolveModelConnection({ provider: "bailian", model: "deepseek-v4-pro-0813", apiKey: "test" }).baseUrl)
      .toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
  });
  it("translates Qwen thinking budgets without arbitrary request parameters", () => {
    expect(createModelInferenceParameters({ provider: "bailian", model: "qwen3.7-plus",
      inference: { thinking: true, thinkingBudget: 4096 } }))
      .toEqual({ enable_thinking: true, thinking_budget: 4096 });
  });
  it.each([
    { provider: "deepseek", model: "deepseek-v4-pro-0813", inference: { thinking: true } },
    { provider: "bailian", model: "deepseek-v4-pro", inference: { reasoningEffort: "low" as const } },
    { provider: "bailian", model: "deepseek-v4-pro-0813", inference: { thinkingBudget: 4096 } },
    { provider: "bailian", model: "qwen3.8-max", inference: { thinkingBudget: 4096, reasoningEffort: "low" as const } },
  ])("rejects unsupported model/parameter combinations", (options) => {
    expect(() => createModelInferenceParameters(options)).toThrow();
  });
});
