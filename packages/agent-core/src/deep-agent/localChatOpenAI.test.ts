/** 验证真实 OpenAI 模型封装在内部统计和工具绑定后仍不会请求远程编码表。 */

import { AIMessage, AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatGeneration } from "@langchain/core/outputs";
import { ChatOpenAICompletions, type ChatOpenAI } from "@langchain/openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocallyTokenizedChatOpenAI } from "./localChatOpenAI.js";

afterEach(() => {
  vi.restoreAllMocks();
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

  it("discards a partial stream and retries the same model turn once", async () => {
    const baseStream = vi.spyOn(ChatOpenAICompletions.prototype, "_streamResponseChunks")
      .mockImplementationOnce(async function* () {
        yield createChunk("partial");
        throw Object.assign(new TypeError("terminated"), { code: "UND_ERR_SOCKET" });
      })
      .mockImplementationOnce(async function* () {
        yield createChunk("complete");
      });
    const completions = createTestCompletions();

    await expect(collectStream(completions)).resolves.toEqual(["complete"]);
    expect(baseStream).toHaveBeenCalledTimes(2);
  });

  it("reports a clear error after the model stream retry is exhausted", async () => {
    const baseStream = vi.spyOn(ChatOpenAICompletions.prototype, "_streamResponseChunks")
      .mockImplementationOnce(async function* () {
        yield createChunk("partial");
        throw new TypeError("terminated");
      })
      .mockImplementationOnce(async function* () {
        throw new TypeError("terminated");
      });
    const completions = createTestCompletions();

    await expect(collectStream(completions)).rejects.toThrow(
      "模型流式连接中断，自动重试 1 次后仍然失败：terminated",
    );
    expect(baseStream).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-transient model stream failure", async () => {
    const baseStream = vi.spyOn(ChatOpenAICompletions.prototype, "_streamResponseChunks")
      .mockImplementationOnce(async function* () {
        throw new Error("invalid tool schema");
      });
    const completions = createTestCompletions();

    await expect(collectStream(completions)).rejects.toThrow("invalid tool schema");
    expect(baseStream).toHaveBeenCalledTimes(1);
  });

  it("does not retry an aborted model stream", async () => {
    const aborted = new Error("This operation was aborted");
    aborted.name = "AbortError";
    const baseStream = vi.spyOn(ChatOpenAICompletions.prototype, "_streamResponseChunks")
      .mockImplementationOnce(async function* () {
        throw aborted;
      });
    const completions = createTestCompletions();

    await expect(collectStream(completions)).rejects.toMatchObject({ name: "AbortError" });
    expect(baseStream).toHaveBeenCalledTimes(1);
  });
});

/** 创建不会实际发起网络请求的内部 Completions 实例。 */
function createTestCompletions(): ChatOpenAICompletions {
  return readCompletions(createLocallyTokenizedChatOpenAI({
    model: "qwen3.7-plus",
    apiKey: "test-key",
    streaming: true,
    configuration: { baseURL: "https://model.invalid/v1" },
  }));
}

/** 创建用于验证流缓冲边界的最小生成 chunk。 */
function createChunk(text: string): ChatGenerationChunk {
  return new ChatGenerationChunk({
    text,
    message: new AIMessageChunk({ content: text }),
  });
}

/** 消费一次内部流并仅暴露成功提交给 Deep Agent 的文本。 */
async function collectStream(completions: ChatOpenAICompletions): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of completions._streamResponseChunks(
    [new HumanMessage("生成客户列表")],
    {},
  )) {
    chunks.push(chunk.text);
  }
  return chunks;
}

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
