/** 验证任务重置会等待活动分析并使用服务端最新 revision。 */

import { describe, expect, it, vi } from "vitest";
import type { D2CWorkflowSnapshot } from "@ui-forge/shared-protocol";
import type { TaskWorkflowDataSource } from "../../../data-sources/task-workflow";
import { hasStartedConversation, resetTaskWorkflow } from "./useTaskWorkflow";

describe("hasStartedConversation", () => {
  it("keeps an inspected SVG behind explicit confirmation when analysis has not started", () => {
    const snapshot = createSnapshot(2);
    snapshot.state = { phase: "svg", status: "ready" };
    expect(hasStartedConversation(snapshot)).toBe(false);
  });

  it("restores confirmation when a persisted analysis result exists", () => {
    const snapshot = createSnapshot(3);
    snapshot.viewModel.conversation.planStatus = "ready";
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
    expect(getSnapshot).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledWith({ taskId: latest.taskId, expectedRevision: 3 });
  });

  it("still refreshes the revision when there is no active run", async () => {
    const latest = createSnapshot(7);
    const resetSnapshot = createSnapshot(8);
    const cancelConversation = vi.fn();
    const getSnapshot = vi.fn(async () => latest);
    const reset = vi.fn(async () => resetSnapshot);
    const dataSource = { cancelConversation, getSnapshot, reset } as unknown as TaskWorkflowDataSource;

    await resetTaskWorkflow(dataSource, latest.taskId, null);

    expect(cancelConversation).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledWith({ taskId: latest.taskId, expectedRevision: 7 });
  });
});

/** 创建只包含重置测试所需字段的协议快照。 */
function createSnapshot(revision: number): D2CWorkflowSnapshot {
  return {
    taskId: "11111111-1111-4111-8111-111111111111",
    revision,
    workflowPhase: "created",
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
