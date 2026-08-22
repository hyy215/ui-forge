/** 将共享通信协议命令分发到 D2C Agent，并返回面向客户端的快照投影。 */

import { randomUUID } from "node:crypto";
import type { D2CAgent } from "@ui-forge/d2c-agent";
import {
  d2cTaskCommandInputSchema,
  d2cWorkflowMethods,
  cancelD2CConversationInputSchema,
  getDesignDataIndexInputSchema,
  getDesignDataSectionInputSchema,
  getD2CWorkflowSnapshotInputSchema,
  initializeD2CWorkflowInputSchema,
  inspectD2CDesignInputSchema,
  streamD2CConversationInputSchema,
  type ConversationStreamEvent,
  type CancelD2CConversationResult,
  type D2CWorkflowSnapshot,
  type DesignDataIndex,
  type DesignDataSection,
} from "@ui-forge/shared-protocol";
import {
  toD2CWorkflowSnapshot,
  toDesignComponentRecognition,
  toProjectValidation,
} from "./d2cSnapshotPresenter.js";

/** 配置 D2C 通信服务唯一依赖的领域 Service 与宿主资源生命周期。 */
export interface D2CWorkflowServiceOptions {
  service: D2CAgent.Service;
  designProvider: string;
  designArtifactReader?: D2CAgent.DesignArtifactReader;
  resolveWorkspaceId?: (projectPath: string) => Promise<string>;
  initialize?: () => Promise<void>;
  dispose?: () => Promise<void>;
}

/** D2C 通信服务能够返回的快照或按需设计数据。 */
export type D2CWorkflowResult = D2CWorkflowSnapshot | DesignDataIndex | DesignDataSection
  | CancelD2CConversationResult;

/** 校验客户端命令、调用领域运行时并投影权威快照。 */
export class D2CWorkflowService {
  private readonly service: D2CAgent.Service;
  private readonly designProvider: string;
  private readonly designArtifactReader: D2CAgent.DesignArtifactReader | undefined;
  private readonly resolveWorkspaceId: ((projectPath: string) => Promise<string>) | undefined;
  private readonly initializeResources: (() => Promise<void>) | undefined;
  private readonly disposeResources: (() => Promise<void>) | undefined;
  private initialization: Promise<void> | undefined;
  private readonly activeConversationRuns = new Map<string, AbortController>();

  /** 创建不持有任务状态或外部 Adapter 细节的通信门面。 */
  constructor(options: D2CWorkflowServiceOptions) {
    this.service = options.service;
    this.designProvider = options.designProvider;
    this.designArtifactReader = options.designArtifactReader;
    this.resolveWorkspaceId = options.resolveWorkspaceId;
    this.initializeResources = options.initialize;
    this.disposeResources = options.dispose;
  }

  /** 幂等初始化 Checkpointer 等异步运行时资源。 */
  initialize(): Promise<void> {
    this.initialization ??= this.initializeResources?.() ?? Promise.resolve();
    return this.initialization;
  }

  /** 关闭由组合入口创建的运行时资源。 */
  async dispose(): Promise<void> {
    await this.disposeResources?.();
  }

  /** 根据公共方法名校验请求参数并执行对应领域命令。 */
  async handle(method: string, params: unknown): Promise<D2CWorkflowResult> {
    await this.initialize();
    let task: D2CAgent.Task;
    switch (method) {
      case d2cWorkflowMethods.initialize: {
        const input = initializeD2CWorkflowInputSchema.parse(params ?? {});
        const projectPath = input.projectPath ?? "";
        const workspaceId = await this.resolveWorkspaceId?.(projectPath) ?? "unknown";
        task = await this.service.initialize({
          ...input,
          workspaceId,
        });
        break;
      }
      case d2cWorkflowMethods.getSnapshot: {
        const input = getD2CWorkflowSnapshotInputSchema.parse(params);
        task = await this.service.getTask(input.taskId);
        break;
      }
      case d2cWorkflowMethods.getDesignDataIndex: {
        const input = getDesignDataIndexInputSchema.parse(params);
        await this.requireTaskArtifact(input.taskId, input.artifactId);
        return this.createDesignDataIndex(input.artifactId);
      }
      case d2cWorkflowMethods.getDesignDataSection: {
        const input = getDesignDataSectionInputSchema.parse(params);
        await this.requireTaskArtifact(input.taskId, input.artifactId);
        return this.createDesignDataSection(input.artifactId, input.sectionIndex);
      }
      case d2cWorkflowMethods.cancelConversation: {
        const input = cancelD2CConversationInputSchema.parse(params);
        const controller = this.activeConversationRuns.get(input.taskId);
        controller?.abort();
        return { cancelled: controller !== undefined };
      }
      case d2cWorkflowMethods.inspectDesign: {
        const input = inspectD2CDesignInputSchema.parse(params);
        task = await this.service.inspectDesign({
          taskId: input.taskId,
          expectedRevision: input.expectedRevision,
          source: { provider: this.designProvider, reference: input.designUrl },
        });
        break;
      }
      case d2cWorkflowMethods.reset:
        task = await this.service.reset(d2cTaskCommandInputSchema.parse(params));
        break;
      default:
        throw new Error(`不支持的 D2C 通信方法：${method}`);
    }
    return toD2CWorkflowSnapshot(task);
  }

  /** 执行单个第二步 DeepAgent 节点，并投影项目检查和组件 subagent 结果。 */
  async *stream(
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): AsyncIterable<ConversationStreamEvent> {
    await this.initialize();
    if (method !== d2cWorkflowMethods.streamConversation) {
      throw new Error(`不支持的 D2C 流式通信方法：${method}`);
    }
    const input = streamD2CConversationInputSchema.parse(params);
    const messageId = randomUUID();
    const projection: SecondStepProjectionState = {
      messageId,
      projectToolCallId: randomUUID(),
      designSystemCatalogToolCallId: randomUUID(),
      componentToolCallId: randomUUID(),
      projectContextToolCallId: randomUUID(),
      visualReviewToolCallId: randomUUID(),
      planningToolCallId: randomUUID(),
    };
    const controller = new AbortController();
    this.activeConversationRuns.get(input.taskId)?.abort();
    this.activeConversationRuns.set(input.taskId, controller);
    const progressQueue = new AsyncEventQueue<D2CAgent.SecondStepProgressEvent>();
    const handleExternalAbort = () => controller.abort();
    if (signal?.aborted) handleExternalAbort();
    else signal?.addEventListener("abort", handleExternalAbort, { once: true });
    try {
      yield { type: "message-start", messageId };
      const analysis = this.service.analyzeSecondStep(
        input,
        (event) => progressQueue.push(structuredClone(event)),
        controller.signal,
      ).then(
        (task) => ({ succeeded: true as const, task }),
        (error: unknown) => ({ succeeded: false as const, error }),
      ).finally(() => {
        progressQueue.close();
        if (this.activeConversationRuns.get(input.taskId) === controller) {
          this.activeConversationRuns.delete(input.taskId);
        }
      });
      let task: D2CAgent.Task;
      try {
        for await (const progress of progressQueue) {
          for (const event of projectSecondStepProgress(progress, projection)) yield event;
        }
        const outcome = await analysis;
        if (!outcome.succeeded) throw outcome.error;
        task = outcome.task;
      } catch (error: unknown) {
        if (isAbortError(error)) {
          if (projection.activeToolCallId) {
            yield {
              type: "tool-complete",
              messageId,
              toolCallId: projection.activeToolCallId,
              summary: "已由用户终止。",
              outcome: "warning",
              ...(projection.activeToolStartedAt !== undefined
                ? { metrics: { durationMs: elapsedMilliseconds(projection.activeToolStartedAt) } }
                : {}),
            };
          }
          yield { type: "message-stopped", messageId };
          return;
        }
        if (projection.activeToolCallId) {
          yield {
            type: "tool-complete",
            messageId,
            toolCallId: projection.activeToolCallId,
            summary: "当前识别步骤未能完成。",
            outcome: "error",
            ...(projection.activeToolStartedAt !== undefined
              ? { metrics: { durationMs: elapsedMilliseconds(projection.activeToolStartedAt) } }
              : {}),
          };
        }
        throw error;
      }
      const inspection = task.projectInspection;
      if (!inspection) throw new Error("项目检查完成后没有返回权威结果。");
      const componentRecognition = task.componentRecognition;
      if (inspection.kind !== "unsupported" && !componentRecognition) {
        throw new Error("组件识别完成后没有返回权威结果。");
      }
      if (!projection.projectCompleted) {
        for (const event of projectSecondStepProgress(
          { type: "project-inspection-start" },
          projection,
        )) yield event;
        for (const event of projectSecondStepProgress(
          { type: "project-inspection-complete", inspection },
          projection,
        )) yield event;
      }
      if (inspection.kind !== "unsupported" && componentRecognition && !projection.componentCompleted) {
        for (const event of projectSecondStepProgress(
          { type: "component-recognition-start" },
          projection,
        )) yield event;
        for (const event of projectSecondStepProgress({
          type: "component-recognition-complete",
          recognition: componentRecognition,
          unknownCount: componentRecognition.components.filter(
            (component) => !component.typeHint,
          ).length,
        }, projection)) yield event;
      }
      if (inspection.kind !== "unsupported" && componentRecognition && task.plan && !projection.planningCompleted) {
        for (const event of projectSecondStepProgress({ type: "planning-start" }, projection)) yield event;
        for (const event of projectSecondStepProgress({
          type: "planning-complete",
          recognition: componentRecognition,
          plan: task.plan,
          durationMs: 0,
        }, projection)) yield event;
      }
      yield { type: "message-complete", messageId };
    } finally {
      signal?.removeEventListener("abort", handleExternalAbort);
      controller.abort();
      progressQueue.close();
      if (this.activeConversationRuns.get(input.taskId) === controller) {
        this.activeConversationRuns.delete(input.taskId);
      }
    }
  }

  /** 确认请求任务实际拥有指定 Artifact，防止跨任务枚举设计数据。 */
  private async requireTaskArtifact(taskId: string, artifactId: string): Promise<void> {
    const task = await this.service.getTask(taskId);
    if (task.inspectedDesign?.artifact?.artifactId !== artifactId) {
      throw new Error("设计数据 Artifact 不属于当前任务或已失效。");
    }
  }

  /** 返回已配置的 Artifact Reader；未启用存储时拒绝数据读取。 */
  private requireArtifactReader(): D2CAgent.DesignArtifactReader {
    if (!this.designArtifactReader) throw new Error("设计数据 Artifact Store 未启用。");
    return this.designArtifactReader;
  }

  /** 将通用 Artifact 内容投影为不包含原始 Section 数据的通信索引。 */
  private async createDesignDataIndex(artifactId: string): Promise<DesignDataIndex> {
    const artifact = await this.requireArtifactReader().read(artifactId);
    return {
      artifactId,
      provider: artifact.content.source.provider,
      reference: artifact.content.source.reference,
      name: artifact.content.name,
      nodeCount: artifact.content.nodeCount,
      byteSize: artifact.reference.byteSize,
      regions: structuredClone(artifact.content.regions),
      tokens: structuredClone(artifact.content.tokens),
      sections: artifact.content.sections.map((section, index) => ({
        index,
        id: section.id,
        label: section.label,
        byteSize: jsonByteSize(section.data),
      })),
    };
  }

  /** 将 Core 原始分段投影为客户端按需读取的通信结构。 */
  private async createDesignDataSection(
    artifactId: string,
    sectionIndex: number,
  ): Promise<DesignDataSection> {
    const section = await this.requireArtifactReader().readSection(artifactId, sectionIndex);
    return {
      artifactId,
      index: sectionIndex,
      id: section.id,
      label: section.label,
      byteSize: jsonByteSize(section.data),
      data: structuredClone(section.data),
    };
  }
}

interface SecondStepProjectionState {
  messageId: string;
  projectToolCallId: string;
  designSystemCatalogToolCallId: string;
  componentToolCallId: string;
  projectContextToolCallId: string;
  visualReviewToolCallId: string;
  planningToolCallId: string;
  activeToolCallId?: string;
  activeToolStartedAt?: number;
  planningStartedAt?: number;
  projectCompleted?: true;
  componentCompleted?: true;
  planningCompleted?: true;
}

/** 将第二步内部进度即时投影为现有公开流事件，并维护当前活动工具。 */
function projectSecondStepProgress(
  progress: D2CAgent.SecondStepProgressEvent,
  state: SecondStepProjectionState,
): ConversationStreamEvent[] {
  const messageId = state.messageId;
  switch (progress.type) {
    case "project-inspection-start":
      state.activeToolCallId = state.projectToolCallId;
      state.activeToolStartedAt = performance.now();
      return [{
        type: "agent-progress",
        messageId,
        phase: "project-validation",
        title: "识别目标项目",
        summary: "正在读取最小工程证据并判断项目支持情况。",
      }, {
        type: "tool-start",
        messageId,
        toolCallId: state.projectToolCallId,
        toolName: "inspect_project",
        summary: "受控检查目标目录和 package.json。",
      }];
    case "project-inspection-complete": {
      delete state.activeToolCallId;
      delete state.activeToolStartedAt;
      state.projectCompleted = true;
      const validation = toProjectValidation(progress.inspection);
      return [{
        type: "tool-complete",
        messageId,
        toolCallId: state.projectToolCallId,
        summary: validation.message,
        outcome: progress.inspection.kind === "react_antd" ? "success" : "warning",
        ...(progress.durationMs !== undefined
          ? { metrics: { durationMs: progress.durationMs } }
          : {}),
      }, {
        type: "project-validation",
        messageId,
        result: validation,
      }];
    }
    case "design-system-catalog-start":
      state.activeToolCallId = state.designSystemCatalogToolCallId;
      state.activeToolStartedAt = performance.now();
      return [{
        type: "agent-progress",
        messageId,
        phase: "design-analysis",
        title: "读取 Ant Design 组件知识",
        summary: "正在通过官方 MCP 解析目标项目版本对应的组件目录。",
      }, {
        type: "tool-start",
        messageId,
        toolCallId: state.designSystemCatalogToolCallId,
        toolName: "antd_list",
        summary: "查询本地官方 Ant Design MCP 组件清单。",
      }];
    case "design-system-catalog-complete":
      delete state.activeToolCallId;
      delete state.activeToolStartedAt;
      return [{
        type: "tool-complete",
        messageId,
        toolCallId: state.designSystemCatalogToolCallId,
        summary: progress.warnings.length > 0
          ? progress.warnings.join("；")
          : `已载入 ${progress.componentCount} 个目标版本组件定义。`,
        outcome: progress.warnings.length > 0 ? "warning" : "success",
        metrics: { durationMs: progress.durationMs },
      }];
    case "component-recognition-start":
      state.activeToolCallId = state.componentToolCallId;
      state.activeToolStartedAt = performance.now();
      return [{
        type: "agent-progress",
        messageId,
        phase: "design-analysis",
        title: "识别设计组件",
        summary: "正在从平台无关结构中生成确定性组件候选。",
      }, {
        type: "tool-start",
        messageId,
        toolCallId: state.componentToolCallId,
        toolName: "recognize_design_components",
        summary: "只读取任务绑定的设计结构，不调用模型。",
      }];
    case "component-recognition-complete":
      delete state.activeToolCallId;
      delete state.activeToolStartedAt;
      state.componentCompleted = true;
      return createComponentResultEvents(
        messageId,
        state.componentToolCallId,
        progress.recognition,
        progress.recognition.status === "unavailable" || progress.unknownCount > 0
          ? "warning"
          : "success",
        progress.durationMs,
      );
    case "project-context-analysis-start":
      state.activeToolCallId = state.projectContextToolCallId;
      state.activeToolStartedAt = performance.now();
      return [{
        type: "agent-progress",
        messageId,
        phase: "project-analysis",
        title: "分析目标仓库",
        summary: "正在受控提取组件实现、样式引用和反向依赖证据。",
      }, {
        type: "tool-start",
        messageId,
        toolCallId: state.projectContextToolCallId,
        toolName: "analyze_project_context",
        summary: "只读取任务绑定项目中的有限源码和样式清单。",
      }];
    case "project-context-analysis-complete":
      delete state.activeToolCallId;
      delete state.activeToolStartedAt;
      return [{
        type: "tool-complete",
        messageId,
        toolCallId: state.projectContextToolCallId,
        summary: progress.analysis.kind === "empty"
          ? "目标目录为空，方案将从受控项目初始化开始。"
          : `已生成 ${progress.analysis.matches.length} 条仓库组件匹配证据。`,
        outcome: progress.analysis.warnings.length > 0 ? "warning" : "success",
        ...(progress.durationMs !== undefined ? { metrics: { durationMs: progress.durationMs } } : {}),
      }];
    case "visual-review-start":
      state.activeToolCallId = state.visualReviewToolCallId;
      state.activeToolStartedAt = performance.now();
      return [{
        type: "agent-progress",
        messageId,
        phase: "planning",
        title: "视觉复核设计组件",
        summary: `主 Plan Agent 正在委派视觉 Subagent 复核 ${progress.candidateCount} 个组件候选。`,
      }, {
        type: "tool-start",
        messageId,
        toolCallId: state.visualReviewToolCallId,
        parentToolCallId: state.planningToolCallId,
        toolName: "visual_component_subagent",
        summary: "独立视觉 Subagent 正在读取受控整体预览与候选局部图。",
      }];
    case "visual-review-complete":
      state.activeToolCallId = state.planningToolCallId;
      if (state.planningStartedAt === undefined) delete state.activeToolStartedAt;
      else state.activeToolStartedAt = state.planningStartedAt;
      return [{
        type: "tool-complete",
        messageId,
        toolCallId: state.visualReviewToolCallId,
        summary: progress.outcome === "completed"
          ? "视觉 Subagent 已返回组件建议，等待主 Plan Agent 最终确认。"
          : progress.outcome === "unavailable"
            ? "缺少可用图片，视觉 Subagent 已明确降级。"
            : "视觉 Subagent 未提交完整结果。",
        outcome: progress.outcome === "completed" ? "success" : "warning",
        metrics: {
          durationMs: progress.durationMs,
          ...(progress.tokenUsage ? { tokenUsage: progress.tokenUsage } : {}),
        },
      }];
    case "design-system-query-start":
      state.activeToolCallId = progress.queryId;
      state.activeToolStartedAt = performance.now();
      return [{
        type: "tool-start",
        messageId,
        toolCallId: progress.queryId,
        parentToolCallId: state.planningToolCallId,
        toolName: "inspect_antd_component",
        summary: `查询 ${progress.componentId} 的官方 ${progress.sections.join("、")} 证据。`,
      }];
    case "design-system-query-complete":
      state.activeToolCallId = state.planningToolCallId;
      state.activeToolStartedAt = state.planningStartedAt ?? performance.now();
      return [{
        type: "tool-complete",
        messageId,
        toolCallId: progress.queryId,
        summary: progress.outcome === "completed"
          ? `${progress.componentId} 的官方组件证据已返回。`
          : `${progress.componentId} 查询失败：${progress.message ?? "未知错误"}`,
        outcome: progress.outcome === "completed" ? "success" : "warning",
        metrics: { durationMs: progress.durationMs },
      }];
    case "planning-start":
      state.activeToolCallId = state.planningToolCallId;
      state.activeToolStartedAt = performance.now();
      state.planningStartedAt = state.activeToolStartedAt;
      return [{
        type: "agent-progress",
        messageId,
        phase: "planning",
        title: "生成审阅型方案",
        summary: "主 Plan Agent 正在形成最终组件判断与整体修改方案。",
      }, {
        type: "tool-start",
        messageId,
        toolCallId: state.planningToolCallId,
        toolName: "plan_design_changes",
        summary: "只基于项目分类、组件目录和设计证据生成方案。",
      }, { type: "plan-start", messageId }];
    case "planning-complete":
      delete state.activeToolCallId;
      delete state.activeToolStartedAt;
      delete state.planningStartedAt;
      state.planningCompleted = true;
      return [{
        type: "tool-complete",
        messageId,
        toolCallId: state.planningToolCallId,
        summary: progress.plan.status === "reviewable" ? "审阅型方案已生成。" : "方案因上下文不足而阻塞。",
        outcome: progress.plan.status === "reviewable" ? "success" : "warning",
        metrics: {
          durationMs: progress.durationMs,
          ...(progress.tokenUsage ? { tokenUsage: progress.tokenUsage } : {}),
        },
      }, {
        type: "design-component-result",
        messageId,
        result: toDesignComponentRecognition(progress.recognition),
      }, { type: "plan-result", messageId, plan: structuredClone(progress.plan) }];
  }
}

/** 计算服务端工具运行的非负整数毫秒数。 */
function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

/** 创建一个组件工具完成事件及其可立即展示的权威结果和证据。 */
function createComponentResultEvents(
  messageId: string,
  toolCallId: string,
  recognition: D2CAgent.DesignComponentRecognition,
  outcome: "success" | "warning",
  durationMs?: number,
): ConversationStreamEvent[] {
  const summary = createComponentRecognitionSummary(recognition);
  return [{
    type: "tool-complete",
    messageId,
    toolCallId,
    summary,
    outcome,
    ...(durationMs !== undefined
      ? { metrics: { durationMs } }
      : {}),
  }, {
    type: "design-component-result",
    messageId,
    result: toDesignComponentRecognition(recognition),
  }];
}

/** 判断错误是否来自用户主动取消或 AbortSignal。 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** 在 Promise 运行期间把回调式进度转换为可由异步生成器消费的有序队列。 */
class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  /** 追加一个事件；关闭后的迟到事件会被忽略。 */
  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  /** 关闭队列并唤醒全部等待者，已缓存事件仍会按顺序消费。 */
  close(): void {
    this.closed = true;
    if (this.values.length > 0) return;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  /** 返回只支持顺序读取的异步迭代器。 */
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

/** 创建不会夸大识别覆盖率的组件识别摘要。 */
function createComponentRecognitionSummary(
  recognition: D2CAgent.DesignComponentRecognition,
): string {
  if (recognition.status === "unavailable") return "当前设计缺少可识别的结构证据。";
  const knownCount = recognition.components.filter((component) => component.effectiveTypeId).length;
  const unknownCount = recognition.components.length - knownCount;
  return `组件分析完成：识别 ${knownCount} 个语义组件${unknownCount > 0 ? `，另有 ${unknownCount} 个未知组件` : ""}。`;
}

/** 计算单个通信分段的 JSON UTF-8 字节数。 */
function jsonByteSize(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("设计 Artifact 包含不可序列化数据。");
  return Buffer.byteLength(serialized, "utf8");
}
