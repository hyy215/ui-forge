/** 验证 D2C Task 的权威状态边界与命令提交时的最小持久化状态。 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPersistedD2CGraphState } from "./d2cGraphState.js";

const graphDirectory = dirname(fileURLToPath(import.meta.url));

describe("D2C graph authoritative state boundary", () => {
  it("keeps the graph state private to the graph package", () => {
    const facade = readFileSync(join(graphDirectory, "..", "d2cAgent.ts"), "utf8");
    expect(facade).not.toContain("D2CGraphState");
  });

  it("documents D2CTask as durable state and graph outputs as transient execution context", () => {
    const source = readFileSync(join(graphDirectory, "d2cGraphState.ts"), "utf8");
    expect(source).toContain("D2CTask");
    expect(source).toContain("权威");
    expect(source).toContain("临时");
  });
});

describe("createPersistedD2CGraphState", () => {
  it("retains an isolated task and omits the complete execution context", () => {
    const task = {
      taskId: "task-1",
      workspaceId: "workspace-1",
      revision: 2,
      status: "design_confirmed" as const,
      projectPath: "/workspace",
      taskGoal: "实现客户列表",
    };

    const persisted = createPersistedD2CGraphState(task);

    expect(persisted).toEqual({ task });
    expect(persisted).not.toHaveProperty("execution");
    expect(persisted.task).not.toBe(task);
  });
});
