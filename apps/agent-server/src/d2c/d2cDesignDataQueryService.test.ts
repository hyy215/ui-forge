/** 验证设计 Artifact 查询的所有权校验和共享协议投影。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import { describe, expect, it } from "vitest";
import { D2CDesignDataQueryService } from "./d2cDesignDataQueryService.js";

const taskId = "11111111-1111-4111-8111-111111111111";
const artifactId = "22222222-2222-4222-8222-222222222222";
const task: D2CAgent.Task = {
  taskId,
  workspaceId: "git:demo",
  revision: 1,
  status: "svg_ready",
  projectPath: "/workspace",
  taskGoal: "实现客户列表",
  inspectedDesign: {
    context: {
      source: { provider: "mastergo", reference: "design-1" },
      name: "客户列表",
      nodeCount: 2,
      tokens: { colorPrimary: "#1677ff" },
      regions: [{ id: "1:1", name: "表格" }],
      warnings: [],
    },
    provenance: { provider: "MasterGo", transport: "MCP", operations: [] },
    artifact: { artifactId, sectionCount: 1, byteSize: 32 },
    durationMs: 1,
  },
};
const reader: D2CAgent.DesignArtifactReader = {
  read: async () => ({
    reference: { artifactId, sectionCount: 1, byteSize: 32 },
    content: {
      source: { provider: "mastergo", reference: "design-1" },
      name: "客户列表",
      nodeCount: 2,
      regions: [{ id: "1:1", name: "表格" }],
      tokens: { colorPrimary: "#1677ff" },
      sections: [{ id: "section-1", label: "页面", data: { type: "FRAME" } }],
    },
  }),
  readSection: async () => ({ id: "section-1", label: "页面", data: { type: "FRAME" } }),
};

describe("D2CDesignDataQueryService", () => {
  it("returns an authorized artifact index without raw section data", async () => {
    const service = new D2CDesignDataQueryService({
      service: { getTask: async () => task },
      designArtifactReader: reader,
    });

    await expect(service.getIndex(taskId, artifactId)).resolves.toMatchObject({
      artifactId,
      provider: "mastergo",
      reference: "design-1",
      name: "客户列表",
      nodeCount: 2,
      sections: [{ index: 0, id: "section-1", label: "页面" }],
    });
  });

  it("returns one authorized raw section", async () => {
    const service = new D2CDesignDataQueryService({
      service: { getTask: async () => task },
      designArtifactReader: reader,
    });

    await expect(service.getSection(taskId, artifactId, 0)).resolves.toEqual({
      artifactId,
      index: 0,
      id: "section-1",
      label: "页面",
      byteSize: Buffer.byteLength(JSON.stringify({ type: "FRAME" }), "utf8"),
      data: { type: "FRAME" },
    });
  });

  it("rejects artifacts not owned by the requested task", async () => {
    const service = new D2CDesignDataQueryService({
      service: { getTask: async () => task },
      designArtifactReader: reader,
    });

    await expect(service.getIndex(
      taskId,
      "33333333-3333-4333-8333-333333333333",
    )).rejects.toThrow("不属于当前任务");
  });

  it("rejects data reads when the Artifact Store is disabled", async () => {
    const service = new D2CDesignDataQueryService({
      service: { getTask: async () => task },
    });

    await expect(service.getIndex(taskId, artifactId)).rejects.toThrow("Artifact Store 未启用");
  });
});
