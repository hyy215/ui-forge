import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { RestrictedDeepAgent } from "./restrictedDeepAgent.js";

afterEach(() => vi.unstubAllGlobals());

function streamResponse(content: string, finishReason = "stop") {
  const chunk = { id: "test", object: "chat.completion.chunk", created: 1, model: "qwen3.7-plus",
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17,
      completion_tokens_details: { reasoning_tokens: 2 }, prompt_tokens_details: { cached_tokens: 4 } } };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } });
}

const options = { provider: "bailian", model: "qwen3.7-plus", apiKey: "test-key",
  baseUrl: "https://model.invalid/v1", executionMode: "single" as const,
  structuredOutputMode: "json-schema" as const, responseSchema: z.object({ status: z.literal("done") }),
  inference: { thinking: false } };

describe("single structured model invocation", () => {
  it("uses the real SDK to send one schema-constrained request with Bailian parameters", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      requests.push(await new Request(url, init).json());
      return streamResponse('{"status":"done"}');
    }));
    const diagnostics: unknown[] = [];
    const result = await new RestrictedDeepAgent({ ...options, diagnosticReporter: (event) => { diagnostics.push(event); } }).invoke({ messages: [{ role: "user", content: "生成 JSON" }] });
    expect(requests).toHaveLength(1);
    expect(diagnostics).toContainEqual(expect.objectContaining({ status: "turn-completed", model: "qwen3.7-plus",
      inputTokens: 12, reasoningTokens: 2, cacheReadTokens: 4 }));
    expect(requests[0]).toMatchObject({ model: "qwen3.7-plus", enable_thinking: false,
      response_format: { type: "json_schema", json_schema: { strict: true } }, stream: true,
      stream_options: { include_usage: true } });
    expect(requests[0]).not.toHaveProperty("tools");
    expect(result).toMatchObject({ structuredResponse: { status: "done" },
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 } });
  });

  it("routes a single syntax repair to Flash and aggregates actual usage", async () => {
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const request = await new Request(url, init).json() as { model: string };
      models.push(request.model);
      return streamResponse(models.length === 1 ? "{broken" : '{"status":"done"}');
    }));
    const result = await new RestrictedDeepAgent({ ...options, repairModel: {
      provider: "bailian", model: "qwen3.8-flash", apiKey: "test-key",
      baseUrl: options.baseUrl, inference: { thinking: false },
    } }).invoke({ messages: [{ role: "user", content: "生成 JSON" }] });
    expect(models).toEqual(["qwen3.7-plus", "qwen3.8-flash"]);
    expect(result.usage?.totalTokens).toBe(34);
  });

  it("stops on output-budget exhaustion without another repair request", async () => {
    const fetch = vi.fn(async () => streamResponse('{"status":', "length"));
    vi.stubGlobal("fetch", fetch);
    await expect(new RestrictedDeepAgent(options).invoke({ messages: [{ role: "user", content: "生成" }] }))
      .rejects.toThrow("预算上限");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not send a request for an already-cancelled invocation", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(new RestrictedDeepAgent(options).invoke({ messages: [{ role: "user", content: "生成" }],
      signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
