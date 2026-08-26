/** 验证设计检查、人工确认门禁、版本冲突、重置和 Artifact 生命周期行为。 */

import { describe, expect, it, vi } from "vitest";
import { createD2CService } from "./d2cService.js";
import type { PlanDeepAgentInput } from "./second-step/planDeepAgent.js";
import { bindPatchToPlan } from "./planning/evolvingPlan.js";

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
const artifactReference = {
  artifactId: "11111111-1111-4111-8111-111111111111",
  sectionCount: 0,
  byteSize: 1,
};
const componentRecognition: import("./design-components/designComponentRecognition.js").DesignComponentRecognition = {
  status: "recognized",
  components: [{
    id: "select-1",
    name: "选择框",
    instanceCount: 1,
    sourceNodeIds: ["select-1"],
    evidence: ["包含选择项文本"],
    evidenceStrength: "explicit",
    effectiveTypeId: "select",
    resolvedBy: "model",
    resolutionReason: "视觉证据明确",
  }],
  warnings: [],
};
const reviewablePlan = {
  status: "reviewable" as const,
  summary: "审阅方案",
  reusableComponents: [],
  newComponents: [],
  designUnderstanding: {
    layout: { summary: "页面布局", regions: [], evidence: ["结构"], warnings: [] },
    interactions: [],
  },
  componentDecisions: [],
  fileImpacts: [],
  steps: [{
    id: "step-1",
    kind: "layout" as const,
    targetId: "page-layout",
    title: "实现",
    description: "实现页面",
    decision: "create" as const,
    dependsOn: [],
    files: [],
    evidence: ["结构"],
    acceptanceCriteria: ["可审阅"],
    risks: [],
  }],
  files: [],
  contextGaps: ["缺少文件证据"],
  stopConditions: ["不得直接写入"],
};

describe("D2CService", () => {
  it("keeps the exact first-step SVG and enters the explicit svg_ready stage", async () => {
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

    expect(inspected.status).toBe("svg_ready");
    expect(inspected.inspectedDesign?.context.preview?.url).toBe(previewUrl);
  });

  it("keeps exact confirmation as a domain rule before analysis", async () => {
    const plan = vi.fn(async (input: PlanDeepAgentInput) => ({
      componentRecognition: input.recognition,
      plan: reviewablePlan,
    }));
    const service = createAnalyzableService(plan);
    const initial = await service.initialize({ projectPath: "/workspace" });
    const inspected = await service.inspectDesign({
      taskId: initial.taskId,
      expectedRevision: initial.revision,
      source,
    });

    await expect(service.analyzeSecondStep({
      taskId: inspected.taskId,
      expectedRevision: inspected.revision,
    })).rejects.toThrow("确认");
    await expect(service.confirmDesign({
      taskId: inspected.taskId,
      expectedRevision: inspected.revision,
      confirmation: "确认",
    })).rejects.toThrow("确认设计");
    expect(plan).not.toHaveBeenCalled();
  });

  it("persists confirmation independently so an analysis failure cannot erase the gate", async () => {
    const service = createAnalyzableService(async () => {
      throw new Error("模型暂时不可用");
    });
    const initial = await service.initialize({ projectPath: "/workspace" });
    const inspected = await service.inspectDesign({
      taskId: initial.taskId,
      expectedRevision: initial.revision,
      source,
    });
    const confirmed = await service.confirmDesign({
      taskId: inspected.taskId,
      expectedRevision: inspected.revision,
      confirmation: "确认设计",
    });

    await expect(service.analyzeSecondStep({
      taskId: confirmed.taskId,
      expectedRevision: confirmed.revision,
    })).rejects.toThrow("模型暂时不可用");
    expect(await service.getTask(confirmed.taskId)).toMatchObject({
      revision: confirmed.revision,
      status: "design_confirmed",
    });
  });

  it("persists the complete second-step analysis once after design confirmation", async () => {
    const plan = vi.fn(async (input: PlanDeepAgentInput) => ({
      componentRecognition: input.recognition,
      plan: reviewablePlan,
    }));
    const service = createAnalyzableService(plan);
    const initial = await service.initialize({ projectPath: "/workspace" });
    const inspected = await service.inspectDesign({
      taskId: initial.taskId,
      expectedRevision: initial.revision,
      source,
    });
    const confirmed = await service.confirmDesign({
      taskId: inspected.taskId,
      expectedRevision: inspected.revision,
      confirmation: "确认设计",
    });
    const analyzed = await service.analyzeSecondStep({
      taskId: confirmed.taskId,
      expectedRevision: confirmed.revision,
    });
    const repeated = await service.analyzeSecondStep({
      taskId: analyzed.taskId,
      expectedRevision: analyzed.revision,
    });

    expect(analyzed.status).toBe("analysis_ready");
    expect(analyzed.revision).toBe(confirmed.revision + 1);
    expect(analyzed.plan).toEqual(reviewablePlan);
    expect(repeated).toEqual(analyzed);
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

  it("clears inspected design, confirmation and analysis state when reset", async () => {
    const supersede = vi.fn(async () => undefined);
    const service = createD2CService({
      designSourceAdapters: [{ id: "mastergo", inspect: async () => ({
        ...inspection,
        artifact: artifactReference,
      }) }],
      projectInspector,
      componentCatalog,
      designArtifactLifecycle: {
        attach: async () => undefined,
        supersede,
        abandon: async () => undefined,
      },
    });
    const initial = await service.initialize({});
    const inspected = await service.inspectDesign({
      taskId: initial.taskId,
      expectedRevision: initial.revision,
      source,
    });
    const confirmed = await service.confirmDesign({
      taskId: inspected.taskId,
      expectedRevision: inspected.revision,
      confirmation: "确认设计",
    });
    const reset = await service.reset({
      taskId: confirmed.taskId,
      expectedRevision: confirmed.revision,
    });

    expect(reset).toMatchObject({ status: "draft", revision: confirmed.revision + 1 });
    expect(reset.inspectedDesign).toBeUndefined();
    expect(reset.plan).toBeUndefined();
    expect(supersede).toHaveBeenCalledWith(artifactReference.artifactId);
  });

  it("resumes from the approved Plan and persists a hash-bound candidate Patch", async () => {
    const patchHash = "c".repeat(64);
    const generate = vi.fn(async (input: import("./code-generation/codeGenerationAgent.js").CodeGenerationAgentInput) => ({
      outcome: {
        status: "ready" as const,
        patchSet: {
          patchSetHash: "a".repeat(64),
          planVersion: input.plan.planVersion,
          planHash: input.plan.planHash,
          summary: "候选页面代码",
          patches: [{
            stepId: "layout",
            patchHash,
            operations: [{
              path: "src/Page.tsx",
              action: "create" as const,
              beforeHash: null,
              afterHash: "b".repeat(64),
              content: "export function Page() { return null; }\n",
              reviewDiff: "--- /dev/null\n+++ b/src/Page.tsx",
            }],
          }],
          warnings: [],
        },
      },
      plan: bindPatchToPlan(input.plan, {
        patchHash,
        planHash: input.plan.planHash,
        stepId: "layout",
      }),
    }));
    const service = createCodeGenerationService(generate, "missing");
    const analyzed = await inspectConfirmAndAnalyze(service);
    const generated = await service.generateCode({
      taskId: analyzed.taskId,
      expectedRevision: analyzed.revision,
    });
    const repeated = await service.generateCode({
      taskId: generated.taskId,
      expectedRevision: generated.revision,
    });

    expect(generated).toMatchObject({
      status: "patch_ready",
      revision: analyzed.revision + 1,
      codeGeneration: { status: "ready", patchSet: { patchSetHash: "a".repeat(64) } },
    });
    expect(generated.evolvingPlan?.patchBindings).toContainEqual(expect.objectContaining({ patchHash, status: "active" }));
    expect(repeated).toEqual(generated);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("blocks generation before the model when a planned create file now exists", async () => {
    const generate = vi.fn();
    const service = createCodeGenerationService(generate, "existing");
    const analyzed = await inspectConfirmAndAnalyze(service);

    const blocked = await service.generateCode({
      taskId: analyzed.taskId,
      expectedRevision: analyzed.revision,
    });
    const retried = await service.generateCode({
      taskId: blocked.taskId,
      expectedRevision: blocked.revision,
    });

    expect(blocked).toMatchObject({
      status: "analysis_ready",
      codeGeneration: {
        status: "blocked",
        summary: "代码生成前的文件版本检查未通过。",
      },
    });
    expect(retried.codeGeneration).toMatchObject({ status: "blocked" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("supersedes the artifact selected under the task lock during concurrent reset", async () => {
    let inspectionCount = 0;
    let releaseSecondInspection = (): void => {};
    let markSecondInspectionStarted = (): void => {};
    const secondInspectionGate = new Promise<void>((resolve) => { releaseSecondInspection = resolve; });
    const secondInspectionStarted = new Promise<void>((resolve) => { markSecondInspectionStarted = resolve; });
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
    const first = await service.inspectDesign({
      taskId: initial.taskId,
      expectedRevision: initial.revision,
      source,
    });
    const firstReset = await service.reset({
      taskId: first.taskId,
      expectedRevision: first.revision,
    });

    const secondInspection = service.inspectDesign({
      taskId: initial.taskId,
      expectedRevision: firstReset.revision,
      source,
    });
    await secondInspectionStarted;
    const reset = service.reset({
      taskId: initial.taskId,
      expectedRevision: firstReset.revision + 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseSecondInspection();
    await secondInspection;

    const resetTask = await reset;
    expect(resetTask.inspectedDesign).toBeUndefined();
    expect(supersede).toHaveBeenCalledWith(firstArtifactId);
    expect(supersede).toHaveBeenLastCalledWith(secondArtifactId);
  });
});

function createAnalyzableService(
  plan: (input: PlanDeepAgentInput) => Promise<{
    componentRecognition: typeof componentRecognition;
    plan: typeof reviewablePlan;
  }>,
) {
  return createD2CService({
    designSourceAdapters: [{ id: "mastergo", inspect: async () => ({
      ...inspection,
      artifact: artifactReference,
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
        reference: artifactReference,
        content: {
          source,
          name: "客户列表",
          nodeCount: 1,
          regions: [],
          tokens: {},
          structure: { roots: [], truncated: false },
          sections: [],
        },
      }),
      readSection: async () => ({ id: "section", label: "section", data: {} }),
    },
    designComponentRecognizer: { recognize: () => componentRecognition },
    planDeepAgent: { plan },
  });
}

/** 创建带真实 Graph 暂停点和可控 Code Agent/文件快照的服务。 */
function createCodeGenerationService(
  generate: import("./code-generation/codeGenerationAgent.js").CodeGenerationAgent["generate"],
  fileStatus: "existing" | "missing",
) {
  return createD2CService({
    designSourceAdapters: [{ id: "mastergo", inspect: async () => ({ ...inspection, artifact: artifactReference }) }],
    projectInspector: { inspect: async (projectRoot) => ({
      kind: "react_antd",
      projectRoot,
      packageJsonPath: `${projectRoot}/package.json`,
      reactVersion: "^19.0.0",
      antdVersion: "^6.0.0",
    }) },
    projectContextAnalyzer: { analyze: async () => ({
      kind: "react_antd", files: [], filesComplete: true, matches: [], warnings: [],
    }) },
    projectCodeContextReader: { read: async () => ({
      files: [{
        path: "src/Page.tsx",
        role: "planned",
        status: fileStatus,
        byteSize: fileStatus === "existing" ? 18 : 0,
        ...(fileStatus === "existing"
          ? { sha256: "d".repeat(64), content: "export const old = 1;\n" }
          : {}),
      }],
      warnings: [],
    }) },
    componentCatalog,
    designArtifactReader: {
      read: async () => ({
        reference: artifactReference,
        content: {
          source,
          name: "客户列表",
          nodeCount: 1,
          regions: [],
          tokens: {},
          structure: { roots: [], truncated: false },
          sections: [],
        },
      }),
      readSection: async () => ({ id: "section", label: "section", data: {} }),
    },
    designComponentRecognizer: { recognize: () => componentRecognition },
    planDeepAgent: { plan: async (input) => ({ componentRecognition: input.recognition, plan: codeReadyPlan }) },
    codeGenerationAgent: { generate },
  });
}

/** 运行代码生成测试共享的设计读取、确认与方案分析。 */
async function inspectConfirmAndAnalyze(service: ReturnType<typeof createD2CService>) {
  const initial = await service.initialize({ projectPath: "/workspace" });
  const inspected = await service.inspectDesign({
    taskId: initial.taskId,
    expectedRevision: initial.revision,
    source,
  });
  const confirmed = await service.confirmDesign({
    taskId: inspected.taskId,
    expectedRevision: inspected.revision,
    confirmation: "确认设计",
  });
  return service.analyzeSecondStep({
    taskId: confirmed.taskId,
    expectedRevision: confirmed.revision,
  });
}

const codeReadyPlan = {
  ...reviewablePlan,
  contextGaps: [],
  fileImpacts: [{
    path: "src/Page.tsx",
    action: "create" as const,
    reason: "新增页面",
    affectedSymbols: ["Page"],
    downstreamConsumers: [],
    risk: "low" as const,
    evidence: ["设计结构"],
  }],
  steps: [{
    ...reviewablePlan.steps[0]!,
    id: "layout",
    files: [{ path: "src/Page.tsx", action: "create" as const }],
  }, {
    id: "validation",
    kind: "validation" as const,
    targetId: "plan",
    title: "验证",
    description: "验证候选代码",
    decision: "validate" as const,
    dependsOn: ["layout"],
    files: [],
    evidence: ["计划约束"],
    acceptanceCriteria: ["后续执行检查"],
    risks: [],
  }],
  files: ["src/Page.tsx"],
};
