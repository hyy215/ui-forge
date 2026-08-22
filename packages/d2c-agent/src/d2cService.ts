/** 实现设计读取与第二步 DeepAgent 分析的公共 D2C Service。 */

import { randomUUID } from "node:crypto";
import type { AgentCore } from "@ui-forge/agent-core";
import type { DesignArtifactLifecycle } from "./design-context/designArtifact.js";
import type { DesignArtifactReader } from "./design-context/designArtifact.js";
import { createDesignContextResolver } from "./design-context/designContextResolver.js";
import type { DesignInspection } from "./design-context/designInspection.js";
import type { DesignSource } from "./design-context/designSource.js";
import type { DesignSourceAdapter } from "./design-context/designSourceAdapter.js";
import { createDeterministicDesignComponentRecognizer } from "./design-components/deterministicDesignComponentRecognizer.js";
import type { DesignComponentRecognizer } from "./design-components/designComponentRecognition.js";
import { parseComponentCatalog, type ComponentCatalog } from "./design-components/componentCatalog.js";
import type {
  D2CTaskCommand,
  InspectDesignCommand,
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

const defaultTaskGoal = "结合目标 React + Ant Design 项目与 MasterGo 设计稿生成整体修改方案";

/** Agent Server 可调用的当前 D2C 领域服务。 */
export interface D2CService {
  /** 创建并保存初始设计输入任务。 */
  initialize(input: {
    projectPath?: string | undefined;
    workspaceId?: string | undefined;
  }): Promise<D2CTask>;
  /** 读取指定任务的最新权威状态。 */
  getTask(taskId: string): Promise<D2CTask>;
  /** 读取并保存用户指定设计来源的标准化上下文和 SVG 预览。 */
  inspectDesign(command: InspectDesignCommand): Promise<D2CTask>;
  /** 在用户进入第二步后运行主 DeepAgent，并保存项目与组件分析结果。 */
  analyzeSecondStep(
    command: D2CTaskCommand,
    reportProgress?: SecondStepProgressReporter,
    signal?: AbortSignal,
  ): Promise<D2CTask>;
  /** 清除当前设计与预览确认结果，回到设计输入状态。 */
  reset(command: D2CTaskCommand): Promise<D2CTask>;
}

/** 创建 D2C Service 所需的设计、存储和 Graph 持久化端口。 */
export interface D2CServiceOptions {
  designSourceAdapters: readonly DesignSourceAdapter[];
  projectInspector: ProjectInspector;
  projectContextAnalyzer?: ProjectContextAnalyzer;
  planDeepAgent?: PlanDeepAgent;
  modelOptions?: PlanDeepAgentModelOptions;
  visualEvidenceProvider?: DesignVisualEvidenceProvider;
  designArtifactReader?: DesignArtifactReader;
  designComponentRecognizer?: DesignComponentRecognizer;
  componentCatalog: ComponentCatalog;
  designSystemKnowledgeProvider?: DesignSystemKnowledgeProvider;
  designArtifactLifecycle?: DesignArtifactLifecycle;
  checkpointer?: AgentCore.Checkpointer;
}

/** 创建通过单一确定性 D2C Graph 执行设计检查的公共 Service。 */
export function createD2CService(options: D2CServiceOptions): D2CService {
  return new DefaultD2CService(options);
}

/** 持有任务并发控制和 Artifact 生命周期协调的默认 Service 实现。 */
class DefaultD2CService implements D2CService {
  private readonly graph: D2CGraph;
  private readonly taskUpdateLocks = new Map<string, Promise<void>>();
  private readonly designArtifactLifecycle: DesignArtifactLifecycle | undefined;

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
      ...(options.designArtifactReader ? { artifactReader: options.designArtifactReader } : {}),
      ...(options.checkpointer ? { checkpointer: options.checkpointer } : {}),
    });
    this.designArtifactLifecycle = options.designArtifactLifecycle;
  }

  /** 创建 draft 任务并写入以 UUID 为 threadId 的首个 Checkpoint。 */
  async initialize(input: {
    projectPath?: string | undefined;
    workspaceId?: string | undefined;
  }): Promise<D2CTask> {
    return this.graph.saveTask({
      taskId: randomUUID(),
      workspaceId: input.workspaceId ?? "unknown",
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
        const updated = await this.graph.saveTask({
          ...copyTask(current),
          revision: current.revision + 1,
          designSource: structuredClone(command.source),
          inspectedDesign: { ...inspection, durationMs: Date.now() - startedAt },
          taskGoal: createTaskGoal(inspection),
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

  /** 校验设计已读取，并一次提交第二步 DeepAgent 的全部权威分析结果。 */
  async analyzeSecondStep(
    command: D2CTaskCommand,
    reportProgress?: SecondStepProgressReporter,
    signal?: AbortSignal,
  ): Promise<D2CTask> {
    return this.withTaskUpdateLock(command.taskId, async () => {
      const current = await this.requireTask(command.taskId);
      if (!current.inspectedDesign) throw new Error("请先读取并确认 MasterGo 设计。");
      if (current.projectInspection) return copyTask(current);
      this.requireCommandRevision(command, current);
      let analysis;
      try {
        analysis = await this.graph.analyzeSecondStep(command.taskId, reportProgress, signal);
      } catch (error: unknown) {
        throw normalizeError(error, "第二步 DeepAgent 分析失败。");
      }
      return this.graph.saveTask({
        ...copyTask(current),
        revision: current.revision + 1,
        projectInspection: structuredClone(analysis.projectInspection),
        ...(analysis.componentRecognition
          ? { componentRecognition: structuredClone(analysis.componentRecognition) }
          : {}),
        ...(analysis.plan ? { plan: structuredClone(analysis.plan) } : {}),
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
      const reset = await this.graph.saveTask(next);
      if (artifactId) await this.supersedeArtifactSafely(artifactId);
      return reset;
    });
  }

  /** 从 Checkpoint 读取任务，不存在时拒绝调用。 */
  private async requireTask(taskId: string): Promise<D2CTask> {
    const task = await this.graph.getTask(taskId);
    if (!task) throw new Error(`任务不存在：${taskId}`);
    return task;
  }

  /** 校验客户端命令基于当前权威 revision。 */
  private requireCommandRevision(command: D2CTaskCommand, task: D2CTask): void {
    if (task.revision !== command.expectedRevision) {
      throw new Error(`任务版本冲突：期望 ${command.expectedRevision}，实际 ${task.revision}。`);
    }
  }

  /** 串行处理同 taskId 的 Graph 执行与状态提交，防止同一线程互相覆盖。 */
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

/** 将未知异常转换为稳定 Error。 */
function normalizeError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
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
