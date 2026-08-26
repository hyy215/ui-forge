/** 为本地开发模拟设计读取、持久确认和逐项方案流，不进入生产构建。 */

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
        status: "svg_ready",
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
    confirmDesign: async () => replace({
      ...snapshot,
      revision: snapshot.revision + 1,
      status: "design_confirmed",
    }),
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
        reusableComponents: [],
        newComponents: [],
        componentDecisions: [],
        fileImpacts: [{
          path: "src/CustomerList.tsx",
          action: "create" as const,
          reason: "实现客户列表页面",
          affectedSymbols: ["CustomerList"],
          downstreamConsumers: [],
          risk: "low" as const,
          evidence: ["Fixture 设计结构"],
        }],
        steps: [{
          id: "step-1",
          kind: "layout" as const,
          targetId: "customer-list-layout",
          title: "搭建客户列表页面结构",
          description: "组合页面容器、筛选区和客户表格。",
          decision: "create" as const,
          dependsOn: [],
          files: [{ path: "src/CustomerList.tsx", action: "create" as const }],
          evidence: ["Fixture 设计结构"],
          acceptanceCriteria: ["页面结构与设计区域一致"],
          risks: [],
        }],
        files: ["src/CustomerList.tsx"],
        contextGaps: [],
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
        status: "analysis_ready",
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
    streamCodeGeneration: async (_input, onEvent, signal) => {
      const patchSet = {
        patchSetHash: "a".repeat(64),
        planVersion: 1,
        planHash: "b".repeat(64),
        summary: "已按客户列表方案生成候选页面代码。",
        patches: [{
          stepId: "step-1",
          patchHash: "c".repeat(64),
          operations: [{
            path: "src/CustomerList.tsx",
            action: "create" as const,
            beforeHash: null,
            afterHash: "d".repeat(64),
            reviewDiff: "--- /dev/null\n+++ b/src/CustomerList.tsx\n@@ -1,0 +1,1 @@\n+export function CustomerList() { return <div>客户列表</div>; }",
          }],
        }],
        warnings: [],
      };
      const events = [
        { type: "code-generation-start" as const },
        {
          type: "code-generation-progress" as const,
          phase: "reading-context" as const,
          summary: "正在重新读取并校验 1 个计划文件。",
        },
        {
          type: "code-generation-progress" as const,
          phase: "generating-code" as const,
          summary: "Code Agent 正在生成候选代码。",
        },
        { type: "code-generation-result" as const, result: { status: "ready" as const, patchSet } },
        { type: "code-generation-complete" as const },
      ];
      for (const event of events) {
        if (signal?.aborted) throw new DOMException("Fixture 代码流已取消。", "AbortError");
        await onEvent(event);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      replace({
        ...snapshot,
        revision: snapshot.revision + 1,
        status: "patch_ready",
        viewModel: { ...snapshot.viewModel, codeGeneration: { status: "ready", patchSet } },
      });
    },
    cancelCodeGeneration: async () => ({ cancelled: true }),
    reset: async () => replace({
      ...snapshot,
      revision: snapshot.revision + 1,
      status: "draft",
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
        codeGeneration: { status: "idle" },
      },
    }),
  };
}

/** 本地开发复用的 Fixture 数据源。 */
export const fixtureTaskWorkflowDataSource = createFixtureTaskWorkflowDataSource();
