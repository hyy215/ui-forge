/** 组装设计检查与第二步 DeepAgent 的单一 D2C Graph。 */

import { AgentCore } from "@ui-forge/agent-core";
import type { DesignInspection } from "../design-context/designInspection.js";
import type { DesignSource } from "../design-context/designSource.js";
import type { DesignContextResolver } from "../design-context/designSourceAdapter.js";
import type { DesignArtifactReader } from "../design-context/designArtifact.js";
import type { DesignComponentRecognizer } from "../design-components/designComponentRecognition.js";
import type { D2CTask } from "../d2cTask.js";
import type { ProjectInspector } from "../project-context/projectInspector.js";
import type { ProjectContextAnalyzer } from "../project-context/projectContextAnalysis.js";
import type { PlanDeepAgent } from "../second-step/planDeepAgent.js";
import type { SecondStepProgressReporter } from "../second-step/secondStepProgress.js";
import type { ComponentCatalog } from "../design-components/componentCatalog.js";
import type { DesignSystemKnowledgeProvider } from "../design-system/designSystemKnowledge.js";
import type { ProjectCodeContextReader } from "../code-generation/projectCodeContext.js";
import type { CodeGenerationAgent } from "../code-generation/codeGenerationAgent.js";
import type { CodeGenerationProgressReporter } from "../code-generation/codeGenerationProgress.js";
import { createInspectDesignNode, inspectDesignNodeId } from "./nodes/inspect-design/inspectDesignNode.js";
import { createInspectProjectNode, inspectProjectNodeId } from "./nodes/inspect-project/inspectProjectNode.js";
import { createPlanDeepAgentNode, planDeepAgentNodeId } from "./nodes/plan/planDeepAgentNode.js";
import {
  createRecognizeDesignComponentsNode,
  recognizeDesignComponentsNodeId,
} from "./nodes/recognize-design-components/recognizeDesignComponentsNode.js";
import {
  createPersistedD2CGraphState,
  type D2CGraphState,
} from "./d2cGraphState.js";
import {
  createResolveDesignSystemCatalogNode,
  resolveDesignSystemCatalogNodeId,
} from "./nodes/resolve-design-system-catalog/resolveDesignSystemCatalogNode.js";
import {
  analyzeProjectContextNodeId,
  createAnalyzeProjectContextNode,
} from "./nodes/analyze-project-context/analyzeProjectContextNode.js";
import {
  CodeGenerationBlockedError,
  createGenerateCodeNode,
  generateCodeNodeId,
} from "./nodes/generate-code/generateCodeNode.js";

/** 创建 D2C Graph 所需的节点能力与状态持久化依赖。 */
export interface D2CGraphDependencies {
  designContextResolver: DesignContextResolver;
  projectInspector: ProjectInspector;
  projectContextAnalyzer: ProjectContextAnalyzer;
  artifactReader?: DesignArtifactReader;
  componentRecognizer: DesignComponentRecognizer;
  baseComponentCatalog: ComponentCatalog;
  designSystemKnowledgeProvider?: DesignSystemKnowledgeProvider;
  planDeepAgent: PlanDeepAgent;
  codeGenerationAgent?: CodeGenerationAgent;
  projectCodeContextReader?: ProjectCodeContextReader;
  checkpointer?: AgentCore.Checkpointer;
}

/** Service 用于执行 D2C 节点和读写任务的内部 Graph 端口。 */
export interface D2CGraph {
  /** 读取任务线程中的最新权威任务。 */
  getTask(taskId: string): Promise<D2CTask | undefined>;
  /** 保存完整权威任务并丢弃节点临时输出。 */
  saveTask(task: D2CTask): Promise<D2CTask>;
  /** 从固定路径起点执行设计检查。 */
  inspectDesign(taskId: string, source: DesignSource): Promise<DesignInspection>;
  /** 从设计确认暂停点恢复并执行唯一的第二步 DeepAgent 节点。 */
  analyzeSecondStep(
    taskId: string,
    reportProgress?: SecondStepProgressReporter,
    signal?: AbortSignal,
  ): Promise<{
    projectInspection: import("../project-context/projectInspection.js").ProjectInspection;
    componentRecognition?: import("../design-components/designComponentRecognition.js").DesignComponentRecognition;
    plan?: import("../planning/planningResult.js").PlanningResult;
  }>;
  /** 从已审阅 Plan 暂停点恢复并生成不写入仓库的候选 Patch。 */
  generateCode(
    taskId: string,
    reportProgress?: CodeGenerationProgressReporter,
    signal?: AbortSignal,
  ): Promise<{
    outcome: import("../code-generation/codePatch.js").CodeGenerationOutcome;
    evolvingPlan?: import("../planning/evolvingPlan.js").EvolvingPlanningResult;
  }>;
}

/** 创建一个由所有当前 D2C 节点共享的编译 Graph。 */
export function createD2CGraph(dependencies: D2CGraphDependencies): D2CGraph {
  const progressReporters = new Map<string, SecondStepProgressReporter>();
  const abortSignals = new Map<string, AbortSignal>();
  const codeProgressReporters = new Map<string, CodeGenerationProgressReporter>();
  const codeAbortSignals = new Map<string, AbortSignal>();
  const graph = AgentCore.createGraph<D2CGraphState>({
    nodes: [
      createInspectDesignNode(dependencies.designContextResolver),
      createInspectProjectNode(
        dependencies.projectInspector,
        (taskId) => progressReporters.get(taskId),
      ),
      createResolveDesignSystemCatalogNode(
        dependencies.designSystemKnowledgeProvider,
        dependencies.baseComponentCatalog,
        (taskId) => progressReporters.get(taskId),
        (taskId) => abortSignals.get(taskId),
      ),
      createRecognizeDesignComponentsNode(
        dependencies.artifactReader,
        dependencies.componentRecognizer,
        (taskId) => progressReporters.get(taskId),
      ),
      createAnalyzeProjectContextNode(
        dependencies.projectContextAnalyzer,
        (taskId) => progressReporters.get(taskId),
        (taskId) => abortSignals.get(taskId),
      ),
      createPlanDeepAgentNode(
        dependencies.planDeepAgent,
        (taskId) => progressReporters.get(taskId),
        (taskId) => abortSignals.get(taskId),
      ),
      createGenerateCodeNode(
        dependencies.codeGenerationAgent ?? {
          generate: async () => { throw new Error("当前未配置 Code Agent。"); },
        },
        dependencies.projectCodeContextReader ?? {
          read: async () => { throw new Error("当前未配置目标仓库代码上下文读取器。"); },
        },
        dependencies.projectContextAnalyzer,
        (taskId) => codeProgressReporters.get(taskId),
        (taskId) => codeAbortSignals.get(taskId),
      ),
    ],
    edges: [
      { from: AgentCore.graphStart, to: inspectDesignNodeId },
      { from: inspectDesignNodeId, to: inspectProjectNodeId },
      { from: resolveDesignSystemCatalogNodeId, to: recognizeDesignComponentsNodeId },
      { from: recognizeDesignComponentsNodeId, to: analyzeProjectContextNodeId },
      { from: analyzeProjectContextNodeId, to: planDeepAgentNodeId },
      { from: planDeepAgentNodeId, to: generateCodeNodeId },
      { from: generateCodeNodeId, to: AgentCore.graphEnd },
    ],
    routes: [{
      from: inspectProjectNodeId,
      targets: [resolveDesignSystemCatalogNodeId, AgentCore.graphEnd],
      decide: (state) => state.execution?.projectInspection?.kind === "unsupported"
        ? AgentCore.graphEnd
        : resolveDesignSystemCatalogNodeId,
    }],
    pauseAfter: [inspectDesignNodeId, planDeepAgentNodeId],
    checkpointer: dependencies.checkpointer ?? AgentCore.createMemoryCheckpointer(),
  });

  return {
    /** 从 Graph Checkpoint 读取唯一持久业务状态。 */
    async getTask(taskId) {
      return (await graph.getState(taskId))?.task;
    },
    /** 替换权威任务，并在每个命令提交点清空全部临时执行上下文。 */
    async saveTask(task) {
      await graph.setState(task.taskId, createPersistedD2CGraphState(task));
      return structuredClone(task);
    },
    /** 从 START 执行唯一的设计检查节点。 */
    async inspectDesign(taskId, source) {
      const current = await graph.getState(taskId) ?? {};
      const input: D2CGraphState = {
        ...(current.task ? { task: structuredClone(current.task) } : {}),
        execution: { designSource: structuredClone(source) },
      };
      const result = await graph.invoke(input, { threadId: taskId });
      const inspection = result.execution?.inspection;
      if (!inspection) throw new Error("D2C Graph 设计检查节点未返回结果。");
      return inspection;
    },
    /** 从设计确认暂停点继续执行第二步，节点结果只在本次恢复期间流转。 */
    async analyzeSecondStep(taskId, reportProgress, signal) {
      if (reportProgress) progressReporters.set(taskId, reportProgress);
      if (signal) abortSignals.set(taskId, signal);
      try {
        const result = await graph.resume(taskId);
        const execution = result.execution;
        if (!execution?.projectInspection) {
          throw new Error("D2C Graph 第二步节点未返回项目检查结果。");
        }
        return {
          projectInspection: execution.projectInspection,
          ...(execution.componentRecognition
            ? { componentRecognition: execution.componentRecognition }
            : {}),
          ...(execution.plan ? { plan: execution.plan } : {}),
        };
      } finally {
        progressReporters.delete(taskId);
        abortSignals.delete(taskId);
      }
    },
    /** 从方案暂停点恢复代码节点；阻塞异常保留暂停位置供后续重试。 */
    async generateCode(taskId, reportProgress, signal) {
      if (reportProgress) codeProgressReporters.set(taskId, reportProgress);
      if (signal) codeAbortSignals.set(taskId, signal);
      try {
        const result = await graph.resume(taskId);
        const outcome = result.execution?.codeGeneration;
        if (!outcome) throw new Error("D2C Graph 代码生成节点未返回结果。");
        return {
          outcome,
          ...(result.execution?.evolvingPlan
            ? { evolvingPlan: result.execution.evolvingPlan }
            : {}),
        };
      } catch (error: unknown) {
        if (error instanceof CodeGenerationBlockedError) {
          return { outcome: structuredClone(error.outcome) };
        }
        throw error;
      } finally {
        codeProgressReporters.delete(taskId);
        codeAbortSignals.delete(taskId);
      }
    },
  };
}
