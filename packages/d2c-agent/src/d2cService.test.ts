/** 验证设计检查、人工确认门禁、版本冲突、重置和 Artifact 生命周期行为。 */

import { describe, expect, it, vi } from "vitest";
import { createD2CService } from "./d2cService.js";
import type { PlanDeepAgentInput } from "./second-step/planDeepAgent.js";
import { bindPatchToPlan } from "./planning/evolvingPlan.js";
import { createCodePatchSet } from "./code-generation/codePatch.js";
import type { ProjectPatchApplyResult } from "./code-application/projectPatchApplier.js";
import type {
  DeliveryEvidenceStore,
  ProjectDeliveryValidationOutcome,
  ProjectDeliveryValidator,
} from "./delivery-validation/projectDeliveryValidator.js";
import {
  calculateDeliveryCommandPlanHash,
  type ApprovableDeliveryCommandPlan,
} from "./delivery-validation/deliveryCommand.js";

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
  validationTarget: { previewPath: "/" },
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
    expect(inspected.displayName).toBe("客户列表 · 表格");
    expect(inspected.displayNameSource).toBe("generated");
  });

  it("creates a timestamped draft name and preserves an explicit user name after inspection", async () => {
    const createdAt = new Date(2026, 7, 28, 17, 5);
    const service = createD2CService({
      designSourceAdapters: [{ id: "mastergo", inspect: async () => inspection }],
      projectInspector,
      componentCatalog,
      clock: () => createdAt,
    });
    const initial = await service.initialize({ projectPath: "/workspace", workspaceId: "git:demo" });
    expect(initial.displayName).toBe("新任务 · 08-28 17:05");

    const renamed = await service.renameTask({
      taskId: initial.taskId,
      expectedRevision: initial.revision,
      displayName: "客户中心列表",
    });
    const inspected = await service.inspectDesign({
      taskId: renamed.taskId,
      expectedRevision: renamed.revision,
      source,
    });

    expect(inspected.displayName).toBe("客户中心列表");
    expect(inspected.displayNameSource).toBe("user");
  });

  it("lists workspace tasks and preserves user metadata across archive and restore", async () => {
    let clockTick = 0;
    const service = createD2CService({
      designSourceAdapters: [{ id: "mastergo", inspect: async () => inspection }],
      projectInspector,
      componentCatalog,
      clock: () => new Date(Date.UTC(2026, 7, 28, 1, 0, clockTick++)),
    });
    const initial = await service.initialize({ projectPath: "/workspace", workspaceId: "git:demo" });
    await service.initialize({ projectPath: "/other", workspaceId: "git:other" });

    expect(await service.listTasks({ workspaceId: "git:demo" })).toEqual([
      expect.objectContaining({ taskId: initial.taskId, displayName: initial.displayName }),
    ]);

    const renamed = await service.renameTask({
      taskId: initial.taskId,
      expectedRevision: initial.revision,
      displayName: "  客户中心列表  ",
    });
    expect(renamed).toMatchObject({
      displayName: "客户中心列表",
      displayNameSource: "user",
      schemaVersion: 2,
    });

    const archived = await service.archiveTask({
      taskId: renamed.taskId,
      expectedRevision: renamed.revision,
    });
    expect(archived.archivedAt).toBeDefined();
    expect(await service.listTasks({ workspaceId: "git:demo" })).toEqual([]);
    expect(await service.listTasks({ workspaceId: "git:demo", includeArchived: true })).toEqual([
      expect.objectContaining({ taskId: initial.taskId, displayName: "客户中心列表" }),
    ]);
    await expect(service.inspectDesign({
      taskId: archived.taskId,
      expectedRevision: archived.revision,
      source,
    })).rejects.toThrow("归档");

    const restored = await service.restoreTask({
      taskId: archived.taskId,
      expectedRevision: archived.revision,
    });
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.displayName).toBe("客户中心列表");
    expect(await service.listTasks({ workspaceId: "git:demo" })).toHaveLength(1);
  });

  it("permanently deletes active and archived checkpoints and discards delivery evidence", async () => {
    const discardTask = vi.fn<DeliveryEvidenceStore["discardTask"]>(async () => undefined);
    const deliveryEvidenceStore = {
      write: async () => { throw new Error("not used"); },
      read: async () => { throw new Error("not used"); },
      discardTask,
    } satisfies DeliveryEvidenceStore;
    const service = createD2CService({
      designSourceAdapters: [],
      projectInspector,
      componentCatalog,
      deliveryEvidenceStore,
    });
    const active = await service.initialize({ workspaceId: "git:demo" });
    const archiveCandidate = await service.initialize({ workspaceId: "git:demo" });
    const archived = await service.archiveTask({
      taskId: archiveCandidate.taskId,
      expectedRevision: archiveCandidate.revision,
    });

    await expect(service.deleteTask({
      taskId: archived.taskId,
      expectedRevision: archiveCandidate.revision,
    })).rejects.toThrow("版本冲突");
    await service.deleteTask({ taskId: active.taskId, expectedRevision: active.revision });
    await service.deleteTask({ taskId: archived.taskId, expectedRevision: archived.revision });

    await expect(service.getTask(active.taskId)).rejects.toThrow("任务不存在");
    await expect(service.getTask(archived.taskId)).rejects.toThrow("任务不存在");
    await expect(service.listTasks({ workspaceId: "git:demo", includeArchived: true }))
      .resolves.toEqual([]);
    expect(discardTask.mock.calls.map(([taskId]) => taskId)).toEqual([
      active.taskId,
      archived.taskId,
    ]);
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

  it("pauses after applying the Patch and validates only after exact command approval", async () => {
    const generate = vi.fn(generateReadyPatch);
    const service = createCodeGenerationService(generate, "missing");
    const analyzed = await inspectConfirmAndAnalyze(service);
    const approved = await approveAnalyzedPlan(service, analyzed);
    const prepared = await service.generateCode({
      taskId: approved.taskId,
      expectedRevision: approved.revision,
    });
    const commandPlan = prepared.deliveryCommandPlan;
    if (commandPlan?.status !== "approval_required") throw new Error("测试缺少可批准命令计划。");
    await expect(service.approveDeliveryCommands({
      taskId: prepared.taskId,
      expectedRevision: prepared.revision,
      commandPlanHash: "f".repeat(64),
    })).rejects.toThrow("重新审阅");
    const commandApproved = await service.approveDeliveryCommands({
      taskId: prepared.taskId,
      expectedRevision: prepared.revision,
      commandPlanHash: commandPlan.commandPlanHash,
    });
    const generated = await service.generateCode({
      taskId: commandApproved.taskId,
      expectedRevision: commandApproved.revision,
    });
    const repeated = await service.generateCode({
      taskId: generated.taskId,
      expectedRevision: generated.revision,
    });

    expect(generated).toMatchObject({
      status: "delivery_ready",
      revision: approved.revision + 5,
      codeGeneration: { status: "ready", patchSet: { patchSetHash: expect.stringMatching(/^[a-f0-9]{64}$/) } },
      patchApplication: { status: "applied", alreadyApplied: false },
      deliveryCommandPlan: { status: "approval_required", commandPlanHash: commandPlan.commandPlanHash },
      deliveryCommandApproval: { commandPlanHash: commandPlan.commandPlanHash },
      deliveryValidation: { status: "passed" },
    });
    expect(prepared).toMatchObject({
      status: "command_approval_required",
      revision: approved.revision + 3,
      deliveryCommandPlan: { status: "approval_required" },
    });
    expect(generated.evolvingPlan?.patchBindings).toContainEqual(expect.objectContaining({ status: "active" }));
    expect(repeated).toEqual(generated);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("never offers automatic command approval for a manual-only command plan", async () => {
    const validate = vi.fn<ProjectDeliveryValidator["validate"]>();
    const prepare: ProjectDeliveryValidator["prepare"] = async ({ patchSetHash, workspaceRoot }) => {
      const commands: ApprovableDeliveryCommandPlan["commands"] = [];
      return {
        status: "manual_only",
        patchSetHash,
        workspaceRoot,
        commandPlanHash: calculateDeliveryCommandPlanHash({ patchSetHash, workspaceRoot, commands }),
        commands,
        summary: "目录外命令必须人工操作。",
        reason: "目标项目位于当前 Workspace 外。",
        preparedAt: "2026-08-28T00:00:00.000Z",
      };
    };
    const service = createCodeGenerationService(
      vi.fn(generateReadyPatch),
      "missing",
      undefined,
      validate,
      prepare,
    );
    const analyzed = await inspectConfirmAndAnalyze(service);
    const approved = await approveAnalyzedPlan(service, analyzed);
    const prepared = await service.generateCode({
      taskId: approved.taskId,
      expectedRevision: approved.revision,
    });

    expect(prepared).toMatchObject({
      status: "validation_blocked",
      deliveryCommandPlan: { status: "manual_only", commands: [] },
    });
    await expect(service.approveDeliveryCommands({
      taskId: prepared.taskId,
      expectedRevision: prepared.revision,
      commandPlanHash: prepared.deliveryCommandPlan?.commandPlanHash ?? "",
    })).rejects.toThrow("没有可批准");
    expect(validate).not.toHaveBeenCalled();
  });

  it("persists the candidate Patch and requests manual action when automatic apply is blocked", async () => {
    const generate = vi.fn(generateReadyPatch);
    const service = createCodeGenerationService(generate, "missing", {
      status: "blocked",
      summary: "候选 Patch 未写入目标项目，需要人工处理。",
      reasons: ["目标文件版本已变化：src/Page.tsx"],
      manualActionRequired: true,
    });
    const analyzed = await inspectConfirmAndAnalyze(service);
    const approved = await approveAnalyzedPlan(service, analyzed);

    const generated = await service.generateCode({
      taskId: approved.taskId,
      expectedRevision: approved.revision,
    });

    expect(generated).toMatchObject({
      status: "patch_ready",
      revision: approved.revision + 2,
      codeGeneration: { status: "ready" },
      patchApplication: {
        status: "blocked",
        manualActionRequired: true,
        reasons: ["目标文件版本已变化：src/Page.tsx"],
      },
    });
  });

  it("keeps applied files and resumes only validation after a delivery gate is blocked", async () => {
    const generate = vi.fn(generateReadyPatch);
    const validate = vi.fn()
      .mockImplementationOnce(async ({ patchSetHash }: { patchSetHash: string }) => ({
        status: "blocked" as const,
        patchSetHash,
        summary: "构建失败。",
        reasons: ["类型检查失败"],
        manualActionRequired: true as const,
        build: {
          status: "blocked" as const,
          command: "npm run build",
          durationMs: 2,
          summary: "构建未通过。",
          outputSummary: "TS2322",
          reason: "类型检查失败",
        },
        blockedAt: "2026-08-28T00:00:00.000Z",
      }))
      .mockImplementation(async ({ patchSetHash }: { patchSetHash: string }) => createPassedValidation(patchSetHash));
    const service = createCodeGenerationService(generate, "missing", undefined, validate);
    const analyzed = await inspectConfirmAndAnalyze(service);
    const approved = await approveAnalyzedPlan(service, analyzed);

    const prepared = await service.generateCode({
      taskId: approved.taskId,
      expectedRevision: approved.revision,
    });
    const firstApproval = await approvePreparedCommands(service, prepared);
    const blocked = await service.generateCode({
      taskId: firstApproval.taskId,
      expectedRevision: firstApproval.revision,
    });
    const rePrepared = await service.generateCode({
      taskId: blocked.taskId,
      expectedRevision: blocked.revision,
    });
    const secondApproval = await approvePreparedCommands(service, rePrepared);
    const resumed = await service.generateCode({
      taskId: secondApproval.taskId,
      expectedRevision: secondApproval.revision,
    });

    expect(blocked).toMatchObject({
      status: "validation_blocked",
      patchApplication: { status: "applied" },
      deliveryValidation: { status: "blocked", manualActionRequired: true },
    });
    expect(resumed).toMatchObject({
      status: "delivery_ready",
      patchApplication: { status: "applied" },
      deliveryValidation: { status: "passed" },
    });
    expect(generate).toHaveBeenCalledOnce();
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("requires an exact persisted Plan approval before code generation", async () => {
    const service = createCodeGenerationService(vi.fn(), "missing");
    const analyzed = await inspectConfirmAndAnalyze(service);
    const plan = analyzed.evolvingPlan;
    if (!plan) throw new Error("测试缺少版本化 Plan。");

    await expect(service.generateCode({
      taskId: analyzed.taskId,
      expectedRevision: analyzed.revision,
    })).rejects.toThrow("批准");
    await expect(service.approvePlan({
      taskId: analyzed.taskId,
      expectedRevision: analyzed.revision,
      planVersion: plan.planVersion,
      planHash: "f".repeat(64),
      executionMode: "generate-and-apply",
    })).rejects.toThrow("重新审阅");

    const approved = await service.approvePlan({
      taskId: analyzed.taskId,
      expectedRevision: analyzed.revision,
      planVersion: plan.planVersion,
      planHash: plan.planHash,
      executionMode: "generate-and-apply",
    });
    const repeated = await service.approvePlan({
      taskId: approved.taskId,
      expectedRevision: approved.revision,
      planVersion: plan.planVersion,
      planHash: plan.planHash,
      executionMode: "generate-and-apply",
    });

    expect(approved).toMatchObject({
      status: "plan_approved",
      revision: analyzed.revision + 1,
      planApproval: {
        planVersion: plan.planVersion,
        planHash: plan.planHash,
        approvedAt: expect.any(String),
      },
    });
    expect(repeated).toEqual(approved);
  });

  it("blocks generation before the model when a planned create file now exists", async () => {
    const generate = vi.fn();
    const service = createCodeGenerationService(generate, "existing");
    const analyzed = await inspectConfirmAndAnalyze(service);
    const approved = await approveAnalyzedPlan(service, analyzed);

    const blocked = await service.generateCode({
      taskId: approved.taskId,
      expectedRevision: approved.revision,
    });
    const retried = await service.generateCode({
      taskId: blocked.taskId,
      expectedRevision: blocked.revision,
    });

    expect(blocked).toMatchObject({
      status: "plan_approved",
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
  applyResult: ProjectPatchApplyResult | undefined = {
    status: "applied",
    files: [{ path: "src/Page.tsx", action: "create" }],
    alreadyApplied: false,
  },
  validate: ProjectDeliveryValidator["validate"] = async ({ patchSetHash }) => (
    createPassedValidation(patchSetHash)
  ),
  prepare: ProjectDeliveryValidator["prepare"] = async ({ patchSetHash, workspaceRoot }) => (
    createApprovableCommandPlan(patchSetHash, workspaceRoot)
  ),
) {
  const effectiveApplyResult = applyResult ?? {
    status: "applied" as const,
    files: [{ path: "src/Page.tsx", action: "create" as const }],
    alreadyApplied: false,
  };
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
    projectPatchApplier: { apply: async () => structuredClone(effectiveApplyResult) },
    projectDeliveryValidator: { prepare, validate },
  });
}

/** 创建代码阶段测试共享的三项自动门禁通过结果。 */
function createPassedValidation(patchSetHash: string): ProjectDeliveryValidationOutcome {
  return {
    status: "passed",
    patchSetHash,
    summary: "自动交付验收通过。",
    build: {
      status: "passed",
      command: "npm run build",
      durationMs: 1,
      summary: "构建通过。",
      outputSummary: "",
    },
    render: {
      status: "passed",
      durationMs: 1,
      summary: "渲染通过。",
      previewPath: "/",
      viewport: { width: 320, height: 240 },
    },
    visual: {
      status: "passed",
      durationMs: 1,
      summary: "视觉门禁通过。",
      pixelDifferenceRatio: 0.01,
      threshold: 0.1,
    },
    validatedAt: "2026-08-28T00:00:00.000Z",
  };
}

/** 为 Service 生命周期测试生成经过真实确定性哈希门禁的候选 Patch。 */
async function generateReadyPatch(
  input: import("./code-generation/codeGenerationAgent.js").CodeGenerationAgentInput,
) {
  const patchSet = createCodePatchSet(input.plan, input.codeContext, {
    status: "generated",
    summary: "候选页面代码",
    stepPatches: [{
      stepId: "layout",
      files: [{
        path: "src/Page.tsx",
        action: "create",
        content: "export function Page() { return null; }\n",
      }],
    }],
    warnings: [],
    blockedReasons: [],
  });
  if ("blocked" in patchSet) throw new Error("测试预期生成候选 Patch。");
  const patchHash = patchSet.patches[0]?.patchHash;
  if (!patchHash) throw new Error("测试候选 Patch 缺少步骤哈希。");
  return {
    outcome: { status: "ready" as const, patchSet },
    plan: bindPatchToPlan(input.plan, {
      patchHash,
      planHash: input.plan.planHash,
      stepId: "layout",
    }),
  };
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

/** 批准代码生成测试刚刚持久化的精确 Plan。 */
async function approveAnalyzedPlan(
  service: ReturnType<typeof createD2CService>,
  analyzed: Awaited<ReturnType<typeof inspectConfirmAndAnalyze>>,
) {
  const plan = analyzed.evolvingPlan;
  if (!plan) throw new Error("测试缺少版本化 Plan。");
  return service.approvePlan({
    taskId: analyzed.taskId,
    expectedRevision: analyzed.revision,
    planVersion: plan.planVersion,
    planHash: plan.planHash,
    executionMode: "generate-and-apply",
  });
}

/** 批准代码阶段刚刚准备并持久化的精确命令计划。 */
async function approvePreparedCommands(
  service: ReturnType<typeof createD2CService>,
  prepared: Awaited<ReturnType<ReturnType<typeof createD2CService>["generateCode"]>>,
) {
  const commandPlan = prepared.deliveryCommandPlan;
  if (commandPlan?.status !== "approval_required") throw new Error("测试缺少可批准命令计划。");
  return service.approveDeliveryCommands({
    taskId: prepared.taskId,
    expectedRevision: prepared.revision,
    commandPlanHash: commandPlan.commandPlanHash,
  });
}

/** 创建只用于领域生命周期测试的精确命令计划。 */
function createApprovableCommandPlan(
  patchSetHash: string,
  workspaceRoot: string,
): ApprovableDeliveryCommandPlan {
  const commands = [{
    commandId: "build-vite",
    purpose: "build-vite" as const,
    cwd: workspaceRoot,
    executable: "/usr/bin/node",
    arguments: [`${workspaceRoot}/node_modules/vite/bin/vite.js`, "build"],
    displayCommand: `/usr/bin/node ${workspaceRoot}/node_modules/vite/bin/vite.js build`,
    timeoutMs: 60_000,
    networkAccess: "none" as const,
    workspaceScope: "within-workspace" as const,
  }];
  return {
    status: "approval_required",
    patchSetHash,
    workspaceRoot,
    commandPlanHash: calculateDeliveryCommandPlanHash({ patchSetHash, workspaceRoot, commands }),
    commands,
    summary: "测试命令等待批准。",
    preparedAt: "2026-08-28T00:00:00.000Z",
  };
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
