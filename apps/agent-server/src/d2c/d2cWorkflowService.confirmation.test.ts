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

describe("D2CWorkflowService explicit confirmations", () => {
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

  it("dispatches an exact Plan approval through the standard domain service", async () => {
    const planHash = "a".repeat(64);
    const approvePlan = vi.fn(async () => ({
      ...task,
      revision: 2,
      status: "plan_approved" as const,
      planApproval: {
        planVersion: 1,
        planHash,
        approvedAt: "2026-08-28T00:00:00.000Z",
        executionMode: "generate-and-apply" as const,
      },
    }));
    const service = {
      initialize: async () => task,
      getTask: async () => task,
      inspectDesign: async () => task,
      approvePlan,
      reset: async () => task,
    } as unknown as D2CAgent.Service;
    const workflow = new D2CWorkflowService({ service, designProvider: "mastergo" });

    const snapshot = await workflow.handle(d2cWorkflowMethods.approvePlan, {
      taskId,
      expectedRevision: 1,
      planVersion: 1,
      planHash,
      executionMode: "generate-and-apply",
    });

    expect(approvePlan).toHaveBeenCalledWith({
      taskId,
      expectedRevision: 1,
      planVersion: 1,
      planHash,
      executionMode: "generate-and-apply",
    });
    expect(snapshot).toMatchObject({ revision: 2, status: "plan_approved" });
  });

  it("persists approval only for the current exact command hash and emits an audit event", async () => {
    const commandPlanHash = "c".repeat(64);
    const command = {
      commandId: "build-vite",
      purpose: "build-vite" as const,
      cwd: "/workspace",
      executable: "/usr/bin/node",
      arguments: ["/workspace/node_modules/vite/bin/vite.js", "build"],
      displayCommand: "/usr/bin/node /workspace/node_modules/vite/bin/vite.js build",
      timeoutMs: 300_000,
      networkAccess: "none" as const,
      workspaceScope: "within-workspace" as const,
    };
    const approveDeliveryCommands = vi.fn(async () => ({
      ...task,
      revision: 2,
      status: "command_approved" as const,
      deliveryCommandPlan: {
        status: "approval_required" as const,
        patchSetHash: "b".repeat(64),
        workspaceRoot: "/workspace",
        commandPlanHash,
        commands: [command],
        summary: "等待批准。",
        preparedAt: "2026-08-28T00:00:00.000Z",
      },
      deliveryCommandApproval: {
        commandPlanHash,
        approvedAt: "2026-08-28T00:00:01.000Z",
      },
    }));
    const commandAuditReporter = vi.fn();
    const service = {
      getTask: async () => task,
      approveDeliveryCommands,
    } as unknown as D2CAgent.Service;
    const workflow = new D2CWorkflowService({
      service,
      designProvider: "mastergo",
      commandAuditReporter,
    });

    await workflow.handle(d2cWorkflowMethods.approveDeliveryCommands, {
      taskId,
      expectedRevision: 1,
      commandPlanHash,
    });

    expect(approveDeliveryCommands).toHaveBeenCalledWith({
      taskId,
      expectedRevision: 1,
      commandPlanHash,
    });
    expect(commandAuditReporter).toHaveBeenCalledWith({
      type: "approved",
      taskId,
      commandPlanHash,
      commands: [command],
    });
  });
});
