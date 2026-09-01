/** 验证代码生成 Runner 投影持久结果，并能终止当前活动模型运行。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import { d2cWorkflowMethods, type CodeGenerationStreamEvent } from "@ui-forge/shared-protocol";
import { describe, expect, it, vi } from "vitest";
import { D2CCodeGenerationRunner } from "./d2cCodeGenerationRunner.js";

const taskId = "11111111-1111-4111-8111-111111111111";

describe("D2CCodeGenerationRunner", () => {
  it("streams bounded progress and the persisted Patch review result", async () => {
    const generateCode = vi.fn(async (
      _input: D2CAgent.TaskCommand,
      report?: D2CAgent.CodeGenerationProgressReporter,
    ) => {
      await report?.({ type: "code-context-start", fileCount: 1 });
      await report?.({ type: "code-generation-start", stepCount: 1 });
      await report?.({ type: "patch-application-start", fileCount: 1 });
      await report?.({ type: "patch-application-complete", fileCount: 1, alreadyApplied: false });
      return createReadyTask();
    });
    const runner = new D2CCodeGenerationRunner({ generateCode } as unknown as D2CAgent.Service);
    const events: CodeGenerationStreamEvent[] = [];

    for await (const event of runner.stream(d2cWorkflowMethods.streamCodeGeneration, {
      taskId,
      expectedRevision: 3,
    })) events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      "code-generation-start",
      "code-generation-progress",
      "code-generation-progress",
      "code-generation-progress",
      "code-generation-progress",
      "code-generation-result",
      "code-generation-complete",
    ]);
    expect(events.at(-2)).toMatchObject({
      type: "code-generation-result",
      result: { status: "ready" },
    });
  });

  it("cancels the active generation and emits a stopped event", async () => {
    const generateCode = vi.fn((
      _input: D2CAgent.TaskCommand,
      _report?: D2CAgent.CodeGenerationProgressReporter,
      signal?: AbortSignal,
    ) => new Promise<D2CAgent.Task>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")), { once: true });
    }));
    const runner = new D2CCodeGenerationRunner({ generateCode } as unknown as D2CAgent.Service);
    const iterator = runner.stream(d2cWorkflowMethods.streamCodeGeneration, {
      taskId,
      expectedRevision: 3,
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ value: { type: "code-generation-start" }, done: false });
    const stopped = iterator.next();
    await Promise.resolve();
    expect(runner.cancel(taskId)).toBe(true);
    await expect(stopped).resolves.toEqual({ value: { type: "code-generation-stopped" }, done: false });
  });
});

/** 创建只包含 Runner 投影所需字段的已生成任务。 */
function createReadyTask(): D2CAgent.Task {
  return {
    taskId,
    workspaceId: "workspace",
    revision: 4,
    status: "patch_applied",
    projectPath: "/workspace",
    taskGoal: "实现页面",
    codeGeneration: {
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
            content: "export function Page() { return null; }\n",
            reviewDiff: "--- /dev/null\n+++ b/src/Page.tsx",
          }],
        }],
        warnings: [],
      },
    },
    patchApplication: {
      status: "applied",
      patchSetHash: "a".repeat(64),
      files: [{ path: "src/Page.tsx", action: "create" }],
      alreadyApplied: false,
      appliedAt: "2026-08-28T00:00:00.000Z",
    },
  };
}
