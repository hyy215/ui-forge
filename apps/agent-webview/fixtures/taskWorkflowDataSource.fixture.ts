/** 为本地开发模拟设计读取、项目校验和逐项方案流，不进入生产构建。 */

import type { D2CWorkflowSnapshot } from "@ui-forge/shared-protocol";
import type { TaskWorkflowDataSource } from "../src/data-sources/task-workflow";
import { createTaskWorkflowFixture, createTaskWorkflowSnapshot } from "./taskWorkflow.fixture";

/** 创建本地开发单视图数据源。 */
export function createFixtureTaskWorkflowDataSource(): TaskWorkflowDataSource {
  let snapshot = createTaskWorkflowSnapshot();
  const replace = (next: D2CWorkflowSnapshot) => {
    snapshot = next;
    return structuredClone(snapshot);
  };
  return {
    initialize: async () => structuredClone(snapshot),
    getSnapshot: async () => structuredClone(snapshot),
    inspectDesign: async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      const inspectedFixture = createTaskWorkflowFixture();
      return replace({
        ...snapshot,
        revision: snapshot.revision + 1,
        workflowPhase: "svg_ready",
        state: { phase: "svg", status: "ready" },
        viewModel: {
          ...snapshot.viewModel,
          setup: {
            ...snapshot.viewModel.setup,
            designUrl: input.designUrl,
            designSummary: inspectedFixture.setup.designSummary,
          },
          svg: inspectedFixture.svg,
        },
      });
    },
    getDesignDataIndex: async (input) => ({
      artifactId: input.artifactId,
      provider: "mastergo-fixture",
      reference: snapshot.viewModel.setup.designUrl,
      name: "客户列表",
      nodeCount: 10,
      byteSize: 100,
      regions: [],
      tokens: {},
      sections: [],
    }),
    getDesignDataSection: async (input) => ({
      artifactId: input.artifactId,
      index: input.sectionIndex,
      id: `section-${input.sectionIndex}`,
      label: "Fixture Section",
      byteSize: 2,
      data: {},
    }),
    streamConversation: async (_input, onEvent, signal) => {
      const messageId = "fixture-project-validation";
      const toolCallId = "fixture-inspect-project";
      const plan = {
        status: "reviewable" as const,
        summary: "根据当前设计证据生成客户列表审阅方案。",
        designUnderstanding: {
          layout: { summary: "筛选区位于表格上方。", regions: [], evidence: ["Fixture 设计结构"], warnings: [] },
          interactions: [],
        },
        reusableComponents: [{
          typeId: "page-container",
          name: "PageContainer",
          description: "复用项目现有页面容器承载标题和主体内容。",
        }],
        newComponents: [{
          typeId: "customer-table",
          name: "CustomerTable",
          description: "根据设计稿新增客户列表表格区域。",
        }],
        componentDecisions: [{
          candidateId: "customer-table", action: "create-new" as const, source: "new" as const,
          reason: "Fixture 未提供仓库匹配证据。", evidence: ["仓库候选为空"],
        }],
        fileImpacts: [],
        steps: [{
          id: "step-1",
          kind: "layout" as const,
          targetId: "customer-list-layout",
          title: "搭建客户列表页面结构",
          description: "组合页面容器、筛选区和客户表格。",
          decision: "create" as const,
          dependsOn: [],
          files: [],
          evidence: ["Fixture 设计结构"],
          acceptanceCriteria: ["页面结构与设计区域一致"],
          risks: [],
        }],
        files: [],
        contextGaps: ["Fixture 未提供仓库文件清单"],
        stopConditions: ["项目构建失败或设计上下文不完整时停止"],
      };
      const events = [
        { type: "message-start" as const, messageId },
        {
          type: "agent-progress" as const,
          messageId,
          phase: "project-validation" as const,
          title: "检查目标项目",
          summary: "正在读取项目根目录并校验 React 与 Ant Design 依赖。",
        },
        {
          type: "tool-start" as const,
          messageId,
          toolCallId,
          toolName: "inspect_project",
          summary: "受控读取项目根目录和 package.json。",
        },
        {
          type: "tool-complete" as const,
          messageId,
          toolCallId,
          summary: "项目校验通过。",
          outcome: "success" as const,
        },
        {
          type: "project-validation" as const,
          messageId,
          result: {
            kind: "react_antd" as const,
            message: "项目校验通过，当前项目支持 React + Ant Design D2C 工作流。",
            reactVersion: "^19.0.0",
            antdVersion: "^6.0.0",
          },
        },
        { type: "plan-start" as const, messageId },
        { type: "plan-result" as const, messageId, plan },
        { type: "message-complete" as const, messageId },
      ];
      for (const event of events) {
        if (signal?.aborted) throw new DOMException("Fixture 流已取消。", "AbortError");
        await onEvent(event);
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
      replace({
        ...snapshot,
        revision: snapshot.revision + 1,
        viewModel: {
          ...snapshot.viewModel,
          conversation: {
            ...snapshot.viewModel.conversation,
            planStatus: "ready",
            projectValidation: {
              kind: "react_antd",
              message: "项目校验通过，当前项目支持 React + Ant Design D2C 工作流。",
              reactVersion: "^19.0.0",
              antdVersion: "^6.0.0",
            },
            designComponentRecognition: null,
            plan,
          },
        },
      });
    },
    cancelConversation: async () => ({ cancelled: true }),
    reset: async () => replace({
      ...snapshot,
      revision: snapshot.revision + 1,
      workflowPhase: "created",
      state: { phase: "setup", status: "draft" },
      viewModel: {
        setup: { ...snapshot.viewModel.setup, designUrl: "", designSummary: null },
        svg: { ...snapshot.viewModel.svg, statusMessage: "", tools: [] },
        conversation: {
          ...snapshot.viewModel.conversation,
          planStatus: "idle",
          projectValidation: null,
          designComponentRecognition: null,
          plan: null,
        },
      },
    }),
  };
}

/** 本地开发复用的 Fixture 数据源。 */
export const fixtureTaskWorkflowDataSource = createFixtureTaskWorkflowDataSource();
