/** 验证领域持久化状态通过真实映射投影为唯一公开工作流状态。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import { describe, expect, it } from "vitest";
import { toD2CWorkflowSnapshot } from "./d2cSnapshotPresenter.js";

describe("toD2CWorkflowSnapshot", () => {
  it.each([
    "draft",
    "svg_ready",
    "design_confirmed",
    "analysis_ready",
    "plan_approved",
    "patch_ready",
    "patch_applied",
    "command_approval_required",
    "command_approved",
    "validation_blocked",
    "delivery_ready",
  ] as const)(
    "projects %s without introducing a second status vocabulary",
    (status) => {
      const task: D2CAgent.Task = {
        taskId: "11111111-1111-4111-8111-111111111111",
        workspaceId: "workspace-1",
        revision: 0,
        status,
        projectPath: "/workspace",
        taskGoal: "实现页面",
      };

      const snapshot = toD2CWorkflowSnapshot(task);

      expect(snapshot.status).toBe(status);
      expect(snapshot).not.toHaveProperty("workflowPhase");
      expect(snapshot).not.toHaveProperty("state");
    },
  );

  it("projects an applied Patch without exposing generated file contents", () => {
    const task: D2CAgent.Task = {
      taskId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "workspace-1",
      revision: 5,
      status: "patch_applied",
      projectPath: "/workspace",
      taskGoal: "实现页面",
      codeGeneration: {
        status: "ready",
        patchSet: {
          patchSetHash: "a".repeat(64),
          planVersion: 1,
          planHash: "b".repeat(64),
          summary: "页面代码",
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

    const snapshot = toD2CWorkflowSnapshot(task);

    expect(snapshot.viewModel.codeGeneration).toMatchObject({
      status: "ready",
      application: { status: "applied", files: [{ path: "src/Page.tsx", action: "create" }] },
    });
    expect(JSON.stringify(snapshot)).not.toContain("export function Page");
  });
});
