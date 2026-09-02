/** 验证 Core 内 Deep Agent 在外部调用前执行配置、能力与消息边界校验。 */

import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const deepAgentMocks = vi.hoisted(() => ({
  invoke: vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({
    messages: [{ role: "assistant", content: "done" }],
  })),
  createDeepAgent: vi.fn(() => ({
    invoke: (...args: unknown[]) => deepAgentMocks.invoke(...args),
  })),
  registerHarnessProfile: vi.fn(),
}));
const chatOpenAIMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  completionsConstructor: vi.fn(),
}));

vi.mock("deepagents", () => deepAgentMocks);
vi.mock("@langchain/openai", () => ({
  ChatOpenAI: class ChatOpenAI {
    constructor(options: unknown) {
      chatOpenAIMocks.constructor(options);
    }
  },
  ChatOpenAICompletions: class ChatOpenAICompletions {
    constructor(options: unknown) {
      chatOpenAIMocks.completionsConstructor(options);
    }
  },
}));

import { RestrictedDeepAgent } from "./restrictedDeepAgent.js";
import { ModelStreamRetryExhaustedError } from "./modelTransportFailure.js";

describe("RestrictedDeepAgent", () => {
  it("rejects an empty conversation before creating a model runtime", async () => {
    const agent = new RestrictedDeepAgent();

    await expect(agent.invoke({ messages: [] })).rejects.toThrow("消息不能为空");
  });

  it("requires provider, model, and API key only when invoked", async () => {
    const agent = new RestrictedDeepAgent();

    await expect(agent.invoke({
      messages: [{ role: "user", content: "plan" }],
    })).rejects.toThrow("缺少 MODEL_PROVIDER");
  });

  it("uses safe defaults when system prompt and subagents are not configured", async () => {
    const agent = new RestrictedDeepAgent({
      provider: "openai",
      model: "test-model",
      apiKey: "test-key",
    });

    await expect(agent.invoke({
      messages: [{ role: "user", content: "plan" }],
    })).resolves.toEqual({ response: "done" });

    expect(deepAgentMocks.createDeepAgent).toHaveBeenLastCalledWith(expect.objectContaining({
      subagents: [],
      systemPrompt: "Only use the explicitly supplied tools. Do not access files or run commands.",
    }));
    expect(deepAgentMocks.registerHarnessProfile).toHaveBeenLastCalledWith(
      "openai:test-model",
      expect.objectContaining({ excludedTools: expect.arrayContaining(["task"]) }),
    );
    expect(chatOpenAIMocks.constructor).toHaveBeenLastCalledWith(expect.objectContaining({
      model: "test-model",
      streaming: true,
    }));
    const modelOptions = chatOpenAIMocks.constructor.mock.lastCall?.[0] as Record<string, unknown>;
    expect(modelOptions).not.toHaveProperty("timeout");
    expect(modelOptions).not.toHaveProperty("maxTokens");
    expect(modelOptions).not.toHaveProperty("modelKwargs");
    const modelCalls = deepAgentMocks.createDeepAgent.mock.calls as unknown as Array<[
      Record<string, unknown>,
    ]>;
    const model = modelCalls.at(-1)?.[0].model as {
      getNumTokens(content: string): Promise<number>;
      getNumTokensFromMessages(messages: HumanMessage[]): Promise<{
        totalCount: number;
        countPerMessage: number[];
      }>;
    };
    await expect(model.getNumTokens("客户列表")).resolves.toBeGreaterThan(0);
    await expect(model.getNumTokensFromMessages([
      new HumanMessage("客户列表"),
    ])).resolves.toMatchObject({ totalCount: expect.any(Number), countPerMessage: [expect.any(Number)] });
  });

  it("forwards configured system prompt and subagents while enabling delegation", async () => {
    const subagents = [{
      name: "reviewer",
      description: "Review a proposed plan.",
      systemPrompt: "Review the plan only.",
      tools: [],
    }];
    const agent = new RestrictedDeepAgent({
      provider: "openai",
      model: "test-model",
      apiKey: "test-key",
      staticSubagents: subagents,
      systemPrompt: "Use the configured reviewer when needed.",
    });

    await agent.invoke({ messages: [{ role: "user", content: "plan" }] });

    expect(deepAgentMocks.createDeepAgent).toHaveBeenLastCalledWith(expect.objectContaining({
      subagents: [expect.objectContaining({ name: "reviewer" })],
      systemPrompt: "Use the configured reviewer when needed.",
    }));
    const profile = deepAgentMocks.registerHarnessProfile.mock.lastCall?.[1];
    expect(profile?.excludedTools).not.toContain("task");
  });

  it("creates task-bound subagents and returns validated structured output", async () => {
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({
      invoke: async () => ({ messages: [], structuredResponse: { status: "done" } }),
    });
    const responseSchema = z.object({ status: z.literal("done") });
    const execute = vi.fn(async () => ({ candidates: [] }));
    const agent = new RestrictedDeepAgent({
      provider: "openai",
      model: "test-model",
      apiKey: "test-key",
      responseSchema,
      structuredOutputMode: "tool",
      invocationSubagentFactories: [{
        create: (context) => [{
          name: "component-analyzer",
          description: "Analyze design component candidates.",
          systemPrompt: "Use the supplied tool only.",
          responseSchema,
          tools: [{
            name: "read_candidates",
            description: "Read task-bound candidates.",
            schema: z.object({}),
            execute,
          }],
        }],
      }],
    });

    await expect(agent.invoke({
      messages: [{ role: "user", content: "analyze" }],
      context: { taskId: "task-1", values: { artifactId: "artifact-1" } },
    })).resolves.toEqual({
      response: '{"status":"done"}',
      structuredResponse: { status: "done" },
    });

    const calls = deepAgentMocks.createDeepAgent.mock.calls as unknown as Array<[
      Record<string, unknown>,
    ]>;
    expect(calls.at(-1)?.[0]).toMatchObject({
      subagents: [expect.objectContaining({
        name: "component-analyzer",
        tools: [expect.any(Object)],
      })],
      responseFormat: expect.anything(),
    });
  });

  it("parses JSON text without configuring a forced structured-output tool", async () => {
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({
      invoke: async () => ({
        messages: [{ role: "assistant", content: '{"status":"done"}' }],
      }),
    });
    const agent = new RestrictedDeepAgent({
      provider: "qwen",
      model: "thinking-model",
      apiKey: "test-key",
      responseSchema: z.object({ status: z.literal("done") }),
      toolFactories: [{
        create: () => [{
          name: "review_visual_components",
          description: "Review visual components.",
          schema: z.object({}),
          execute: async () => ({ suggestions: [] }),
        }],
      }],
    });

    await expect(agent.invoke({
      messages: [{ role: "user", content: "analyze" }],
    })).resolves.toEqual({
      response: '{"status":"done"}',
      structuredResponse: { status: "done" },
    });

    const calls = deepAgentMocks.createDeepAgent.mock.calls as unknown as Array<[
      Record<string, unknown>,
    ]>;
    const configuration = calls.at(-1)?.[0];
    expect(configuration).not.toHaveProperty("responseFormat");
    expect(configuration).toMatchObject({ tools: [expect.any(Object)] });
    expect(configuration?.systemPrompt as string).toContain("最终响应必须只包含一个");
    expect(configuration?.systemPrompt as string).toContain('"status"');
  });

  it("repairs malformed JSON once with an isolated tool-free Agent", async () => {
    const schema = z.object({ status: z.literal("done") });
    const agent = new RestrictedDeepAgent({
      provider: "qwen",
      model: "thinking-model",
      apiKey: "test-key",
      responseSchema: schema,
      toolFactories: [{
        create: () => [{
          name: "review_visual_components",
          description: "Review visual components.",
          schema: z.object({}),
          execute: async () => ({ suggestions: [] }),
        }],
      }],
    });
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({
      invoke: async () => ({
        messages: [{
          role: "assistant",
          content: '{"status" "done"}',
          usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        }],
      }),
    });
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({
      invoke: async () => ({
        messages: [{
          role: "assistant",
          content: '{"status":"done"}',
          usage_metadata: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
        }],
      }),
    });

    await expect(agent.invoke({
      messages: [{ role: "user", content: "analyze" }],
    })).resolves.toEqual({
      response: '{"status":"done"}',
      structuredResponse: { status: "done" },
      usage: { inputTokens: 18, outputTokens: 7, totalTokens: 25 },
    });

    const calls = deepAgentMocks.createDeepAgent.mock.calls as unknown as Array<[
      Record<string, unknown>,
    ]>;
    expect(calls.at(-2)?.[0]).toMatchObject({ tools: [expect.any(Object)] });
    expect(calls.at(-1)?.[0]).toMatchObject({
      name: "ui_forge_json_repair_agent",
      tools: [],
      subagents: [],
    });
    expect(calls.at(-1)?.[0]).not.toHaveProperty("responseFormat");
  });

  it("rejects a second malformed JSON response without retrying again", async () => {
    const agent = new RestrictedDeepAgent({
      provider: "qwen",
      model: "thinking-model",
      apiKey: "test-key",
      responseSchema: z.object({ status: z.literal("done") }),
    });
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({
      invoke: async () => ({ messages: [{ role: "assistant", content: "result: done" }] }),
    });
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({
      invoke: async () => ({ messages: [{ role: "assistant", content: "still invalid" }] }),
    });

    await expect(agent.invoke({
      messages: [{ role: "user", content: "analyze" }],
    })).rejects.toThrow("模型 JSON 校正重试失败");
  });

  it("rejects schema-invalid JSON without treating it as a syntax repair", async () => {
    const schema = z.object({ status: z.literal("done") });
    const agent = new RestrictedDeepAgent({
      provider: "qwen",
      model: "thinking-model",
      apiKey: "test-key",
      responseSchema: schema,
    });

    deepAgentMocks.createDeepAgent.mockReturnValueOnce({
      invoke: async () => ({ messages: [{ role: "assistant", content: '{"status":"failed"}' }] }),
    });
    await expect(agent.invoke({
      messages: [{ role: "user", content: "analyze" }],
    })).rejects.toThrow();
  });

  it("repairs schema-invalid JSON once when explicitly enabled and reports safe issue paths", async () => {
    const diagnostics: unknown[] = [];
    const agent = new RestrictedDeepAgent({
      provider: "qwen",
      model: "thinking-model",
      apiKey: "test-key",
      responseSchema: z.object({ status: z.literal("done"), items: z.array(z.string()) }),
      repairSchemaInvalidResponse: true,
      diagnosticStage: "visual-analysis",
      diagnosticReporter: (event) => { diagnostics.push(event); },
    });
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({
      invoke: async () => ({
        messages: [{ role: "assistant", content: '{"status":"failed","items":null}' }],
      }),
    });
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({
      invoke: async () => ({
        messages: [{ role: "assistant", content: '{"status":"done","items":[]}' }],
      }),
    });

    await expect(agent.invoke({
      messages: [{ role: "user", content: "analyze" }],
      context: { taskId: "task-1", values: {} },
    })).resolves.toMatchObject({ structuredResponse: { status: "done", items: [] } });

    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: "structured-output-invalid",
        validationIssueCount: 2,
        validationIssuePaths: expect.arrayContaining([
          "status:invalid_value",
          "items:invalid_type",
        ]),
      }),
      expect.objectContaining({ status: "structured-output-repaired" }),
    ]));
    expect(JSON.stringify(diagnostics)).not.toContain("failed");
    expect(JSON.stringify(diagnostics)).not.toContain("null");
  });

  it("rejects a second schema-invalid response after the opt-in repair", async () => {
    const agent = new RestrictedDeepAgent({
      provider: "qwen",
      model: "thinking-model",
      apiKey: "test-key",
      responseSchema: z.object({ status: z.literal("done") }),
      repairSchemaInvalidResponse: true,
    });
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({
      invoke: async () => ({ messages: [{ role: "assistant", content: '{"status":"failed"}' }] }),
    });
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({
      invoke: async () => ({ messages: [{ role: "assistant", content: '{"status":"failed-again"}' }] }),
    });

    await expect(agent.invoke({
      messages: [{ role: "user", content: "analyze" }],
    })).rejects.toThrow("模型 JSON 校正重试失败");
  });

  it("forwards an invocation abort signal to the Deep Agent runtime", async () => {
    const invoke = vi.fn(async () => ({ messages: [{ role: "assistant", content: "done" }] }));
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({ invoke });
    const agent = new RestrictedDeepAgent({
      provider: "openai",
      model: "test-model",
      apiKey: "test-key",
    });
    const controller = new AbortController();

    await agent.invoke({
      messages: [{ role: "user", content: "analyze" }],
      signal: controller.signal,
    });

    expect(invoke).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        signal: controller.signal,
        callbacks: [expect.any(Object)],
      }),
    );
  });

  it("does not replay the whole Deep Agent after a transient model failure", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("terminated"));
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({ invoke });
    const agent = new RestrictedDeepAgent({
      provider: "qwen",
      model: "test-model",
      apiKey: "test-key",
    });

    await expect(agent.invoke({
      messages: [{ role: "user", content: "analyze" }],
    })).rejects.toThrow("当前调用无法安全整体重放");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("reports safe diagnostics without replaying the whole Deep Agent", async () => {
    const invoke = vi.fn()
      .mockRejectedValue(Object.assign(new Error("terminated"), { code: "UND_ERR_SOCKET" }));
    const diagnostics: unknown[] = [];
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({ invoke });
    const agent = new RestrictedDeepAgent({
      provider: "qwen",
      model: "test-model",
      apiKey: "test-key",
      diagnosticStage: "visual-analysis",
      diagnosticReporter: (event) => { diagnostics.push(event); },
    });

    await expect(agent.invoke({
      messages: [{ role: "user", content: "analyze" }],
      context: { taskId: "task-1", values: {} },
    })).rejects.toThrow("当前调用无法安全整体重放");

    expect(diagnostics).toEqual([
      expect.objectContaining({ taskId: "task-1", stage: "visual-analysis", attempt: 1, status: "started" }),
      expect.objectContaining({ attempt: 1, status: "failed", errorName: "Error", errorCode: "UND_ERR_SOCKET", retryable: true }),
    ]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(diagnostics)).not.toContain("terminated");
    expect(JSON.stringify(diagnostics)).not.toContain("analyze");
  });

  it("preserves the clear error produced after the model stream retry is exhausted", async () => {
    const invoke = vi.fn().mockRejectedValue(
      new ModelStreamRetryExhaustedError(new TypeError("terminated")),
    );
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({ invoke });
    const agent = new RestrictedDeepAgent({
      provider: "qwen",
      model: "test-model",
      apiKey: "test-key",
    });

    await expect(agent.invoke({
      messages: [{ role: "user", content: "analyze" }],
    })).rejects.toThrow("模型流式连接中断，自动重试 1 次后仍然失败：terminated");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not automatically replay an invocation that contains controlled tools", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("terminated"));
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({ invoke });
    const agent = new RestrictedDeepAgent({
      provider: "qwen",
      model: "test-model",
      apiKey: "test-key",
      toolFactories: [{
        create: () => [{
          name: "read_task_context",
          description: "Read task-bound context.",
          schema: z.object({}),
          execute: async () => ({}),
        }],
      }],
    });

    await expect(agent.invoke({
      messages: [{ role: "user", content: "analyze" }],
    })).rejects.toThrow("当前调用无法安全整体重放");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not retry an aborted model invocation", async () => {
    const aborted = new Error("This operation was aborted");
    aborted.name = "AbortError";
    const invoke = vi.fn().mockRejectedValue(aborted);
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({ invoke });
    const agent = new RestrictedDeepAgent({
      provider: "qwen",
      model: "test-model",
      apiKey: "test-key",
    });

    await expect(agent.invoke({
      messages: [{ role: "user", content: "analyze" }],
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("returns model token usage reported by Deep Agent messages", async () => {
    deepAgentMocks.createDeepAgent.mockReturnValueOnce({
      invoke: async () => ({
        messages: [{
          role: "assistant",
          content: "done",
          usage_metadata: { input_tokens: 80, output_tokens: 20, total_tokens: 100 },
        }],
      }),
    });
    const agent = new RestrictedDeepAgent({
      provider: "openai",
      model: "test-model",
      apiKey: "test-key",
    });

    await expect(agent.invoke({
      messages: [{ role: "user", content: "analyze" }],
    })).resolves.toEqual({
      response: "done",
      usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
    });
  });

  it("converts a safe inline image to a LangChain image_url block", async () => {
    const agent = new RestrictedDeepAgent({
      provider: "openai",
      model: "test-model",
      apiKey: "test-key",
    });

    await agent.invoke({
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "review" },
          { type: "image", dataUrl: "data:image/png;base64,aGVsbG8=", detail: "low" },
        ],
      }],
    });

    expect(deepAgentMocks.invoke).toHaveBeenLastCalledWith({
      messages: [expect.objectContaining({
        content: [
          { type: "text", text: "review" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,aGVsbG8=", detail: "low" },
          },
        ],
      })],
    }, expect.objectContaining({ callbacks: [expect.any(Object)] }));
  });

  it("rejects external and SVG image inputs", async () => {
    const agent = new RestrictedDeepAgent({
      provider: "openai",
      model: "test-model",
      apiKey: "test-key",
    });

    await expect(agent.invoke({ messages: [{
      role: "user",
      content: [{ type: "image", dataUrl: "https://example.com/image.png" }],
    }] })).rejects.toThrow("base64 data URL");
    await expect(agent.invoke({ messages: [{
      role: "user",
      content: [{ type: "image", dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" }],
    }] })).rejects.toThrow("base64 data URL");
  });
});
