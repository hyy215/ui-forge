/** 验证持久确认状态恢复，以及任务重置会等待活动分析并使用最新 revision。 */

import { describe, expect, it, vi } from "vitest";
import type { D2CWorkflowSnapshot } from "@ui-forge/shared-protocol";
import type { TaskWorkflowDataSource } from "../../../data-sources/task-workflow";
import { hasStartedConversation, resetTaskWorkflow } from "./useTaskWorkflow";

describe("hasStartedConversation", () => {
  it("keeps an inspected SVG behind explicit confirmation", () => {
    const snapshot = createSnapshot(2);
    snapshot.workflowPhase = "svg_ready";
    snapshot.state = { phase: "svg", status: "svg_ready" };
    expect(hasStartedConversation(snapshot)).toBe(false);
  });

  it("restores a persisted design confirmation before analysis finishes", () => {
    const snapshot = createSnapshot(3);
    snapshot.workflowPhase = "design_confirmed";
    snapshot.state = { phase: "conversation", status: "design_confirmed" };
    expect(hasStartedConversation(snapshot)).toBe(true);
  });

  it("restores confirmation after analysis has completed", () => {
    const snapshot = createSnapshot(4);
    snapshot.workflowPhase = "analysis_ready";
    snapshot.state = { phase: "conversation", status: "analysis_ready" };
    expect(hasStartedConversation(snapshot)).toBe(true);
  });
});

describe("resetTaskWorkflow", () => {
  it("cancels and waits for an active run before resetting the latest revision", async () => {
    let finishRun = (): void => {};
    const activeRun = new Promise<void>((resolve) => { finishRun = resolve; });
    const latest = createSnapshot(3);
    const resetSnapshot = createSnapshot(4);
    const cancelConversation = vi.fn(async () => {
      finishRun();
      return { cancelled: true };
    });
    const getSnapshot = vi.fn(async () => latest);
    const reset = vi.fn(async () => resetSnapshot);
    const dataSource = { cancelConversation, getSnapshot, reset } as unknown as TaskWorkflowDataSource;

    await expect(resetTaskWorkflow(dataSource, latest.taskId, activeRun)).resolves.toBe(resetSnapshot);
    expect(cancelConversation).toHaveBeenCalledWith({ taskId: latest.taskId });
    expect(reset).toHaveBeenCalledWith({ taskId: latest.taskId, expectedRevision: 3 });
  });

  it("still refreshes the revision when there is no active run", async () => {
    const latest = createSnapshot(7);
    const resetSnapshot = createSnapshot(8);
    const getSnapshot = vi.fn(async () => latest);
    const reset = vi.fn(async () => resetSnapshot);
    const dataSource = { cancelConversation: vi.fn(), getSnapshot, reset } as unknown as TaskWorkflowDataSource;

    await resetTaskWorkflow(dataSource, latest.taskId, null);
    expect(reset).toHaveBeenCalledWith({ taskId: latest.taskId, expectedRevision: 7 });
  });
});

/** 创建只包含重置测试所需字段的协议快照。 */
function createSnapshot(revision: number): D2CWorkflowSnapshot {
  return {
    taskId: "11111111-1111-4111-8111-111111111111",
    revision,
    workflowPhase: "draft",
    state: { phase: "setup", status: "draft" },
    viewModel: {
      setup: { projectPath: "", taskGoal: "测试任务", designUrl: "", designSummary: null },
      svg: { taskGoal: "测试任务", statusMessage: "等待设计", tools: [] },
      conversation: {
        initialUserMessage: "测试任务",
        planStatus: "idle",
        projectValidation: null,
        designComponentRecognition: null,
        plan: null,
      },
    },
  };
}
