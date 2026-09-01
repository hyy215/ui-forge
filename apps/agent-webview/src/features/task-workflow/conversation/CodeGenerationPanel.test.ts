/** 验证候选 Patch 面板分开展示 Plan 授权、真实命令授权和交付结论。 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DeliveryCommandPlanViewModel, PlanningResult } from "@ui-forge/shared-protocol";
import type { CodeGenerationState } from "../model/codeGenerationState";
import { CodeGenerationPanel } from "./CodeGenerationPanel";
import { DeliveryCommandApprovalPanel } from "./DeliveryCommandApprovalPanel";
import { createFixtureTaskWorkflowDataSource } from "../../../../fixtures/taskWorkflowDataSource.fixture";

const dataSource = createFixtureTaskWorkflowDataSource();
const taskId = "00000000-0000-4000-8000-000000000001";

describe("CodeGenerationPanel", () => {
  it("keeps approval disabled until the streamed Plan has a committed snapshot", () => {
    const provisional = renderToStaticMarkup(createElement(CodeGenerationPanel, {
      taskId,
      dataSource,
      plan,
      workflowStatus: "design_confirmed",
      planApproval: null,
      conversationStreamActive: true,
      isApprovingPlan: false,
      isApprovingCommands: false,
      state: idleState,
      isStopping: false,
      onApprove: () => {},
      onApproveCommands: () => {},
      onGenerate: () => {},
      onStop: () => {},
    }));
    const committed = renderToStaticMarkup(createElement(CodeGenerationPanel, {
      taskId,
      dataSource,
      plan,
      workflowStatus: "analysis_ready",
      planApproval: { status: "pending", planVersion: 1, planHash: "b".repeat(64) },
      conversationStreamActive: false,
      isApprovingPlan: false,
      isApprovingCommands: false,
      state: idleState,
      isStopping: false,
      onApprove: () => {},
      onApproveCommands: () => {},
      onGenerate: () => {},
      onStop: () => {},
    }));

    expect(provisional).toContain("方案正在提交到权威任务");
    expect(provisional).toContain('disabled=""');
    expect(committed).toContain("批准方案并生成、应用");
    expect(committed).not.toContain('disabled=""');
  });

  it("only exposes code generation after the exact Plan is approved", () => {
    const markup = renderToStaticMarkup(createElement(CodeGenerationPanel, {
      taskId,
      dataSource,
      plan,
      workflowStatus: "plan_approved",
      planApproval: {
        status: "approved",
        planVersion: 1,
        planHash: "b".repeat(64),
        approvedAt: "2026-08-28T00:00:00.000Z",
        executionMode: "generate-and-apply",
      },
      conversationStreamActive: false,
      isApprovingPlan: false,
      isApprovingCommands: false,
      state: idleState,
      isStopping: false,
      onApprove: () => {},
      onApproveCommands: () => {},
      onGenerate: () => {},
      onStop: () => {},
    }));

    expect(markup).toContain("已批准 Plan v1");
    expect(markup).toContain("继续生成并应用");
    expect(markup).not.toContain("批准方案并生成、应用");
  });

  it("shows build, render and visual evidence after automatic delivery validation", () => {
    const markup = renderToStaticMarkup(createElement(CodeGenerationPanel, {
      taskId,
      dataSource,
      plan,
      workflowStatus: "delivery_ready",
      planApproval: {
        status: "approved",
        planVersion: 1,
        planHash: "b".repeat(64),
        approvedAt: "2026-08-28T00:00:00.000Z",
        executionMode: "generate-and-apply",
      },
      conversationStreamActive: false,
      isApprovingPlan: false,
      isApprovingCommands: false,
      state: readyState,
      isStopping: false,
      onApprove: () => {},
      onApproveCommands: () => {},
      onGenerate: () => {},
      onStop: () => {},
    }));

    expect(markup).toContain("验收条件状态");
    expect(markup).toContain("3 项自动门禁通过");
    expect(markup).toContain("页面结构与设计一致");
    expect(markup).toContain("类型检查通过");
    expect(markup).toContain("代码已安全写入并通过自动交付验收");
    expect(markup).toContain("目标项目构建通过");
    expect(markup).toContain("显著差异 4.00%");
  });

  it("shows exact cwd and argv but never offers approval for a Workspace-external plan", () => {
    const approvalMarkup = renderToStaticMarkup(createElement(DeliveryCommandApprovalPanel, {
      plan: approvalRequiredCommands,
      isApproving: false,
      canApprove: true,
      canContinue: false,
      onApprove: () => {},
      onContinue: () => {},
    }));
    const manualMarkup = renderToStaticMarkup(createElement(DeliveryCommandApprovalPanel, {
      plan: {
        ...approvalRequiredCommands,
        status: "manual_only",
        commands: approvalRequiredCommands.commands.map((command) => ({
          ...command,
          workspaceScope: "manual-only" as const,
        })),
        reason: "命令工作目录位于当前 Workspace 外，系统不会提供自动执行入口。",
      },
      isApproving: false,
      canApprove: false,
      canContinue: false,
      onApprove: () => {},
      onContinue: () => {},
    }));

    expect(approvalMarkup).toContain("cwd：");
    expect(approvalMarkup).toContain("executable：");
    expect(approvalMarkup).toContain("argv：");
    expect(approvalMarkup).toContain("/usr/bin/node /workspace/node_modules/vite/bin/vite.js build");
    expect(approvalMarkup).toContain("批准以上真实命令");
    expect(manualMarkup).toContain("当前 Workspace 外");
    expect(manualMarkup).not.toContain("批准以上真实命令");
  });
});

const approvalRequiredCommands: Extract<DeliveryCommandPlanViewModel, { status: "approval_required" }> = {
  status: "approval_required",
  patchSetHash: "a".repeat(64),
  workspaceRoot: "/workspace",
  commandPlanHash: "e".repeat(64),
  commands: [{
    commandId: "build-vite",
    purpose: "build-vite",
    cwd: "/workspace",
    executable: "/usr/bin/node",
    arguments: ["/workspace/node_modules/vite/bin/vite.js", "build"],
    displayCommand: "/usr/bin/node /workspace/node_modules/vite/bin/vite.js build",
    timeoutMs: 300_000,
    networkAccess: "none",
    workspaceScope: "within-workspace",
  }],
  summary: "等待批准真实命令。",
  preparedAt: "2026-08-28T00:00:00.000Z",
};

const plan: PlanningResult = {
  status: "reviewable",
  summary: "实现客户列表",
  designUnderstanding: {
    layout: { summary: "上下布局", regions: [], evidence: ["设计结构"], warnings: [] },
    interactions: [],
  },
  reusableComponents: [],
  newComponents: [],
  componentDecisions: [],
  fileImpacts: [{
    path: "src/Page.tsx",
    action: "create",
    reason: "新增页面",
    affectedSymbols: ["Page"],
    downstreamConsumers: [],
    risk: "low",
    evidence: ["计划步骤"],
  }],
  steps: [{
    id: "layout",
    kind: "layout",
    targetId: "page-layout",
    title: "创建页面结构",
    description: "实现页面布局",
    decision: "create",
    dependsOn: [],
    files: [{ path: "src/Page.tsx", action: "create" }],
    evidence: ["设计结构"],
    acceptanceCriteria: ["页面结构与设计一致", "类型检查通过"],
    risks: [],
  }],
  files: ["src/Page.tsx"],
  validationTarget: { previewPath: "/" },
  contextGaps: [],
  stopConditions: ["验收失败时停止"],
};

const readyState: CodeGenerationState = {
  status: "ready",
  streamActive: false,
  progress: [],
  errorMessage: null,
  result: {
    status: "ready",
    patchSet: {
      patchSetHash: "a".repeat(64),
      planVersion: 1,
      planHash: "b".repeat(64),
      summary: "候选页面代码",
      patches: [{
        stepId: "layout",
        patchHash: "c".repeat(64),
        operations: [{
          path: "src/Page.tsx",
          action: "create",
          beforeHash: null,
          afterHash: "d".repeat(64),
          reviewDiff: "--- /dev/null\n+++ b/src/Page.tsx",
        }],
      }],
      warnings: [],
    },
    application: {
      status: "applied",
      patchSetHash: "a".repeat(64),
      files: [{ path: "src/Page.tsx", action: "create" }],
      alreadyApplied: false,
      appliedAt: "2026-08-28T00:00:00.000Z",
    },
    deliveryCommands: {
      status: "approved",
      patchSetHash: "a".repeat(64),
      workspaceRoot: "/workspace",
      commandPlanHash: "e".repeat(64),
      commands: [{
        commandId: "build-vite",
        purpose: "build-vite",
        cwd: "/workspace",
        executable: "/usr/bin/node",
        arguments: ["/workspace/node_modules/vite/bin/vite.js", "build"],
        displayCommand: "/usr/bin/node /workspace/node_modules/vite/bin/vite.js build",
        timeoutMs: 300_000,
        networkAccess: "none",
        workspaceScope: "within-workspace",
      }],
      summary: "命令已批准。",
      preparedAt: "2026-08-28T00:00:00.000Z",
      approvedAt: "2026-08-28T00:00:01.000Z",
    },
    deliveryValidation: {
      status: "passed",
      patchSetHash: "a".repeat(64),
      summary: "自动交付验收通过。",
      build: {
        status: "passed",
        command: "npm run build",
        durationMs: 480,
        summary: "目标项目构建通过。",
        outputSummary: "vite build completed",
      },
      render: {
        status: "passed",
        durationMs: 320,
        summary: "页面渲染通过。",
        previewPath: "/",
        viewport: { width: 1440, height: 900 },
      },
      visual: {
        status: "passed",
        durationMs: 210,
        summary: "视觉差异门禁通过。",
        pixelDifferenceRatio: 0.04,
        threshold: 0.1,
      },
      validatedAt: "2026-08-28T00:00:00.000Z",
    },
  },
};

const idleState: CodeGenerationState = {
  status: "idle",
  streamActive: false,
  progress: [],
  errorMessage: null,
  result: { status: "idle" },
};
