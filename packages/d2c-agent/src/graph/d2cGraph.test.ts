/** 验证 D2C Graph 在命令边界清理临时状态后仍能从权威任务恢复。 */

import { describe, expect, it, vi } from "vitest";
import { createD2CGraph } from "./d2cGraph.js";

describe("createD2CGraph", () => {
  it("runs deterministic front nodes after persisted design confirmation", async () => {
    const plan = vi.fn(async (input: import("../second-step/planDeepAgent.js").PlanDeepAgentInput) => ({
      componentRecognition: input.recognition,
      plan: reviewablePlan,
    }));
    const source = { provider: "mastergo", reference: "design-1" };
    const analyzeProjectContext = vi.fn(async () => ({
      kind: "react_antd" as const, files: [], filesComplete: true, matches: [], warnings: [],
    }));
    const resolveCatalog = vi.fn(async (
      input: Parameters<import("../design-system/designSystemKnowledge.js").DesignSystemKnowledgeProvider["resolveCatalog"]>[0],
    ) => ({
      catalog: input.baseCatalog,
      warnings: [],
    }));
    const inspection = {
      context: {
        source,
        name: "客户列表",
        nodeCount: 1,
        tokens: {},
        regions: [],
        warnings: [],
      },
      provenance: { provider: "MasterGo", transport: "MCP", operations: [] },
      artifact: { artifactId: "11111111-1111-4111-8111-111111111111", sectionCount: 0, byteSize: 1 },
    };
    const graph = createD2CGraph({
      designContextResolver: { inspect: async () => inspection },
      projectInspector: { inspect: async (projectRoot) => ({
        kind: "react_antd",
        projectRoot,
        packageJsonPath: `${projectRoot}/package.json`,
      }) },
      projectContextAnalyzer: { analyze: analyzeProjectContext },
      artifactReader: {
        read: async () => ({
          reference: inspection.artifact,
          content: { source, name: "客户列表", nodeCount: 1, regions: [], tokens: {}, structure: { roots: [], truncated: false }, sections: [] },
        }),
        readSection: async () => ({ id: "section", label: "section", data: {} }),
      },
      componentRecognizer: { recognize: () => ({
        status: "recognized",
        components: [{ id: "table", name: "表格", sourceNodeIds: ["table"], instanceCount: 1, evidence: ["重复行"], evidenceStrength: "structural" }],
        warnings: [],
      }) },
      baseComponentCatalog: { components: [{ id: "table", name: "Table", aliases: ["表格"] }] },
      designSystemKnowledgeProvider: {
        resolveCatalog,
        queryComponent: async () => [],
      },
      planDeepAgent: { plan },
    });
    const initialTask = {
      taskId: "task-1",
      workspaceId: "workspace-1",
      revision: 0,
      status: "draft" as const,
      projectPath: "/workspace",
      taskGoal: "实现客户列表",
    };
    await graph.saveTask(initialTask);

    await expect(graph.inspectDesign("task-1", source)).resolves.toEqual(inspection);
    expect(plan).not.toHaveBeenCalled();
    await graph.saveTask({
      ...initialTask,
      revision: 2,
      status: "design_confirmed",
      designSource: source,
      inspectedDesign: { ...inspection, durationMs: 1 },
    });
    const progress: string[] = [];
    const controller = new AbortController();
    await expect(graph.analyzeSecondStep(
      "task-1",
      (event) => { progress.push(event.type); },
      controller.signal,
    )).resolves.toMatchObject({
      projectInspection: { kind: "react_antd" },
      componentRecognition: { status: "recognized" },
    });
    expect(plan).toHaveBeenCalledOnce();
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({
      inspection: expect.objectContaining(inspection),
    }));
    expect(resolveCatalog).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
    expect(analyzeProjectContext).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
    expect(progress).toEqual([
      "project-inspection-start",
      "project-inspection-complete",
      "design-system-catalog-start",
      "design-system-catalog-complete",
      "component-recognition-start",
      "component-recognition-complete",
      "project-context-analysis-start",
      "project-context-analysis-complete",
    ]);
  });

  it("allows unsupported projects to stop after transient state was cleared", async () => {
    const plan = vi.fn(async (input: import("../second-step/planDeepAgent.js").PlanDeepAgentInput) => ({
      componentRecognition: input.recognition,
      plan: reviewablePlan,
    }));
    const analyzeProjectContext = vi.fn(async () => ({
      kind: "react_antd" as const, files: [], filesComplete: true, matches: [], warnings: [],
    }));
    const source = { provider: "mastergo", reference: "design-1" };
    const inspection = {
      context: {
        source,
        name: "页面",
        nodeCount: 0,
        tokens: {},
        regions: [],
        warnings: [],
      },
      provenance: { provider: "MasterGo", transport: "MCP", operations: [] },
    };
    const graph = createD2CGraph({
      designContextResolver: { inspect: async () => inspection },
      projectInspector: { inspect: async () => ({
        kind: "unsupported",
        projectRoot: "/workspace",
        reasons: ["缺少 Ant Design 依赖"],
      }) },
      projectContextAnalyzer: { analyze: analyzeProjectContext },
      componentRecognizer: { recognize: () => ({ status: "recognized", components: [], warnings: [] }) },
      baseComponentCatalog: { components: [{ id: "table", name: "Table", aliases: ["表格"] }] },
      planDeepAgent: { plan },
    });
    const initialTask = {
      taskId: "task-unsupported",
      workspaceId: "workspace-1",
      revision: 0,
      status: "draft" as const,
      projectPath: "/workspace",
      taskGoal: "实现页面",
    };
    await graph.saveTask(initialTask);
    await graph.inspectDesign("task-unsupported", source);
    await graph.saveTask({
      ...initialTask,
      revision: 2,
      status: "design_confirmed",
      designSource: source,
      inspectedDesign: { ...inspection, durationMs: 1 },
    });

    await expect(graph.analyzeSecondStep("task-unsupported")).resolves.toEqual({
      projectInspection: {
        kind: "unsupported",
        projectRoot: "/workspace",
        reasons: ["缺少 Ant Design 依赖"],
      },
    });
    expect(plan).not.toHaveBeenCalled();
    expect(analyzeProjectContext).not.toHaveBeenCalled();
  });
});

const reviewablePlan = {
  status: "reviewable" as const,
  summary: "审阅方案",
  designUnderstanding: {
    layout: { summary: "页面布局", regions: [], evidence: ["设计结构"], warnings: [] },
    interactions: [],
  },
  reusableComponents: [],
  newComponents: [],
  componentDecisions: [],
  fileImpacts: [],
  steps: [{
    id: "step-1", kind: "layout" as const, targetId: "page-layout", title: "实现", description: "实现页面",
    decision: "create" as const, dependsOn: [], files: [], evidence: ["设计结构"], acceptanceCriteria: ["可审阅"], risks: [],
  }],
  files: [],
  validationTarget: { previewPath: "/" },
  contextGaps: ["缺少仓库文件证据"],
  stopConditions: ["不得直接写入"],
};
