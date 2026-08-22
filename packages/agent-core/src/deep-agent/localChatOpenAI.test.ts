/** 验证真实 OpenAI 模型封装在内部统计和工具绑定后仍不会请求远程编码表。 */

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { ChatGeneration } from "@langchain/core/outputs";
import type { ChatOpenAI, ChatOpenAICompletions } from "@langchain/openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocallyTokenizedChatOpenAI } from "./localChatOpenAI.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("locally tokenized ChatOpenAI", () => {
  it("keeps direct, internal completion, and tool-bound token counting offline", async () => {
    const fetchImplementation = vi.fn(async () => {
      throw new Error("network access is forbidden in token counting tests");
    });
    vi.stubGlobal("fetch", fetchImplementation);
    const model = createLocallyTokenizedChatOpenAI({
      model: "qwen3.7-plus",
      apiKey: "test-key",
      streaming: true,
      configuration: { baseURL: "https://model.invalid/v1" },
    });
    const messages = [new HumanMessage("生成客户列表")];

    await expect(model.getNumTokens("客户列表")).resolves.toBeGreaterThan(0);
    await expect(model.getNumTokensFromMessages(messages)).resolves.toMatchObject({
      totalCount: expect.any(Number),
      countPerMessage: [expect.any(Number)],
    });

    const completions = readCompletions(model);
    await expect(completions.getNumTokens("内部流式统计")).resolves.toBeGreaterThan(0);
    await expect(readCompletionEstimator(completions).estimatePrompt(messages))
      .resolves.toBeGreaterThan(0);
    await expect(readCompletionEstimator(completions).estimateGenerations([{
      message: new AIMessage("模型输出"),
      text: "模型输出",
    }])).resolves.toBeGreaterThan(0);

    const boundModel = model.bindTools([{
      type: "function",
      function: {
        name: "review_visual_components",
        description: "Review visual evidence.",
        parameters: { type: "object", properties: {} },
      },
    }]) as ChatOpenAI;
    await expect(boundModel.getNumTokens("工具绑定后")).resolves.toBeGreaterThan(0);
    await expect(readCompletions(boundModel).getNumTokens("绑定后的内部统计"))
      .resolves.toBeGreaterThan(0);

    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

/** 读取 SDK 内部 Completions 委托，仅用于验证实际流式统计路径。 */
function readCompletions(model: ChatOpenAI): ChatOpenAICompletions {
  return (model as unknown as { completions: ChatOpenAICompletions }).completions;
}

/** 将 SDK 受保护的估算方法收窄为测试所需接口。 */
function readCompletionEstimator(completions: ChatOpenAICompletions): {
  estimatePrompt: (messages: HumanMessage[]) => Promise<number>;
  estimateGenerations: (generations: ChatGeneration[]) => Promise<number>;
} {
  const estimator = completions as unknown as {
    _getEstimatedTokenCountFromPrompt: (
      messages: HumanMessage[],
      functions?: unknown,
      functionCall?: unknown,
    ) => Promise<number>;
    _getNumTokensFromGenerations: (generations: ChatGeneration[]) => Promise<number>;
  };
  return {
    estimatePrompt: (messages) => estimator._getEstimatedTokenCountFromPrompt(messages),
    estimateGenerations: (generations) => estimator._getNumTokensFromGenerations(generations),
  };
}
