import { describe, expect, it } from "vitest";
import { readStageModelConfiguration } from "./stageModelConfiguration.js";

describe("stage model configuration", () => {
  it("selects independent Bailian stages with explicit thinking controls", () => {
    const options = readStageModelConfiguration({ MODEL_PROFILE: "bailian-balanced", MODEL_API_KEY: "test-key" });
    expect(options).toMatchObject({ provider: "bailian", model: "qwen3.7-plus", structuredOutputMode: "json-schema",
      inference: { thinking: true, thinkingBudget: 4096 },
      visualModel: { model: "qwen3.7-plus", inference: { thinking: false } },
      repairModel: { model: "qwen3.8-flash", inference: { thinking: false } } });
  });

  it("preserves explicit legacy model and endpoint configuration", () => {
    const options = readStageModelConfiguration({ MODEL_PROVIDER: "qwen", MODEL_NAME: "existing-model",
      MODEL_BASE_URL: "https://model.invalid/v1", MODEL_API_KEY: "test-key" });
    expect(options).toMatchObject({ model: "existing-model", structuredOutputMode: "json-text",
      visualModel: { model: "existing-model", baseUrl: "https://model.invalid/v1" } });
    expect(options).not.toHaveProperty("inference");
  });

  it("keeps Bailian as the endpoint provider for DeepSeek planning overrides", () => {
    const options = readStageModelConfiguration({ MODEL_PROFILE: "bailian-balanced",
      MODEL_PLAN_NAME: "deepseek-v4-pro-0813" });
    expect(options).toMatchObject({ provider: "bailian", model: "deepseek-v4-pro-0813",
      structuredOutputMode: "json-text", inference: { thinking: true, reasoningEffort: "low" },
      visualModel: { model: "qwen3.7-plus", structuredOutputMode: "json-schema" } });
  });

  it.each([
    { MODEL_PLAN_THINKING: "yes" },
    { MODEL_PLAN_THINKING_BUDGET: "-1" },
    { MODEL_PLAN_THINKING_BUDGET: "4096", MODEL_PLAN_REASONING_EFFORT: "low" },
    { MODEL_VISION_THINKING: "false", MODEL_VISION_THINKING_BUDGET: "1000" },
    { MODEL_PLAN_NAME: "deepseek-v4-pro", MODEL_PLAN_STRUCTURED_OUTPUT_MODE: "json-schema" },
  ])("rejects incompatible startup parameters before inference: %j", (extra) => {
    expect(() => readStageModelConfiguration({ MODEL_PROFILE: "bailian-balanced", ...extra })).toThrow();
  });
});
