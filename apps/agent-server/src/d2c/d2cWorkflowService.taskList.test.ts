/** 验证任务列表和管理请求始终受宿主 Workspace 身份及 revision 约束。 */

import { D2CAgent } from "@ui-forge/d2c-agent";
import {
  deleteD2CTaskResultSchema,
  d2cTaskSummaryPageSchema,
  d2cWorkflowMethods,
  d2cWorkflowSnapshotSchema,
} from "@ui-forge/shared-protocol";
import { describe, expect, it } from "vitest";
import { D2CWorkflowService } from "./d2cWorkflowService.js";

describe("D2CWorkflowService task list", () => {
  it("lists, manages and permanently deletes only tasks in the current workspace", async () => {
    const workflow = createWorkflow();
    const first = d2cWorkflowSnapshotSchema.parse(await workflow.handle(
      d2cWorkflowMethods.initialize,
      { projectPath: "/workspace/one" },
    ));
    const second = d2cWorkflowSnapshotSchema.parse(await workflow.handle(
      d2cWorkflowMethods.initialize,
      { projectPath: "/workspace/two" },
    ));

    const firstWorkspace = d2cTaskSummaryPageSchema.parse(await workflow.handle(
      d2cWorkflowMethods.listTasks,
      { projectPath: "/workspace/one" },
    ));
    expect(firstWorkspace.items.map((task) => task.taskId)).toEqual([first.taskId]);
    await expect(workflow.handle(d2cWorkflowMethods.getSnapshot, {
      taskId: second.taskId,
      projectPath: "/workspace/one",
    })).rejects.toThrow("当前 Workspace");
    await expect(workflow.handle(d2cWorkflowMethods.inspectDesign, {
      taskId: second.taskId,
      expectedRevision: second.revision,
      designUrl: "https://mastergo.com/file/cross-workspace",
      projectPath: "/workspace/one",
    })).rejects.toThrow("当前 Workspace");
    await expect(workflow.stream(d2cWorkflowMethods.streamConversation, {
      taskId: second.taskId,
      expectedRevision: second.revision,
      projectPath: "/workspace/one",
    }).next()).rejects.toThrow("当前 Workspace");

    const renamed = d2cWorkflowSnapshotSchema.parse(await workflow.handle(
      d2cWorkflowMethods.renameTask,
      {
        taskId: first.taskId,
        expectedRevision: first.revision,
        displayName: "客户中心",
        projectPath: "/workspace/one",
      },
    ));
    expect(renamed.revision).toBe(1);

    const archived = d2cWorkflowSnapshotSchema.parse(await workflow.handle(
      d2cWorkflowMethods.archiveTask,
      {
        taskId: first.taskId,
        expectedRevision: renamed.revision,
        projectPath: "/workspace/one",
      },
    ));
    expect(d2cTaskSummaryPageSchema.parse(await workflow.handle(
      d2cWorkflowMethods.listTasks,
      { projectPath: "/workspace/one" },
    )).items).toEqual([]);
    expect(d2cTaskSummaryPageSchema.parse(await workflow.handle(
      d2cWorkflowMethods.listTasks,
      { projectPath: "/workspace/one", includeArchived: true },
    )).items[0]).toMatchObject({ taskId: first.taskId, displayName: "客户中心" });

    await expect(workflow.handle(d2cWorkflowMethods.restoreTask, {
      taskId: first.taskId,
      expectedRevision: renamed.revision,
      projectPath: "/workspace/one",
    })).rejects.toThrow("版本冲突");
    const restored = d2cWorkflowSnapshotSchema.parse(await workflow.handle(
      d2cWorkflowMethods.restoreTask,
      {
        taskId: first.taskId,
        expectedRevision: archived.revision,
        projectPath: "/workspace/one",
      },
    ));
    expect(restored.revision).toBe(3);

    await expect(workflow.handle(d2cWorkflowMethods.deleteTask, {
      taskId: second.taskId,
      expectedRevision: second.revision,
      projectPath: "/workspace/one",
    })).rejects.toThrow("当前 Workspace");
    await expect(workflow.handle(d2cWorkflowMethods.deleteTask, {
      taskId: first.taskId,
      expectedRevision: archived.revision,
      projectPath: "/workspace/one",
    })).rejects.toThrow("版本冲突");
    expect(deleteD2CTaskResultSchema.parse(await workflow.handle(
      d2cWorkflowMethods.deleteTask,
      {
        taskId: first.taskId,
        expectedRevision: restored.revision,
        projectPath: "/workspace/one",
      },
    ))).toEqual({ taskId: first.taskId, deleted: true });
    expect(d2cTaskSummaryPageSchema.parse(await workflow.handle(
      d2cWorkflowMethods.listTasks,
      { projectPath: "/workspace/one", includeArchived: true },
    )).items).toEqual([]);
    await expect(workflow.handle(d2cWorkflowMethods.getSnapshot, {
      taskId: first.taskId,
      projectPath: "/workspace/one",
    })).rejects.toThrow("任务不存在");
  });
});

/** 创建不依赖外部设计来源的真实领域服务和确定性 Workspace 身份解析器。 */
function createWorkflow(): D2CWorkflowService {
  const service = D2CAgent.createService({
    designSourceAdapters: [],
    projectInspector: { inspect: async (projectRoot) => ({ kind: "empty", projectRoot }) },
    componentCatalog: { components: [{ id: "table", name: "Table", aliases: ["表格"] }] },
  });
  return new D2CWorkflowService({
    service,
    designProvider: "mastergo",
    resolveWorkspaceId: async (projectPath) => `workspace:${projectPath}`,
  });
}
