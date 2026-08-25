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
});
