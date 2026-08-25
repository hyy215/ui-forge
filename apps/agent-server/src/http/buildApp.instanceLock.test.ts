/** 验证 Fastify 生命周期在运行时资源之前取得并最终释放单实例锁。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import { describe, expect, it, vi } from "vitest";
import { D2CWorkflowService } from "../d2c/d2cWorkflowService.js";
import { buildApp } from "./buildApp.js";

const task: D2CAgent.Task = {
  taskId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "workspace-1",
  revision: 0,
  status: "draft",
  projectPath: "/workspace",
  taskGoal: "测试任务",
};

const domainService: D2CAgent.Service = {
  initialize: async () => task,
  getTask: async () => task,
  inspectDesign: async () => task,
  analyzeSecondStep: async () => task,
  reset: async () => task,
};

describe("buildApp instance lock", () => {
  it("acquires before workflow initialization and releases after disposal", async () => {
    const order: string[] = [];
    const workflow = new D2CWorkflowService({
      service: domainService,
      designProvider: "mastergo",
      initialize: async () => { order.push("workflow-initialize"); },
      dispose: async () => { order.push("workflow-dispose"); },
    });
    const app = buildApp({
      d2cWorkflowService: workflow,
      requestLogger: false,
      instanceLock: {
        acquire: async () => { order.push("lock-acquire"); },
        release: async () => { order.push("lock-release"); },
      },
    });

    await app.ready();
    expect(order).toEqual(["lock-acquire", "workflow-initialize"]);
    await app.close();
    expect(order).toEqual([
      "lock-acquire",
      "workflow-initialize",
      "workflow-dispose",
      "lock-release",
    ]);
  });

  it("releases ownership when workflow initialization fails", async () => {
    const release = vi.fn(async () => undefined);
    const workflow = new D2CWorkflowService({
      service: domainService,
      designProvider: "mastergo",
      initialize: async () => { throw new Error("checkpoint unavailable"); },
    });
    const app = buildApp({
      d2cWorkflowService: workflow,
      requestLogger: false,
      instanceLock: {
        acquire: async () => undefined,
        release,
      },
    });

    await expect(app.ready()).rejects.toThrow("checkpoint unavailable");
    expect(release).toHaveBeenCalledOnce();
  });
});
