/** 验证保存的真实 MasterGo 数据能作为受限 Provider 进入 D2C 工作流。 */

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { D2CAgent } from "@ui-forge/d2c-agent";
import { MasterGoFixtureAdapter } from "./masterGoFixtureAdapter.js";

const capturedFixturePath = fileURLToPath(
  new URL("../../../fixtures/design-cases/mastergo-table-filter.json", import.meta.url),
);

/** 创建只登记仓库内脱敏真实样本的测试设计 Adapter。 */
function createFixtureAdapter() {
  return new MasterGoFixtureAdapter({
    fixtures: { "table-filter": capturedFixturePath },
  });
}

describe("MasterGoFixtureAdapter", () => {
  it("routes the captured MasterGo payload through LangGraph without starting MCP", async () => {
    const adapter = createFixtureAdapter();
    const service = D2CAgent.createService({
      componentCatalog: { components: [{ id: "table", name: "Table", aliases: ["表格"] }] },
      designSourceAdapters: [adapter],
      projectInspector: { inspect: async (projectRoot) => ({ kind: "empty", projectRoot }) },
    });
    const initial = await service.initialize({ projectPath: "/workspace" });

    const inspected = await service.inspectDesign({
      taskId: initial.taskId,
      expectedRevision: initial.revision,
      source: { provider: "mastergo-fixture", reference: "table-filter" },
    });

    expect(inspected.inspectedDesign).toMatchObject({
      context: {
        source: { provider: "mastergo-fixture", reference: "table-filter" },
        name: "容器 13",
        nodeCount: 177,
        preview: { width: 980, height: 440 },
        structurePreview: { width: 980, height: 440 },
      },
      provenance: {
        provider: "MasterGo Fixture",
        transport: "fixture",
        operations: ["readFixture", "normalizeDesign"],
      },
    });
    expect(inspected.inspectedDesign?.context.preview?.url)
      .toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("rejects references that were not explicitly registered", async () => {
    const adapter = createFixtureAdapter();

    await expect(adapter.inspect("../../private-design"))
      .rejects.toThrow("未登记的 MasterGo 测试设计");
  });

  it("uses an explicitly configured default fixture without treating the reference as a path", async () => {
    const adapter = new MasterGoFixtureAdapter({
      fixtures: {},
      defaultFixture: capturedFixturePath,
    });
    const reference = "https://mastergo.com/goto/example?page_id=M&layer_id=3:00289";

    const inspected = await adapter.inspect(reference);

    expect(inspected.context).toMatchObject({
      source: { provider: "mastergo-fixture", reference },
      name: "容器 13",
      nodeCount: 177,
    });
  });
});
