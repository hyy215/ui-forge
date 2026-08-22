/** 验证设计检查直接保留首步 SVG、版本冲突和重置行为。 */

import { describe, expect, it, vi } from "vitest";
import { createD2CService } from "./d2cService.js";

const source = { provider: "mastergo", reference: "design-1" };
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
const previewUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const inspection = {
  context: {
    source,
    name: "客户列表",
    nodeCount: 4,
    tokens: { colorPrimary: "#1677ff" },
    regions: [{ id: "1:1", name: "表格", role: "table" }],
    preview: { url: previewUrl, width: 10, height: 10 },
    warnings: [],
  },
  provenance: { provider: "MasterGo", transport: "MCP", operations: ["inspect", "extractSvg"] },
};
const projectInspector = {
  inspect: async (projectRoot: string) => ({ kind: "empty" as const, projectRoot }),
};
const componentCatalog = { components: [{ id: "select", name: "Select", aliases: ["选择"] }] };
const reviewablePlan = {
  status: "reviewable" as const, summary: "审阅方案", reusableComponents: [], newComponents: [],
  designUnderstanding: { layout: { summary: "页面布局", regions: [], evidence: ["结构"], warnings: [] }, interactions: [] },
  componentDecisions: [], fileImpacts: [],
  steps: [{
    id: "step-1", kind: "layout" as const, targetId: "page-layout", title: "实现", description: "实现页面",
    decision: "create" as const, dependsOn: [], files: [], evidence: ["结构"], acceptanceCriteria: ["可审阅"], risks: [],
  }],
  files: [], contextGaps: ["缺少文件证据"], stopConditions: ["不得直接写入"],
};

describe("D2CService", () => {
  it("keeps the exact first-step SVG data URL on the inspected design", async () => {
    const service = createD2CService({
      designSourceAdapters: [{ id: "mastergo", inspect: async () => inspection }],
      projectInspector,
      componentCatalog,
    });
    const initial = await service.initialize({ projectPath: "/workspace", workspaceId: "git:demo" });

    const inspected = await service.inspectDesign({
      taskId: initial.taskId,
      expectedRevision: initial.revision,
      source,
    });

    expect(inspected.inspectedDesign?.context.preview?.url).toBe(previewUrl);
    expect(inspected.taskGoal).toBe(
      "请结合当前项目，根据 MasterGo 设计「客户列表」中的「表格」生成整体修改方案。",
    );
  });

  it("persists the complete second-step analysis once after design confirmation", async () => {
    const plan = vi.fn(async (input: import("./second-step/planDeepAgent.js").PlanDeepAgentInput) => ({
      componentRecognition: input.recognition,
      plan: reviewablePlan,
    }));
    const componentRecognition = {
      status: "recognized" as const,
      components: [{
        id: "select-1",
        name: "选择框",
        instanceCount: 1,
        sourceNodeIds: ["select-1"],
        evidence: ["包含选择项文本"],
        evidenceStrength: "explicit" as const,
        effectiveTypeId: "select",
        resolvedBy: "model" as const,
        resolutionReason: "视觉证据明确",
      }],
      warnings: [],
    };
    const service = createD2CService({
      designSourceAdapters: [{ id: "mastergo", inspect: async () => ({
        ...inspection,
        artifact: { artifactId: "11111111-1111-4111-8111-111111111111", sectionCount: 0, byteSize: 1 },
      }) }],
      projectInspector: { inspect: async (projectRoot) => ({
        kind: "react_antd",
        projectRoot,
        packageJsonPath: `${projectRoot}/package.json`,
        reactVersion: "^19.0.0",
        antdVersion: "^6.0.0",
      }) },
      componentCatalog,
      designArtifactReader: {
        read: async () => ({
          reference: { artifactId: "11111111-1111-4111-8111-111111111111", sectionCount: 0, byteSize: 1 },
          content: { source, name: "客户列表", nodeCount: 1, regions: [], tokens: {}, structure: { roots: [], truncated: false }, sections: [] },
        }),
        readSection: async () => ({ id: "section", label: "section", data: {} }),
      },
      designComponentRecognizer: { recognize: () => componentRecognition },
      planDeepAgent: { plan },
    });
    const initial = await service.initialize({ projectPath: "/workspace" });
    const inspected = await service.inspectDesign({
      taskId: initial.taskId,
      expectedRevision: initial.revision,
      source,
    });

    const analyzed = await service.analyzeSecondStep({
      taskId: inspected.taskId,
      expectedRevision: inspected.revision,
    });
    const repeated = await service.analyzeSecondStep({
      taskId: analyzed.taskId,
      expectedRevision: analyzed.revision,
    });

    expect(analyzed.revision).toBe(inspected.revision + 1);
    expect(analyzed.projectInspection).toMatchObject({ kind: "react_antd" });
    expect(analyzed.componentRecognition?.components[0]).toMatchObject({
      effectiveTypeId: "select",
    });
    expect(repeated).toEqual(analyzed);
    expect(analyzed.plan).toEqual(reviewablePlan);
    expect(plan).toHaveBeenCalledOnce();
  });

  it("rejects a stale design inspection revision", async () => {
    const service = createD2CService({
      designSourceAdapters: [{ id: "mastergo", inspect: async () => inspection }],
      projectInspector,
      componentCatalog,
    });
    const initial = await service.initialize({});

    await expect(service.inspectDesign({
      taskId: initial.taskId,
      expectedRevision: 99,
      source,
    })).rejects.toThrow("任务版本冲突");
  });

  it("clears the inspected design when reset", async () => {
    const service = createD2CService({
      designSourceAdapters: [{ id: "mastergo", inspect: async () => inspection }],
      projectInspector,
      componentCatalog,
    });
    const initial = await service.initialize({});
    const inspected = await service.inspectDesign({
      taskId: initial.taskId,
      expectedRevision: initial.revision,
      source,
    });

    const reset = await service.reset({
      taskId: inspected.taskId,
      expectedRevision: inspected.revision,
    });

    expect(reset.inspectedDesign).toBeUndefined();
    expect(reset.designSource).toBeUndefined();
  });

  it("supersedes the artifact selected under the task lock during concurrent reset", async () => {
    let inspectionCount = 0;
    let releaseSecondInspection = (): void => {};
    let markSecondInspectionStarted = (): void => {};
    const secondInspectionGate = new Promise<void>((resolve) => {
      releaseSecondInspection = resolve;
    });
    const secondInspectionStarted = new Promise<void>((resolve) => {
      markSecondInspectionStarted = resolve;
    });
    const firstArtifactId = "11111111-1111-4111-8111-111111111111";
    const secondArtifactId = "22222222-2222-4222-8222-222222222222";
    const supersede = vi.fn(async () => undefined);
    const service = createD2CService({
      designSourceAdapters: [{
        id: "mastergo",
        inspect: async () => {
          inspectionCount += 1;
          if (inspectionCount === 2) {
            markSecondInspectionStarted();
            await secondInspectionGate;
          }
          return {
            ...inspection,
            artifact: {
              artifactId: inspectionCount === 1 ? firstArtifactId : secondArtifactId,
              sectionCount: 0,
              byteSize: 0,
            },
          };
        },
      }],
      projectInspector,
      componentCatalog,
      designArtifactLifecycle: {
        attach: async () => undefined,
        supersede,
        abandon: async () => undefined,
      },
    });
    const initial = await service.initialize({});
    await service.inspectDesign({
      taskId: initial.taskId,
      expectedRevision: 0,
      source,
    });

    const secondInspection = service.inspectDesign({
      taskId: initial.taskId,
      expectedRevision: 1,
      source,
    });
    await secondInspectionStarted;
    const reset = service.reset({ taskId: initial.taskId, expectedRevision: 2 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseSecondInspection();
    await secondInspection;

    const resetTask = await reset;
    expect(resetTask.revision).toBe(3);
    expect(resetTask.inspectedDesign).toBeUndefined();
    expect(supersede).toHaveBeenCalledWith(firstArtifactId);
    expect(supersede).toHaveBeenLastCalledWith(secondArtifactId);
  });
});
