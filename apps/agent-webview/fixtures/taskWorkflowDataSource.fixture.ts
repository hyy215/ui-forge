/** 为本地开发模拟设计读取、持久确认和逐项方案流，不进入生产构建。 */

import type {
  CodeGenerationStreamEvent,
  D2CWorkflowSnapshot,
  DeliveryCommandPlanViewModel,
} from "@ui-forge/shared-protocol";
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
    approvePlan: async (input) => replace({
      ...snapshot,
      revision: snapshot.revision + 1,
      status: "plan_approved",
      viewModel: {
        ...snapshot.viewModel,
        conversation: {
          ...snapshot.viewModel.conversation,
          planApproval: {
            status: "approved",
            planVersion: input.planVersion,
            planHash: input.planHash,
            approvedAt: new Date().toISOString(),
            executionMode: input.executionMode,
          },
        },
      },
    }),
    approveDeliveryCommands: async (input) => {
      const codeGeneration = snapshot.viewModel.codeGeneration;
      if (codeGeneration.status !== "ready"
        || codeGeneration.deliveryCommands.status !== "approval_required"
        || codeGeneration.deliveryCommands.commandPlanHash !== input.commandPlanHash) {
        throw new Error("Fixture 命令计划已经变化。");
      }
      return replace({
        ...snapshot,
        revision: snapshot.revision + 1,
        status: "command_approved",
        viewModel: {
          ...snapshot.viewModel,
          codeGeneration: {
            ...codeGeneration,
            deliveryCommands: {
              ...codeGeneration.deliveryCommands,
              status: "approved",
              approvedAt: new Date().toISOString(),
            },
          },
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
    getDeliveryEvidence: async (input) => ({
      reference: {
        evidenceId: input.evidenceId,
        kind: "actual",
        mimeType: "image/png",
        byteSize: 68,
        sha256: "e".repeat(64),
        width: 1,
        height: 1,
      },
      dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
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
        validationTarget: { previewPath: "/" },
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
            planApproval: {
              status: "pending",
              planVersion: 1,
              planHash: "b".repeat(64),
            },
          },
        },
      });
    },
    cancelConversation: async () => ({ cancelled: true }),
    streamCodeGeneration: async (_input, onEvent, signal) => {
      const executingApprovedCommands = snapshot.status === "command_approved";
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
      const application = {
        status: "applied" as const,
        patchSetHash: patchSet.patchSetHash,
        files: [{ path: "src/CustomerList.tsx", action: "create" as const }],
        alreadyApplied: false,
        appliedAt: new Date().toISOString(),
      };
      const commandPlanBase = {
        patchSetHash: patchSet.patchSetHash,
        workspaceRoot: "/workspace/demo",
        commandPlanHash: "e".repeat(64),
        commands: [{
          commandId: "build-vite",
          purpose: "build-vite" as const,
          cwd: "/workspace/demo",
          executable: "/usr/local/bin/node",
          arguments: ["/workspace/demo/node_modules/vite/bin/vite.js", "build"],
          displayCommand: "/usr/local/bin/node /workspace/demo/node_modules/vite/bin/vite.js build",
          timeoutMs: 300_000,
          networkAccess: "none" as const,
          workspaceScope: "within-workspace" as const,
        }],
        summary: "系统将执行 1 条 Workspace 内真实命令。",
        preparedAt: "2026-08-28T00:00:00.000Z",
      };
      const deliveryCommands = (executingApprovedCommands
        ? {
            ...commandPlanBase,
            status: "approved",
            approvedAt: "2026-08-28T00:00:01.000Z",
          }
        : {
            ...commandPlanBase,
            status: "approval_required",
          }) satisfies DeliveryCommandPlanViewModel;
      const passedDeliveryValidation = {
        status: "passed" as const,
        patchSetHash: patchSet.patchSetHash,
        summary: "构建、页面渲染和视觉差异门禁均已通过。",
        build: {
          status: "passed" as const,
          command: "npm run build",
          durationMs: 480,
          summary: "目标项目构建通过。",
          outputSummary: "vite build completed",
        },
        render: {
          status: "passed" as const,
          durationMs: 320,
          summary: "页面渲染通过。",
          previewPath: "/",
          viewport: { width: 1440, height: 900 },
        },
        visual: {
          status: "passed" as const,
          durationMs: 210,
          summary: "视觉差异门禁通过。",
          pixelDifferenceRatio: 0.04,
          threshold: 0.1,
        },
        validatedAt: new Date().toISOString(),
      };
      const deliveryValidation = executingApprovedCommands
        ? passedDeliveryValidation
        : { status: "pending" as const };
      const events: CodeGenerationStreamEvent[] = [
        { type: "code-generation-start" as const },
        ...(!executingApprovedCommands ? [{
          type: "code-generation-progress" as const,
          phase: "reading-context" as const,
          summary: "正在重新读取并校验 1 个计划文件。",
        }, {
          type: "code-generation-progress" as const,
          phase: "generating-code" as const,
          summary: "Code Agent 正在生成候选代码。",
        }, {
          type: "code-generation-progress" as const,
          phase: "applying-patch" as const,
          summary: "已通过版本预检并安全应用 1 个目标文件。",
        }] : [{
          type: "code-generation-progress" as const,
          phase: "building-project" as const,
          summary: "目标项目构建通过。",
        },
        {
          type: "code-generation-progress" as const,
          phase: "rendering-page" as const,
          summary: "目标页面已完成受控渲染和截图。",
        },
        {
          type: "code-generation-progress" as const,
          phase: "evaluating-visual" as const,
          summary: "视觉差异门禁通过。",
        }]),
        {
          type: "code-generation-result" as const,
          result: {
            status: "ready" as const,
            patchSet,
            application,
            deliveryCommands,
            deliveryValidation,
          },
        },
        { type: "code-generation-complete" as const },
      ];
      for (const event of events) {
        if (signal?.aborted) throw new DOMException("Fixture 代码流已取消。", "AbortError");
        await onEvent(event);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      replace({
        ...snapshot,
        revision: snapshot.revision + (executingApprovedCommands ? 1 : 3),
        status: executingApprovedCommands ? "delivery_ready" : "command_approval_required",
        viewModel: {
          ...snapshot.viewModel,
          codeGeneration: {
            status: "ready",
            patchSet,
            application,
            deliveryCommands,
            deliveryValidation,
          },
        },
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
          planApproval: null,
        },
        codeGeneration: { status: "idle" },
      },
    }),
  };
}

/** 本地开发复用的 Fixture 数据源。 */
export const fixtureTaskWorkflowDataSource = createFixtureTaskWorkflowDataSource();
