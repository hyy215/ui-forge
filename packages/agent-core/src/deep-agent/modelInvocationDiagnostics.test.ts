/** 验证模型流式诊断仅汇报轮次时序和聚合计数，不泄露模型正文。 */

import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createModelTurnDiagnosticObserver,
  type ModelInvocationDiagnostic,
} from "./modelInvocationDiagnostics.js";

interface TestCallbackMethods {
  handleChatModelStart: (model: unknown, messages: unknown, runId: string) => Promise<void>;
  handleLLMNewToken: (
    token: string,
    indices: { prompt: number; completion: number },
    runId: string,
  ) => Promise<void>;
  handleLLMEnd: (output: unknown, runId: string) => Promise<void>;
  handleLLMError: (error: unknown, runId: string) => Promise<void>;
}

describe("model invocation diagnostics", () => {
  afterEach(() => vi.useRealTimers());

  it("distinguishes model turns and never includes streamed content", async () => {
    const diagnostics: ModelInvocationDiagnostic[] = [];
    const observer = createModelTurnDiagnosticObserver({
      taskId: "task-1",
      stage: "plan-generation",
      attempt: 1,
      reporter: (event) => { diagnostics.push(event); },
    });
    const callback = asTestCallback(observer.callback);

    await callback.handleChatModelStart({}, [["private prompt"]], "run-1");
    await callback.handleLLMNewToken("private response", { prompt: 0, completion: 0 }, "run-1");
    await callback.handleLLMEnd({}, "run-1");
    await callback.handleChatModelStart({}, [["second private prompt"]], "run-2");
    await callback.handleLLMNewToken("second private response", { prompt: 0, completion: 0 }, "run-2");
    await callback.handleLLMEnd({}, "run-2");
    observer.dispose();

    expect(diagnostics.map(({ status, turn }) => ({ status, turn }))).toEqual([
      { status: "turn-started", turn: 1 },
      { status: "first-token", turn: 1 },
      { status: "turn-completed", turn: 1 },
      { status: "turn-started", turn: 2 },
      { status: "first-token", turn: 2 },
      { status: "turn-completed", turn: 2 },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("private");
  });

  it("reports a silent model turn every thirty seconds before its first chunk", async () => {
    vi.useFakeTimers();
    const diagnostics: ModelInvocationDiagnostic[] = [];
    const observer = createModelTurnDiagnosticObserver({
      stage: "visual-analysis",
      attempt: 1,
      reporter: (event) => { diagnostics.push(event); },
    });
    const callback = asTestCallback(observer.callback);

    await callback.handleChatModelStart({}, [], "run-silent");
    await vi.advanceTimersByTimeAsync(30_000);

    expect(diagnostics).toContainEqual(expect.objectContaining({
      status: "stream-progress",
      turn: 1,
      elapsedMs: 30_000,
      idleMs: 30_000,
      chunkCount: 0,
    }));
    observer.dispose();
  });

  it("ends the current turn with aggregate counts when the model fails", async () => {
    const diagnostics: ModelInvocationDiagnostic[] = [];
    const observer = createModelTurnDiagnosticObserver({
      stage: "visual-analysis",
      attempt: 1,
      reporter: (event) => { diagnostics.push(event); },
    });
    const callback = asTestCallback(observer.callback);

    await callback.handleChatModelStart({}, [], "run-failed");
    await callback.handleLLMNewToken("secret", { prompt: 0, completion: 0 }, "run-failed");
    await callback.handleLLMError(new Error("credential-value"), "run-failed");
    observer.dispose();

    expect(diagnostics.at(-1)).toEqual(expect.objectContaining({
      status: "turn-failed",
      turn: 1,
      chunkCount: 1,
      errorName: "Error",
    }));
    expect(JSON.stringify(diagnostics)).not.toContain("credential-value");
    expect(JSON.stringify(diagnostics)).not.toContain("secret");
  });
});

/** 将正式回调收窄到测试需要触发的四个模型生命周期方法。 */
function asTestCallback(callback: BaseCallbackHandler): TestCallbackMethods {
  return callback as unknown as TestCallbackMethods;
}
