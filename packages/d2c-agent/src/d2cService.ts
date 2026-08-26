/** 实现设计读取、规划、Plan 写入授权、精确命令授权与受控交付的公共 D2C Service。 */

import { randomUUID } from "node:crypto";
import type { AgentCore } from "@ui-forge/agent-core";
import type { DesignArtifactLifecycle } from "./design-context/designArtifact.js";
import type { DesignArtifactReader } from "./design-context/designArtifact.js";
import { createDesignContextResolver } from "./design-context/designContextResolver.js";
import type { DesignInspection } from "./design-context/designInspection.js";
import type { DesignSourceAdapter } from "./design-context/designSourceAdapter.js";
import { createDeterministicDesignComponentRecognizer } from "./design-components/deterministicDesignComponentRecognizer.js";
import type { DesignComponentRecognizer } from "./design-components/designComponentRecognition.js";
import { parseComponentCatalog, type ComponentCatalog } from "./design-components/componentCatalog.js";
import type {
  ApproveDeliveryCommandsCommand,
  ApprovePlanCommand,
  ConfirmDesignCommand,
  D2CTaskCommand,
  InspectDesignCommand,
  RenameTaskCommand,
} from "./d2cCommand.js";
import type { D2CTask } from "./d2cTask.js";
import { createD2CGraph, type D2CGraph } from "./graph/d2cGraph.js";
import type { ProjectInspector } from "./project-context/projectInspector.js";
import type { ProjectContextAnalyzer } from "./project-context/projectContextAnalysis.js";
import {
  createPlanDeepAgent,
  type PlanDeepAgent,
  type PlanDeepAgentModelOptions,
} from "./second-step/planDeepAgent.js";
import type { DesignVisualEvidenceProvider } from "./second-step/designVisualEvidence.js";
import type { SecondStepProgressReporter } from "./second-step/secondStepProgress.js";
import type { DesignSystemKnowledgeProvider } from "./design-system/designSystemKnowledge.js";
import {
  createCodeGenerationAgent,
  type CodeGenerationAgent,
  type CodeGenerationAgentModelOptions,
} from "./code-generation/codeGenerationAgent.js";
import type { ProjectCodeContextReader } from "./code-generation/projectCodeContext.js";
import type { CodeGenerationProgressReporter } from "./code-generation/codeGenerationProgress.js";
import { assertCodePatchSetIntegrity } from "./code-generation/codePatch.js";
import type {
  ProjectPatchApplier,
  ProjectPatchApplyResult,
} from "./code-application/projectPatchApplier.js";
import { createEvolvingPlanningResult } from "./planning/evolvingPlan.js";
import { createPlanningIntent } from "./planning/createPlanningIntent.js";
import type {
  DeliveryEvidenceStore,
  ProjectDeliveryValidationOutcome,
  ProjectDeliveryValidator,
} from "./delivery-validation/projectDeliveryValidator.js";
import {
  assertDeliveryCommandPlanIntegrity,
  calculateDeliveryCommandPlanHash,
  type DeliveryCommandPlan,
} from "./delivery-validation/deliveryCommand.js";

const defaultTaskGoal = "结合目标 React + Ant Design 项目与 MasterGo 设计稿生成整体修改方案";
const defaultTaskDisplayName = "新任务";
const maximumTaskDisplayNameLength = 120;
const currentTaskSchemaVersion = 2;
const requiredDesignConfirmation = "确认设计";

/** Agent Server 可调用的完整 D2C 领域服务；确认规则与状态持久化均由该边界拥有。 */
export interface D2CService {
  /** 创建并保存初始设计输入任务。 */
  initialize(input: {
    projectPath?: string | undefined;
    workspaceId?: string | undefined;
  }): Promise<D2CTask>;
  /** 读取指定任务的最新权威状态。 */
  getTask(taskId: string): Promise<D2CTask>;
  /** 枚举指定 Workspace 的最新任务，并默认隐藏软归档项。 */
  listTasks(input: { workspaceId: string; includeArchived?: boolean }): Promise<D2CTask[]>;
  /** 更新任务侧边栏展示名称。 */
  renameTask(command: RenameTaskCommand): Promise<D2CTask>;
  /** 软归档任务并保留全部 Checkpoint、Artifact 和验收证据。 */
  archiveTask(command: D2CTaskCommand): Promise<D2CTask>;
  /** 恢复软归档任务，保持原业务状态和批准绑定。 */
  restoreTask(command: D2CTaskCommand): Promise<D2CTask>;
  /** 永久删除任务 Checkpoint，并尽力清理任务绑定证据。 */
  deleteTask(command: D2CTaskCommand): Promise<void>;
  /** 读取并保存用户指定设计来源的标准化上下文和 SVG 预览。 */
  inspectDesign(command: InspectDesignCommand): Promise<D2CTask>;
  /** 将人工确认作为独立的持久化领域状态迁移。 */
  confirmDesign(command: ConfirmDesignCommand): Promise<D2CTask>;
  /** 在用户进入第二步后运行主 DeepAgent，并保存项目与组件分析结果。 */
  analyzeSecondStep(
    command: D2CTaskCommand,
    reportProgress?: SecondStepProgressReporter,
    signal?: AbortSignal,
  ): Promise<D2CTask>;
  /** 持久化用户对当前 Plan 版本与内容哈希的明确批准。 */
  approvePlan(command: ApprovePlanCommand): Promise<D2CTask>;
  /** 持久化用户对当前精确交付命令计划的批准。 */
  approveDeliveryCommands(command: ApproveDeliveryCommandsCommand): Promise<D2CTask>;
  /** 按 Plan 授权生成和应用，并只在命令计划另行批准后执行验收。 */
  generateCode(
    command: D2CTaskCommand,
    reportProgress?: CodeGenerationProgressReporter,
    signal?: AbortSignal,
  ): Promise<D2CTask>;
  /** 清除当前设计与预览确认结果，回到设计输入状态。 */
  reset(command: D2CTaskCommand): Promise<D2CTask>;
}


/** 创建 D2C Service 所需的设计、存储、Workspace 应用和 Graph 持久化端口。 */
export interface D2CServiceOptions {
  designSourceAdapters: readonly DesignSourceAdapter[];
  projectInspector: ProjectInspector;
  projectContextAnalyzer?: ProjectContextAnalyzer;
  planDeepAgent?: PlanDeepAgent;
  modelOptions?: PlanDeepAgentModelOptions;
  /** 可在测试或宿主组合边界替换默认 Code Agent。 */
  codeGenerationAgent?: CodeGenerationAgent;
  /** 单独覆盖代码阶段模型配置；省略时复用规划模型配置。 */
  codeGenerationModelOptions?: CodeGenerationAgentModelOptions;
  /** 读取计划文件与复用参考文件的受控文本快照。 */
  projectCodeContextReader?: ProjectCodeContextReader;
  /** 把完整候选 Patch 受控应用到任务绑定目标项目。 */
  projectPatchApplier?: ProjectPatchApplier;
  /** 对已落盘项目执行受控构建、页面渲染和视觉验收。 */
  projectDeliveryValidator?: ProjectDeliveryValidator;
  /** 保存并按任务所有权读取交付验收图片证据。 */
  deliveryEvidenceStore?: DeliveryEvidenceStore;
  visualEvidenceProvider?: DesignVisualEvidenceProvider;
  designArtifactReader?: DesignArtifactReader;
  designComponentRecognizer?: DesignComponentRecognizer;
  componentCatalog: ComponentCatalog;
  designSystemKnowledgeProvider?: DesignSystemKnowledgeProvider;
  designArtifactLifecycle?: DesignArtifactLifecycle;
  checkpointer?: AgentCore.Checkpointer;
  /** 为任务元数据测试提供可重复时钟。 */
  clock?: () => Date;
}

/** 创建通过单一 D2C Graph 与确定性应用端口完成当前交付流程的公共 Service。 */
export function createD2CService(options: D2CServiceOptions): D2CService {
  return new DefaultD2CService(options);
}

/** 持有任务并发控制和 Artifact 生命周期协调的默认 Service 实现。 */
class DefaultD2CService implements D2CService {
  private readonly graph: D2CGraph;
  private readonly taskUpdateLocks = new Map<string, Promise<void>>();
  private readonly designArtifactLifecycle: DesignArtifactLifecycle | undefined;
  private readonly projectPatchApplier: ProjectPatchApplier;
  private readonly projectDeliveryValidator: ProjectDeliveryValidator;
  private readonly deliveryEvidenceStore: DeliveryEvidenceStore | undefined;
  private readonly clock: () => Date;

  /** 注入全部领域端口并只创建一个共享 D2C Graph。 */
  constructor(options: D2CServiceOptions) {
    const componentCatalog = parseComponentCatalog(options.componentCatalog);
    const designComponentRecognizer = options.designComponentRecognizer
      ?? createDeterministicDesignComponentRecognizer();
    const projectContextAnalyzer = options.projectContextAnalyzer ?? {
      analyze: async ({ inspection }: Parameters<ProjectContextAnalyzer["analyze"]>[0]) => ({
        kind: inspection.kind,
        files: [],
        filesComplete: inspection.kind === "empty",
        matches: [],
        warnings: inspection.kind === "react_antd"
          ? ["当前未配置目标仓库上下文分析器，组件复用和文件影响只能标记为未解决。"]
          : [],
      }),
    } satisfies ProjectContextAnalyzer;
    const planDeepAgent = options.planDeepAgent ?? createPlanDeepAgent(
      options.visualEvidenceProvider,
      componentCatalog,
      options.modelOptions,
      undefined,
      options.designSystemKnowledgeProvider,
      projectContextAnalyzer,
    );
    const codeGenerationAgent = options.codeGenerationAgent ?? createCodeGenerationAgent(
      componentCatalog,
      options.codeGenerationModelOptions ?? options.modelOptions,
    );
    this.graph = createD2CGraph({
      designContextResolver: createDesignContextResolver(options.designSourceAdapters),
      projectInspector: options.projectInspector,
      projectContextAnalyzer,
      componentRecognizer: designComponentRecognizer,
      baseComponentCatalog: componentCatalog,
      ...(options.designSystemKnowledgeProvider
        ? { designSystemKnowledgeProvider: options.designSystemKnowledgeProvider }
        : {}),
      planDeepAgent,
      codeGenerationAgent,
      projectCodeContextReader: options.projectCodeContextReader ?? {
        read: async () => { throw new Error("当前未配置目标仓库代码上下文读取器。"); },
      },
      ...(options.designArtifactReader ? { artifactReader: options.designArtifactReader } : {}),
      ...(options.checkpointer ? { checkpointer: options.checkpointer } : {}),
    });
    this.designArtifactLifecycle = options.designArtifactLifecycle;
    this.projectPatchApplier = options.projectPatchApplier ?? {
      apply: async () => ({
        status: "blocked",
        summary: "当前运行环境未配置目标项目 Patch 应用器。",
        reasons: ["请由宿主装配受控 Workspace 写入能力后重试。"],
        manualActionRequired: true,
      }),
    };
    this.projectDeliveryValidator = options.projectDeliveryValidator ?? {
      prepare: async ({ patchSetHash, workspaceRoot }) => {
        const commands: never[] = [];
        return {
          status: "manual_only",
          patchSetHash,
          workspaceRoot,
          commandPlanHash: calculateDeliveryCommandPlanHash({
            patchSetHash,
            workspaceRoot,
            commands,
          }),
          commands,
          summary: "当前运行环境未配置自动交付命令准备器。",
          reason: "请由宿主装配受控交付命令能力后手工完成验收。",
          preparedAt: new Date().toISOString(),
        };
      },
      validate: async ({ patchSetHash }) => ({
        status: "blocked",
        patchSetHash,
        summary: "当前运行环境未配置自动交付验收器。",
        reasons: ["请由宿主装配受控构建、页面渲染与视觉验收能力后重试。"],
        manualActionRequired: true,
        build: {
          status: "blocked",
          command: "未启动",
          durationMs: 0,
          summary: "构建未启动。",
          outputSummary: "",
          reason: "缺少自动交付验收器。",
        },
        blockedAt: new Date().toISOString(),
      }),
    };
    this.deliveryEvidenceStore = options.deliveryEvidenceStore;
    this.clock = options.clock ?? (() => new Date());
  }

  /** 创建 draft 任务并写入以 UUID 为 threadId 的首个 Checkpoint。 */
  async initialize(input: {
    projectPath?: string | undefined;
    workspaceId?: string | undefined;
  }): Promise<D2CTask> {
    const createdAtDate = this.clock();
    const createdAt = createdAtDate.toISOString();
    return this.saveTask({
      schemaVersion: currentTaskSchemaVersion,
      taskId: randomUUID(),
      workspaceId: input.workspaceId ?? "unknown",
      displayName: createDraftTaskDisplayName(createdAtDate),
      displayNameSource: "generated",
      createdAt,
      updatedAt: createdAt,
      revision: 0,
      status: "draft",
      projectPath: input.projectPath ?? "",
      taskGoal: defaultTaskGoal,
    });
  }

  /** 读取权威任务并返回隔离副本。 */
  async getTask(taskId: string): Promise<D2CTask> {
    return copyTask(await this.requireTask(taskId));
  }

  /** 从唯一 Checkpoint 事实来源枚举并过滤当前 Workspace 任务。 */
  async listTasks(input: { workspaceId: string; includeArchived?: boolean }): Promise<D2CTask[]> {
    const tasks = await this.graph.listTasks();
    return tasks
      .map((task) => normalizePersistedTask(task))
      .filter((task) => task.workspaceId === input.workspaceId
        && (input.includeArchived === true || task.archivedAt === undefined))
      .sort((left, right) => compareTasksByRecentActivity(left, right))
      .map(copyTask);
  }

  /** 持久化人工任务名称，并通过 revision 防止覆盖其他客户端更新。 */
  async renameTask(command: RenameTaskCommand): Promise<D2CTask> {
    return this.withTaskUpdateLock(command.taskId, async () => {
      const current = await this.requireTask(command.taskId);
      this.requireCommandRevision(command, current);
      const displayName = command.displayName.trim();
      if (!displayName || displayName.length > 120) {
        throw new Error("任务名称必须位于 1 到 120 个字符之间。");
      }
      return this.saveTask({
        ...copyTask(current),
        revision: current.revision + 1,
        displayName,
        displayNameSource: "user",
      });
    });
  }

  /** 软归档任务；活动命令会先通过同一任务锁完成或结束。 */
  async archiveTask(command: D2CTaskCommand): Promise<D2CTask> {
    return this.withTaskUpdateLock(command.taskId, async () => {
      const current = await this.requireTask(command.taskId);
      this.requireCommandRevision(command, current);
      return this.saveTask({
        ...copyTask(current),
        revision: current.revision + 1,
        archivedAt: this.clock().toISOString(),
      });
    });
  }

  /** 恢复软归档任务，并保留恢复前的业务状态。 */
  async restoreTask(command: D2CTaskCommand): Promise<D2CTask> {
    return this.withTaskUpdateLock(command.taskId, async () => {
      const current = await this.requireTask(command.taskId);
      this.requireCommandRevision(command, current, { allowArchived: true });
      if (!current.archivedAt) throw new Error("当前任务尚未归档。");
      const restored = copyTask(current);
      delete restored.archivedAt;
      return this.saveTask({ ...restored, revision: current.revision + 1 });
    });
  }

  /** 永久删除活动或归档任务，并在权威状态消失后尽力回收绑定文件。 */
  async deleteTask(command: D2CTaskCommand): Promise<void> {
    await this.withTaskUpdateLock(command.taskId, async () => {
      const current = await this.requireTask(command.taskId);
      this.requireCommandRevision(command, current, { allowArchived: true });
      const artifactId = current.inspectedDesign?.artifact?.artifactId;
      await this.graph.deleteTask(command.taskId);
      if (artifactId) await this.abandonArtifactSafely(artifactId);
      await this.discardDeliveryEvidenceSafely(command.taskId);
    });
  }

  /** 校验 draft 版本，执行设计检查并协调 Artifact 生命周期。 */
  async inspectDesign(command: InspectDesignCommand): Promise<D2CTask> {
    return this.withTaskUpdateLock(command.taskId, async () => {
      const current = await this.requireTask(command.taskId);
      this.requireCommandRevision(command, current);
      if (current.status !== "draft") throw new Error("当前任务不在设计输入阶段。");
      const previousArtifactId = current.inspectedDesign?.artifact?.artifactId;
      const startedAt = Date.now();
      let inspection;
      try {
        inspection = await this.graph.inspectDesign(command.taskId, command.source);
      } catch (error: unknown) {
        throw normalizeError(error, "设计读取失败。");
      }
      const artifactId = inspection.artifact?.artifactId;
      try {
        if (artifactId) {
          await this.designArtifactLifecycle?.attach(artifactId, {
            taskId: current.taskId,
            workspaceId: current.workspaceId,
            revision: current.revision + 1,
          });
        }
        const updated = await this.saveTask({
          ...copyTask(current),
          revision: current.revision + 1,
          status: "svg_ready",
          designSource: structuredClone(command.source),
          inspectedDesign: { ...inspection, durationMs: Date.now() - startedAt },
          taskGoal: createTaskGoal(inspection),
          displayName: current.displayNameSource === "user"
            ? current.displayName ?? defaultTaskDisplayName
            : createTaskDisplayName(inspection),
          displayNameSource: current.displayNameSource === "user" ? "user" : "generated",
        });
        if (previousArtifactId && previousArtifactId !== artifactId) {
          await this.supersedeArtifactSafely(previousArtifactId);
        }
        return updated;
      } catch (error: unknown) {
        if (artifactId && artifactId !== previousArtifactId) {
          await this.abandonArtifactSafely(artifactId);
        }
        throw error;
      }
    });
  }

  /** 校验精确人工口令并持久化设计确认暂停点。 */
  async confirmDesign(command: ConfirmDesignCommand): Promise<D2CTask> {
    return this.withTaskUpdateLock(command.taskId, async () => {
      const current = await this.requireTask(command.taskId);
      this.requireCommandRevision(command, current);
      if (command.confirmation !== requiredDesignConfirmation) {
        throw new Error(`请输入精确口令“${requiredDesignConfirmation}”。`);
      }
      if (current.status !== "svg_ready" || !current.inspectedDesign) {
        throw new Error("当前任务没有可确认的设计预览。");
      }
      return this.saveTask({
        ...copyTask(current),
        revision: current.revision + 1,
        status: "design_confirmed",
      });
    });
  }

  /** 只允许从 design_confirmed 启动分析，并一次提交全部权威分析结果。 */
  async analyzeSecondStep(
    command: D2CTaskCommand,
    reportProgress?: SecondStepProgressReporter,
    signal?: AbortSignal,
  ): Promise<D2CTask> {
    return this.withTaskUpdateLock(command.taskId, async () => {
      const current = await this.requireTask(command.taskId);
      if (current.status === "analysis_ready" || current.status === "plan_approved"
        || current.status === "patch_ready" || current.status === "patch_applied"
        || current.status === "command_approval_required" || current.status === "command_approved"
        || current.status === "validation_blocked" || current.status === "delivery_ready") return copyTask(current);
      this.requireCommandRevision(command, current);
      if (current.status !== "design_confirmed" || !current.inspectedDesign) {
        throw new Error("请先读取并确认 MasterGo 设计。");
      }
      let analysis;
      try {
        analysis = await this.graph.analyzeSecondStep(command.taskId, reportProgress, signal);
      } catch (error: unknown) {
        throw normalizeError(error, "第二步 DeepAgent 分析失败。");
      }
      return this.saveTask({
        ...copyTask(current),
        revision: current.revision + 1,
        status: "analysis_ready",
        projectInspection: structuredClone(analysis.projectInspection),
        ...(analysis.componentRecognition
          ? { componentRecognition: structuredClone(analysis.componentRecognition) }
          : {}),
        ...(analysis.plan ? { plan: structuredClone(analysis.plan) } : {}),
        ...(analysis.plan && analysis.componentRecognition
          ? {
              evolvingPlan: createEvolvingPlanningResult(
                createPlanningIntent(analysis.plan, analysis.componentRecognition),
                analysis.plan,
              ),
            }
          : {}),
      });
    });
  }

  /** 校验并持久化用户对精确 Plan 版本和内容哈希的批准。 */
  async approvePlan(command: ApprovePlanCommand): Promise<D2CTask> {
    return this.withTaskUpdateLock(command.taskId, async () => {
      const current = await this.requireTask(command.taskId);
      if ((current.status === "plan_approved" || current.status === "patch_ready"
        || current.status === "patch_applied" || current.status === "command_approval_required"
        || current.status === "command_approved" || current.status === "validation_blocked"
        || current.status === "delivery_ready")
        && current.planApproval?.planVersion === command.planVersion
        && current.planApproval.planHash === command.planHash
        && current.planApproval.executionMode === command.executionMode) {
        return copyTask(current);
      }
      this.requireCommandRevision(command, current);
      if (current.status !== "analysis_ready" || !current.plan || !current.evolvingPlan) {
        throw new Error("当前任务没有可以批准的整体修改方案。");
      }
      if (current.plan.status !== "reviewable" || current.evolvingPlan.execution.files.length === 0) {
        throw new Error("当前方案仍有上下文缺口或没有文件操作，不能批准。");
      }
      if (current.evolvingPlan.planVersion !== command.planVersion
        || current.evolvingPlan.planHash !== command.planHash) {
        throw new Error("方案版本或内容已经变化，请重新审阅后再批准。");
      }
      if (command.executionMode !== "generate-and-apply") {
        throw new Error("当前只支持批准后自动生成并安全应用的执行模式。");
      }
      return this.saveTask({
        ...copyTask(current),
        revision: current.revision + 1,
        status: "plan_approved",
        planApproval: {
          planVersion: command.planVersion,
          planHash: command.planHash,
          executionMode: command.executionMode,
          approvedAt: new Date().toISOString(),
        },
      });
    });
  }

  /** 校验并持久化用户对当前 Patch 后精确命令计划的批准。 */
  async approveDeliveryCommands(command: ApproveDeliveryCommandsCommand): Promise<D2CTask> {
    return this.withTaskUpdateLock(command.taskId, async () => {
      const current = await this.requireTask(command.taskId);
      if (current.status === "command_approved"
        && current.deliveryCommandApproval?.commandPlanHash === command.commandPlanHash) {
        return copyTask(current);
      }
      this.requireCommandRevision(command, current);
      const plan = current.deliveryCommandPlan;
      if (current.status !== "command_approval_required" || plan?.status !== "approval_required") {
        throw new Error("当前任务没有可批准的 Workspace 命令计划。");
      }
      assertDeliveryCommandPlanIntegrity(plan);
      if (plan.commandPlanHash !== command.commandPlanHash) {
        throw new Error("交付命令计划已经变化，请重新审阅后再批准。");
      }
      return this.saveTask({
        ...copyTask(current),
        revision: current.revision + 1,
        status: "command_approved",
        deliveryCommandApproval: {
          commandPlanHash: command.commandPlanHash,
          approvedAt: this.clock().toISOString(),
        },
      });
    });
  }

  /** 生成并应用 Patch；准备命令后暂停，只有精确命令批准才继续验收。 */
  async generateCode(
    command: D2CTaskCommand,
    reportProgress?: CodeGenerationProgressReporter,
    signal?: AbortSignal,
  ): Promise<D2CTask> {
    return this.withTaskUpdateLock(command.taskId, async () => {
      const current = await this.requireTask(command.taskId);
      if (current.status === "delivery_ready" && current.deliveryValidation?.status === "passed") {
        return copyTask(current);
      }
      this.requireCommandRevision(command, current);
      if ((current.status !== "plan_approved" && current.status !== "patch_ready"
        && current.status !== "patch_applied" && current.status !== "command_approved"
        && current.status !== "validation_blocked")
        || !current.plan || !current.evolvingPlan
        || !current.planApproval) {
        throw new Error("请先明确批准当前整体修改方案。");
      }
      if (current.plan.status !== "reviewable") {
        throw new Error("当前方案仍有上下文缺口，不能生成候选 Patch。");
      }
      if (current.evolvingPlan.execution.files.length === 0) {
        throw new Error("当前方案没有可以生成代码的文件操作。");
      }
      if (current.planApproval.planVersion !== current.evolvingPlan.planVersion
        || current.planApproval.planHash !== current.evolvingPlan.planHash) {
        throw new Error("已批准方案与当前方案不一致，请重新审阅并批准。");
      }
      if (current.planApproval.executionMode !== "generate-and-apply") {
        throw new Error("当前批准未授权自动生成和安全应用。");
      }
      let patchReadyTask = current;
      if (current.status === "plan_approved") {
        let generated;
        try {
          generated = await this.graph.generateCode(command.taskId, reportProgress, signal);
        } catch (error: unknown) {
          throw normalizeError(error, "候选代码 Patch 生成失败。");
        }
        const outcome = structuredClone(generated.outcome);
        if (outcome.status === "blocked") {
          return this.saveTask({
            ...copyTask(current),
            revision: current.revision + 1,
            status: "plan_approved",
            codeGeneration: outcome,
            ...(generated.evolvingPlan ? { evolvingPlan: structuredClone(generated.evolvingPlan) } : {}),
          });
        }
        assertCodePatchSetIntegrity(outcome.patchSet);
        patchReadyTask = await this.saveTask({
          ...copyTask(current),
          revision: current.revision + 1,
          status: "patch_ready",
          codeGeneration: outcome,
          ...(generated.evolvingPlan ? { evolvingPlan: structuredClone(generated.evolvingPlan) } : {}),
        });
      }
      if (patchReadyTask.codeGeneration?.status !== "ready"
        || !patchReadyTask.projectInspection
        || patchReadyTask.projectInspection.kind === "unsupported") {
        throw new Error("当前任务没有可以应用的完整候选 Patch。");
      }
      const patchSet = patchReadyTask.codeGeneration.patchSet;
      assertCodePatchSetIntegrity(patchSet);
      if (patchSet.planVersion !== patchReadyTask.planApproval?.planVersion
        || patchSet.planHash !== patchReadyTask.planApproval.planHash) {
        throw new Error("候选 Patch 与已授权 Plan 不一致，已停止写入。");
      }
      let patchAppliedTask = patchReadyTask;
      if (patchReadyTask.status === "plan_approved" || patchReadyTask.status === "patch_ready") {
        throwIfAborted(signal);
        const fileCount = new Set(patchSet.patches.flatMap((patch) => (
          patch.operations.map((operation) => operation.path)
        ))).size;
        await reportProgress?.({ type: "patch-application-start", fileCount });
        const application = await this.applyPatchSafely(
          patchReadyTask.projectInspection,
          patchSet,
        );
        if (application.status === "blocked") {
          await reportProgress?.({
            type: "patch-application-blocked",
            reasonCount: application.reasons.length,
          });
          return this.saveTask({
            ...copyTask(patchReadyTask),
            revision: patchReadyTask.revision + 1,
            status: "patch_ready",
            patchApplication: {
              ...application,
              patchSetHash: patchSet.patchSetHash,
              blockedAt: new Date().toISOString(),
            },
          });
        }
        await reportProgress?.({
          type: "patch-application-complete",
          fileCount: application.files.length,
          alreadyApplied: application.alreadyApplied,
        });
        patchAppliedTask = await this.saveTask({
          ...copyTask(patchReadyTask),
          revision: patchReadyTask.revision + 1,
          status: "patch_applied",
          patchApplication: {
            ...application,
            patchSetHash: patchSet.patchSetHash,
            appliedAt: new Date().toISOString(),
          },
        });
      }
      if (patchAppliedTask.status !== "command_approved") {
        throwIfAborted(signal);
        const commandPlan = await this.prepareDeliveryCommandsSafely(patchAppliedTask);
        const preparedTask = copyTask(patchAppliedTask);
        delete preparedTask.deliveryCommandApproval;
        delete preparedTask.deliveryValidation;
        return this.saveTask({
          ...preparedTask,
          revision: patchAppliedTask.revision + 1,
          status: commandPlan.status === "approval_required"
            ? "command_approval_required"
            : "validation_blocked",
          deliveryCommandPlan: commandPlan,
        });
      }
      throwIfAborted(signal);
      const validation = await this.validateDeliverySafely(patchAppliedTask, reportProgress, signal);
      return this.saveTask({
        ...copyTask(patchAppliedTask),
        revision: patchAppliedTask.revision + 1,
        status: validation.status === "passed" ? "delivery_ready" : "validation_blocked",
        deliveryValidation: validation,
      });
    });
  }

  /** 回到 draft 并移除设计与预览确认结果。 */
  async reset(command: D2CTaskCommand): Promise<D2CTask> {
    return this.withTaskUpdateLock(command.taskId, async () => {
      const current = await this.requireTask(command.taskId);
      this.requireCommandRevision(command, current);
      const artifactId = current.inspectedDesign?.artifact?.artifactId;
      const next: D2CTask = {
        ...copyTask(current),
        revision: current.revision + 1,
        status: "draft",
      };
      delete next.designSource;
      delete next.inspectedDesign;
      delete next.projectInspection;
      delete next.componentRecognition;
      delete next.plan;
      delete next.evolvingPlan;
      delete next.planApproval;
      delete next.codeGeneration;
      delete next.patchApplication;
      delete next.deliveryCommandPlan;
      delete next.deliveryCommandApproval;
      delete next.deliveryValidation;
      const reset = await this.saveTask(next);
      if (artifactId) await this.supersedeArtifactSafely(artifactId);
      await this.discardDeliveryEvidenceSafely(current.taskId);
      return reset;
    });
  }

  /** 将适配器异常收敛为需要人工处理的应用阻塞结果。 */
  private async applyPatchSafely(
    inspection: Exclude<NonNullable<D2CTask["projectInspection"]>, { kind: "unsupported" }>,
    patchSet: NonNullable<Extract<D2CTask["codeGeneration"], { status: "ready" }>>["patchSet"],
  ): Promise<ProjectPatchApplyResult> {
    try {
      return await this.projectPatchApplier.apply({ inspection, patchSet });
    } catch (error: unknown) {
      return {
        status: "blocked",
        summary: "候选 Patch 未能安全应用，目标项目需要人工检查。",
        reasons: [normalizeError(error, "Workspace 写入失败。").message],
        manualActionRequired: true,
      };
    }
  }

  /** 将命令准备异常持久化为禁止自动执行的人工计划。 */
  private async prepareDeliveryCommandsSafely(task: D2CTask): Promise<DeliveryCommandPlan> {
    const patchSetHash = task.codeGeneration?.status === "ready"
      ? task.codeGeneration.patchSet.patchSetHash
      : "";
    if (!task.projectInspection || task.projectInspection.kind === "unsupported" || !patchSetHash) {
      throw new Error("当前任务缺少交付命令准备所需的权威上下文。");
    }
    try {
      const plan = await this.projectDeliveryValidator.prepare({
        taskId: task.taskId,
        workspaceRoot: task.projectPath,
        inspection: task.projectInspection,
        patchSetHash,
      });
      assertDeliveryCommandPlanIntegrity(plan);
      if (plan.patchSetHash !== patchSetHash) {
        throw new Error("交付命令计划与当前候选 Patch 不一致。");
      }
      return plan;
    } catch (error: unknown) {
      const reason = normalizeError(error, "交付命令准备失败。").message;
      const commands: never[] = [];
      return {
        status: "manual_only",
        patchSetHash,
        workspaceRoot: task.projectPath,
        commandPlanHash: calculateDeliveryCommandPlanHash({
          patchSetHash,
          workspaceRoot: task.projectPath,
          commands,
        }),
        commands,
        summary: "交付命令无法安全准备，必须由人工处理。",
        reason,
        preparedAt: this.clock().toISOString(),
      };
    }
  }

  /** 将运行时验收异常收敛为不会撤销已落盘文件的人工阻塞结论。 */
  private async validateDeliverySafely(
    task: D2CTask,
    reportProgress?: CodeGenerationProgressReporter,
    signal?: AbortSignal,
  ): Promise<ProjectDeliveryValidationOutcome> {
    const patchSetHash = task.codeGeneration?.status === "ready"
      ? task.codeGeneration.patchSet.patchSetHash
      : "";
    if (!task.projectInspection || task.projectInspection.kind === "unsupported"
      || !task.evolvingPlan || !patchSetHash
      || task.deliveryCommandPlan?.status !== "approval_required"
      || !task.deliveryCommandApproval) {
      throw new Error("当前任务缺少自动交付验收所需的权威上下文。");
    }
    assertDeliveryCommandPlanIntegrity(task.deliveryCommandPlan);
    try {
      const outcome = await this.projectDeliveryValidator.validate({
        taskId: task.taskId,
        workspaceRoot: task.projectPath,
        inspection: task.projectInspection,
        designPreview: task.inspectedDesign?.context.preview,
        target: task.evolvingPlan.execution.validationTarget,
        patchSetHash,
        commandPlan: task.deliveryCommandPlan,
        approvedCommandPlanHash: task.deliveryCommandApproval.commandPlanHash,
        ...(reportProgress ? { reportProgress } : {}),
        ...(signal ? { signal } : {}),
      });
      if (outcome.patchSetHash !== patchSetHash) {
        throw new Error("自动交付验收结果与当前候选 Patch 不一致。");
      }
      return outcome;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      const reason = normalizeError(error, "自动交付验收失败。").message;
      return {
        status: "blocked",
        patchSetHash,
        summary: "自动交付验收异常停止，已落盘文件保持不变。",
        reasons: [reason],
        manualActionRequired: true,
        build: {
          status: "blocked",
          command: "未完成",
          durationMs: 0,
          summary: "自动交付验收未能完成。",
          outputSummary: "",
          reason,
        },
        blockedAt: new Date().toISOString(),
      };
    }
  }

  /** 重置或删除任务时尽力删除验收图片；清理失败不覆盖权威状态结果。 */
  private async discardDeliveryEvidenceSafely(taskId: string): Promise<void> {
    try {
      await this.deliveryEvidenceStore?.discardTask(taskId);
    } catch {
      // 证据清理失败只会遗留受控文件，不回滚任务重置。
    }
  }

  /** 统一补齐持久任务元数据，并只在成功提交点更新时间。 */
  private async saveTask(task: D2CTask): Promise<D2CTask> {
    const normalized = normalizePersistedTask(task);
    return this.graph.saveTask({
      ...normalized,
      schemaVersion: currentTaskSchemaVersion,
      updatedAt: this.clock().toISOString(),
    });
  }

  /** 从 Checkpoint 读取任务，不存在时拒绝调用。 */
  private async requireTask(taskId: string): Promise<D2CTask> {
    const task = await this.graph.getTask(taskId);
    if (!task) throw new Error(`任务不存在：${taskId}`);
    return normalizePersistedTask(task);
  }

  /** 校验客户端命令基于当前权威 revision，并默认拒绝修改已归档任务。 */
  private requireCommandRevision(
    command: D2CTaskCommand,
    task: D2CTask,
    options: { allowArchived?: boolean } = {},
  ): void {
    if (task.revision !== command.expectedRevision) {
      throw new Error(`任务版本冲突：期望 ${command.expectedRevision}，实际 ${task.revision}。`);
    }
    if (task.archivedAt && options.allowArchived !== true) {
      throw new Error("任务已归档，请先恢复后再执行操作。");
    }
  }

  /** 串行化同一任务的命令提交，避免 revision 与 Graph 结果相互覆盖。 */
  private async withTaskUpdateLock<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.taskUpdateLocks.get(taskId) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.taskUpdateLocks.set(taskId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.taskUpdateLocks.get(taskId) === current) this.taskUpdateLocks.delete(taskId);
    }
  }

  /** 将旧 Artifact 标记为历史数据，延后到存储清理流程处理。 */
  private async supersedeArtifactSafely(artifactId: string): Promise<void> {
    try {
      await this.designArtifactLifecycle?.supersede(artifactId);
    } catch {
      // 标记失败只会延迟清理，不回滚已提交任务。
    }
  }

  /** 标记未能提交到任务状态的新 Artifact。 */
  private async abandonArtifactSafely(artifactId: string): Promise<void> {
    try {
      await this.designArtifactLifecycle?.abandon(artifactId);
    } catch {
      // 标记失败不得覆盖原始业务错误。
    }
  }
}

/** 返回隔离副本，避免调用方修改权威任务。 */
function copyTask(task: D2CTask): D2CTask {
  return structuredClone(task);
}

/** 将旧 Checkpoint 的任务元数据确定性迁移到当前结构，不改写业务状态。 */
function normalizePersistedTask(task: D2CTask): D2CTask {
  const legacyTimestamp = deriveLegacyTimestamp(task);
  return {
    ...copyTask(task),
    schemaVersion: currentTaskSchemaVersion,
    displayName: task.displayName?.trim() || deriveTaskDisplayName(task),
    displayNameSource: task.displayNameSource ?? "generated",
    createdAt: task.createdAt ?? legacyTimestamp,
    updatedAt: task.updatedAt ?? task.createdAt ?? legacyTimestamp,
  };
}

/** 从旧任务现有的领域时间戳选择稳定回退值。 */
function deriveLegacyTimestamp(task: D2CTask): string {
  if (task.deliveryValidation?.status === "passed") return task.deliveryValidation.validatedAt;
  if (task.deliveryValidation?.status === "blocked") return task.deliveryValidation.blockedAt;
  if (task.deliveryCommandApproval) return task.deliveryCommandApproval.approvedAt;
  if (task.deliveryCommandPlan) return task.deliveryCommandPlan.preparedAt;
  if (task.patchApplication?.status === "applied") return task.patchApplication.appliedAt;
  if (task.planApproval) return task.planApproval.approvedAt;
  return new Date(0).toISOString();
}

/** 为尚未人工命名的任务从设计信息生成稳定名称。 */
function deriveTaskDisplayName(task: D2CTask): string {
  if (task.inspectedDesign) return createTaskDisplayName(task.inspectedDesign);
  const createdAt = task.createdAt ? new Date(task.createdAt) : undefined;
  return createdAt && !Number.isNaN(createdAt.getTime())
    ? createDraftTaskDisplayName(createdAt)
    : defaultTaskDisplayName;
}

/** 按最近更新时间和 taskId 确定性排序任务。 */
function compareTasksByRecentActivity(left: D2CTask, right: D2CTask): number {
  const updatedComparison = (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
  return updatedComparison !== 0 ? updatedComparison : left.taskId.localeCompare(right.taskId);
}

/** 将未知异常转换为稳定 Error。 */
function normalizeError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

/** 在开始不可中断的原子写入前传播用户取消。 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("代码生成已由用户终止。", "AbortError");
}

/** 根据真实 MasterGo 设计名称与首个区域生成第二步用户目标。 */
function createTaskGoal(inspection: DesignInspection): string {
  const designName = inspection.context.name.trim() || "未命名设计";
  const nodeName = inspection.context.regions[0]?.name?.trim();
  const target = nodeName && nodeName !== designName
    ? `「${designName}」中的「${nodeName}」`
    : `「${designName}」`;
  return `请结合当前项目，根据 MasterGo 设计${target}生成整体修改方案。`;
}

/** 从设计名称和首个区域生成适合侧边栏的短标题。 */
function createTaskDisplayName(inspection: DesignInspection): string {
  const designName = inspection.context.name.trim();
  const regionName = inspection.context.regions.find((region) => region.name.trim())?.name.trim() ?? "";
  const generatedName = designName && regionName && designName !== regionName
    ? `${designName} · ${regionName}`
    : designName || regionName || defaultTaskDisplayName;
  return limitTaskDisplayName(generatedName);
}

/** 使用任务创建时刻生成可区分多个未配置草稿的临时名称。 */
function createDraftTaskDisplayName(createdAt: Date): string {
  const month = String(createdAt.getMonth() + 1).padStart(2, "0");
  const day = String(createdAt.getDate()).padStart(2, "0");
  const hour = String(createdAt.getHours()).padStart(2, "0");
  const minute = String(createdAt.getMinutes()).padStart(2, "0");
  return `新任务 · ${month}-${day} ${hour}:${minute}`;
}

/** 将系统生成名称限制在共享任务摘要允许的最大长度内。 */
function limitTaskDisplayName(displayName: string): string {
  return displayName.length <= maximumTaskDisplayNameLength
    ? displayName
    : `${displayName.slice(0, maximumTaskDisplayNameLength - 1)}…`;
}
