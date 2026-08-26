/** 验证任务路由区分新建与无副作用恢复语义。 */

import { describe, expect, it, vi } from "vitest";
import type { D2CWorkflowSnapshot } from "@ui-forge/shared-protocol";
import type { TaskWorkflowDataSource } from "../../data-sources/task-workflow";
import { loadTaskWorkflowSnapshot } from "./TaskWorkflowBootstrap";

describe("loadTaskWorkflowSnapshot", () => {
  it("loads an existing task without initializing or starting a stream", async () => {
    const snapshot = createSnapshot();
    const initialize = vi.fn(async () => snapshot);
    const getSnapshot = vi.fn(async () => snapshot);
    const streamConversation = vi.fn(async () => undefined);
    const dataSource = {
      initialize,
      getSnapshot,
      streamConversation,
    } as unknown as TaskWorkflowDataSource;

    await expect(loadTaskWorkflowSnapshot(
      dataSource,
      "existing",
      snapshot.taskId,
      new AbortController().signal,
    )).resolves.toBe(snapshot);
    expect(getSnapshot).toHaveBeenCalledWith(snapshot.taskId, expect.any(AbortSignal));
    expect(initialize).not.toHaveBeenCalled();
    expect(streamConversation).not.toHaveBeenCalled();
  });
});

/** 创建设计已确认但尚未继续分析的持久化快照。 */
function createSnapshot(): D2CWorkflowSnapshot {
  return {
    taskId: "11111111-1111-4111-8111-111111111111",
    revision: 2,
    status: "design_confirmed",
    viewModel: {
      setup: { projectPath: "/workspace", taskGoal: "生成页面", designUrl: "design", designSummary: null },
      svg: { taskGoal: "生成页面", statusMessage: "设计已确认", tools: [] },
      conversation: {
        initialUserMessage: "生成页面",
        planStatus: "idle",
        projectValidation: null,
        designComponentRecognition: null,
        plan: null,
        planApproval: null,
      },
      codeGeneration: { status: "idle" },
    },
  };
}
