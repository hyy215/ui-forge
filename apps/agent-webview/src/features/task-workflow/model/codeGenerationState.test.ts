/** 验证代码生成局部状态只接受真实流事件，并保留可恢复 Patch 结果。 */

import { describe, expect, it } from "vitest";
import { createCodeGenerationState, reduceCodeGenerationState } from "./codeGenerationState";

describe("code generation state", () => {
  it("moves from explicit generation to a ready Patch result", () => {
    let state = createCodeGenerationState({ status: "idle" });
    state = reduceCodeGenerationState(state, { type: "stream-started" });
    state = reduceCodeGenerationState(state, {
      type: "stream-event",
      event: {
        type: "code-generation-progress",
        phase: "reading-context",
        summary: "重新读取文件",
      },
    });
    state = reduceCodeGenerationState(state, {
      type: "stream-event",
      event: {
        type: "code-generation-result",
        result: {
          status: "ready",
          patchSet: {
            patchSetHash: "a".repeat(64),
            planVersion: 1,
            planHash: "b".repeat(64),
            summary: "候选代码",
            patches: [{
              stepId: "layout",
              patchHash: "c".repeat(64),
              operations: [{
                path: "src/Page.tsx",
                action: "create",
                beforeHash: null,
                afterHash: "d".repeat(64),
                reviewDiff: "--- /dev/null\n+++ b/src/Page.tsx",
              }],
            }],
            warnings: [],
          },
          application: {
            status: "applied",
            patchSetHash: "a".repeat(64),
            files: [{ path: "src/Page.tsx", action: "create" }],
            alreadyApplied: false,
            appliedAt: "2026-08-28T00:00:00.000Z",
          },
          deliveryCommands: { status: "pending" },
          deliveryValidation: { status: "pending" },
        },
      },
    });

    expect(state.status).toBe("ready");
    expect(state.progress).toHaveLength(1);
    expect(state.result.status).toBe("ready");
  });

  it("keeps stopped runs distinct from model or validation errors", () => {
    const state = reduceCodeGenerationState(
      createCodeGenerationState({ status: "idle" }),
      { type: "stream-event", event: { type: "code-generation-stopped" } },
    );
    expect(state).toMatchObject({ status: "stopped", streamActive: false, errorMessage: null });
  });
});
