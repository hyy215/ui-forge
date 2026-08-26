/** 验证 Agent Server 能通过显式环境配置启用仓库内真实设计测试来源。 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  d2cWorkflowMethods,
  d2cWorkflowSnapshotSchema,
  designDataIndexSchema,
  designDataSectionSchema,
} from "@ui-forge/shared-protocol";
import {
  createD2CWorkflowServiceFromEnvironment,
  readComponentCatalogFromEnvironment,
} from "./createD2CWorkflowService.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  vi.stubEnv(
    "UI_FORGE_ARTIFACT_DIR",
    await mkdtemp(join(tmpdir(), "ui-forge-server-artifacts-")),
  );
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("UI_FORGE_CHECKPOINT_BACKEND", "memory");
});

describe("runtime dependencies", () => {
  it("keeps tasks from separate real directories isolated even when Git remotes match", async () => {
    const firstProjectPath = await createGitWorkspace("ui-forge-workspace-first-");
    const secondProjectPath = await createGitWorkspace("ui-forge-workspace-second-");
    const service = createD2CWorkflowServiceFromEnvironment();
    const first = d2cWorkflowSnapshotSchema.parse(await service.handle(
      d2cWorkflowMethods.initialize,
      { projectPath: firstProjectPath },
    ));
    await service.handle(d2cWorkflowMethods.initialize, { projectPath: secondProjectPath });

    await expect(service.handle(d2cWorkflowMethods.listTasks, { projectPath: firstProjectPath }))
      .resolves.toMatchObject({ items: [{ taskId: first.taskId }], nextCursor: null });
    await expect(service.handle(d2cWorkflowMethods.getSnapshot, {
      taskId: first.taskId,
      projectPath: secondProjectPath,
    })).rejects.toThrow("任务不属于当前 Workspace");
    await service.dispose();
  });

  it("persists, discovers and permanently deletes tasks across local SQLite runtimes", async () => {
    const runtimeDirectory = await mkdtemp(join(tmpdir(), "ui-forge-checkpoints-"));
    const projectPath = await mkdtemp(join(tmpdir(), "ui-forge-workspace-"));
    vi.stubEnv("UI_FORGE_RUNTIME_DIR", runtimeDirectory);
    vi.stubEnv("UI_FORGE_CHECKPOINT_BACKEND", "sqlite");

    const firstService = createD2CWorkflowServiceFromEnvironment();
    const created = d2cWorkflowSnapshotSchema.parse(await firstService.handle(
      d2cWorkflowMethods.initialize,
      { projectPath },
    ));
    await firstService.dispose();

    const restoredService = createD2CWorkflowServiceFromEnvironment();
    const restored = d2cWorkflowSnapshotSchema.parse(await restoredService.handle(
      d2cWorkflowMethods.getSnapshot,
      { taskId: created.taskId, projectPath },
    ));
    const listed = await restoredService.handle(d2cWorkflowMethods.listTasks, { projectPath });

    expect(restored).toMatchObject({ taskId: created.taskId, revision: 0, status: "draft" });
    expect(listed).toMatchObject({ items: [{ taskId: created.taskId }], nextCursor: null });
    await expect(restoredService.handle(d2cWorkflowMethods.deleteTask, {
      taskId: created.taskId,
      expectedRevision: restored.revision,
      projectPath,
    })).resolves.toEqual({ taskId: created.taskId, deleted: true });
    await restoredService.dispose();

    const afterDeletionService = createD2CWorkflowServiceFromEnvironment();
    await expect(afterDeletionService.handle(d2cWorkflowMethods.getSnapshot, {
      taskId: created.taskId,
      projectPath,
    })).rejects.toThrow("任务不存在");
    await expect(afterDeletionService.handle(d2cWorkflowMethods.listTasks, { projectPath }))
      .resolves.toMatchObject({ items: [], nextCursor: null });
    await afterDeletionService.dispose();
  });

  it("loads and validates a user-defined component catalog", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ui-forge-component-catalog-"));
    const catalogPath = join(directory, "catalog.json");
    await writeFile(catalogPath, JSON.stringify({
      components: [{ id: "business-picker", name: "Business Picker", aliases: ["业务选择器"] }],
    }), "utf8");
    vi.stubEnv("UI_FORGE_COMPONENT_CATALOG_PATH", catalogPath);

    expect(readComponentCatalogFromEnvironment()).toEqual({
      components: [{ id: "business-picker", name: "Business Picker", aliases: ["业务选择器"] }],
    });
  });

  it("rejects duplicate component IDs in external configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ui-forge-invalid-component-catalog-"));
    const catalogPath = join(directory, "catalog.json");
    await writeFile(catalogPath, JSON.stringify({
      components: [
        { id: "table", name: "Table", aliases: [] },
        { id: "table", name: "Duplicate", aliases: [] },
      ],
    }), "utf8");
    vi.stubEnv("UI_FORGE_COMPONENT_CATALOG_PATH", catalogPath);

    expect(() => readComponentCatalogFromEnvironment()).toThrow("组件类型 ID 重复");
  });

  it("uses the registered MasterGo fixture provider without an MCP token", async () => {
    vi.stubEnv("UI_FORGE_DESIGN_PROVIDER", "mastergo-fixture");
    vi.stubEnv("MG_MCP_TOKEN", "");
    const service = createD2CWorkflowServiceFromEnvironment();
    const projectPath = await mkdtemp(join(tmpdir(), "ui-forge-empty-project-"));
    const initial = d2cWorkflowSnapshotSchema.parse(
      await service.handle(d2cWorkflowMethods.initialize, { projectPath }),
    );

    const inspected = d2cWorkflowSnapshotSchema.parse(await service.handle(d2cWorkflowMethods.inspectDesign, {
      taskId: initial.taskId,
      expectedRevision: initial.revision,
      designUrl: "table-filter",
      projectPath,
    }));

    expect(inspected.viewModel.setup.designSummary).toMatchObject({
      name: "容器 13",
      nodeCount: 177,
      regionCount: 23,
    });
    expect(inspected.viewModel.svg.tools[0]?.durationMs).toEqual(expect.any(Number));
    const artifact = inspected.viewModel.setup.designSummary?.designData;
    if (!artifact) throw new Error("Fixture inspection did not create a design artifact.");

    const index = designDataIndexSchema.parse(await service.handle(
      d2cWorkflowMethods.getDesignDataIndex,
      { taskId: initial.taskId, artifactId: artifact.artifactId, projectPath },
    ));
    const section = designDataSectionSchema.parse(await service.handle(
      d2cWorkflowMethods.getDesignDataSection,
      { taskId: initial.taskId, artifactId: artifact.artifactId, sectionIndex: 0, projectPath },
    ));

    expect(index.nodeCount).toBe(177);
    expect(index.sections[0]).toMatchObject({ label: "Section List" });
    expect(section).toMatchObject({ index: 0, label: "Section List" });

  });

  it("returns the fixed Server fixture for a normal MasterGo reference", async () => {
    vi.stubEnv("UI_FORGE_DESIGN_PROVIDER", "mastergo-fixture");
    const service = createD2CWorkflowServiceFromEnvironment();
    const initial = d2cWorkflowSnapshotSchema.parse(
      await service.handle(d2cWorkflowMethods.initialize, {}),
    );
    const designUrl = "https://mastergo.com/goto/example?page_id=M&layer_id=3:00289";

    const inspected = d2cWorkflowSnapshotSchema.parse(await service.handle(d2cWorkflowMethods.inspectDesign, {
      taskId: initial.taskId,
      expectedRevision: initial.revision,
      designUrl,
    }));

    expect(inspected.viewModel.setup).toMatchObject({
      designUrl,
      designSummary: { name: "容器 13", nodeCount: 177, regionCount: 23 },
    });
  });

  it("rejects an unknown configured design provider", () => {
    vi.stubEnv("UI_FORGE_DESIGN_PROVIDER", "unknown-provider");

    expect(() => createD2CWorkflowServiceFromEnvironment())
      .toThrow("不支持的 UI_FORGE_DESIGN_PROVIDER");
  });

  it("rejects invalid discarded Artifact retention configuration", () => {
    vi.stubEnv("UI_FORGE_ARTIFACT_PENDING_RETENTION_HOURS", "forever");

    expect(() => createD2CWorkflowServiceFromEnvironment())
      .toThrow("UI_FORGE_ARTIFACT_PENDING_RETENTION_HOURS 必须是非负数值");
  });

  it("rejects an unsupported structured-output mode", () => {
    vi.stubEnv("UI_FORGE_DESIGN_PROVIDER", "mastergo-fixture");
    vi.stubEnv("MODEL_STRUCTURED_OUTPUT_MODE", "required");

    expect(() => createD2CWorkflowServiceFromEnvironment())
      .toThrow("MODEL_STRUCTURED_OUTPUT_MODE 必须是 json-text 或 tool");
  });
});

/** 创建共享同一 origin remote、但拥有不同真实路径的最小 Git Workspace。 */
async function createGitWorkspace(prefix: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), prefix));
  const gitDirectory = join(workspace, ".git");
  await mkdir(gitDirectory);
  await writeFile(join(gitDirectory, "config"), [
    "[core]",
    "\trepositoryformatversion = 0",
    "\tbare = false",
    "[remote \"origin\"]",
    "\turl = https://example.invalid/shared/ui-forge.git",
  ].join("\n"), "utf8");
  return workspace;
}
