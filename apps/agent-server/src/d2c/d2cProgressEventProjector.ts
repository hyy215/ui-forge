/** 将 D2C 领域进度确定性投影为 shared-protocol 流事件。 */

import { randomUUID } from "node:crypto";
import type { D2CAgent } from "@ui-forge/d2c-agent";
import type { ConversationStreamEvent } from "@ui-forge/shared-protocol";
import {
  toDesignComponentRecognition,
  toProjectValidation,
} from "./d2cSnapshotPresenter.js";

interface ProjectionState {
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

/** 持有单次消息的稳定工具标识和投影完成状态。 */
export class D2CProgressEventProjector {
  private readonly state: ProjectionState;

  constructor(messageId = randomUUID()) {
    this.state = {
      messageId,
      projectToolCallId: randomUUID(),
      designSystemCatalogToolCallId: randomUUID(),
      componentToolCallId: randomUUID(),
      projectContextToolCallId: randomUUID(),
      visualReviewToolCallId: randomUUID(),
      planningToolCallId: randomUUID(),
    };
  }

  get messageId(): string {
    return this.state.messageId;
  }

  get activeToolCallId(): string | undefined {
    return this.state.activeToolCallId;
  }

  get activeToolStartedAt(): number | undefined {
    return this.state.activeToolStartedAt;
  }

  get projectCompleted(): boolean {
    return this.state.projectCompleted === true;
  }

  get componentCompleted(): boolean {
    return this.state.componentCompleted === true;
  }

  get planningCompleted(): boolean {
    return this.state.planningCompleted === true;
  }

  /** 投影一个领域进度事件，并维护当前活动工具与完成标记。 */
  project(progress: D2CAgent.SecondStepProgressEvent): ConversationStreamEvent[] {
    const state = this.state;
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
    ...(durationMs !== undefined ? { metrics: { durationMs } } : {}),
  }, {
    type: "design-component-result",
    messageId,
    result: toDesignComponentRecognition(recognition),
  }];
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
