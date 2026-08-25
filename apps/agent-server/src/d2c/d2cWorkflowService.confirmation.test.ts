/** 验证统一 D2C Workflow 门面只负责协议适配，并把确认命令交给领域 Service。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import { d2cWorkflowMethods } from "@ui-forge/shared-protocol";
import { describe, expect, it, vi } from "vitest";
import { D2CWorkflowService } from "./d2cWorkflowService.js";

const taskId = "11111111-1111-4111-8111-111111111111";
const task: D2CAgent.Task = {
  taskId,
  workspaceId: "workspace-1",
  revision: 1,
  status: "svg_ready",
  projectPath: "/workspace",
  taskGoal: "测试任务",
};

describe("D2CWorkflowService design confirmation", () => {
  it("dispatches the confirmation command through the standard domain service", async () => {
    const confirmDesign = vi.fn(async () => ({
      ...task,
      revision: 2,
      status: "design_confirmed" as const,
    }));
    const service: D2CAgent.Service = {
      initialize: async () => task,
      getTask: async () => task,
      inspectDesign: async () => task,
      confirmDesign,
      analyzeSecondStep: async () => task,
      reset: async () => task,
    };
    const workflow = new D2CWorkflowService({
      service,
      designProvider: "mastergo",
    });

    const snapshot = await workflow.handle(d2cWorkflowMethods.confirmDesign, {
      taskId,
      expectedRevision: 1,
      confirmation: "确认设计",
    });

    expect(confirmDesign).toHaveBeenCalledWith({
      taskId,
      expectedRevision: 1,
      confirmation: "确认设计",
    });
    expect(snapshot).toMatchObject({ revision: 2, status: "design_confirmed" });
  });
});
