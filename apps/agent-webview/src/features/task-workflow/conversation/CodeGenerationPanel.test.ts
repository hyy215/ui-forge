/** 验证候选 Patch 面板明确展示尚未执行的 Plan 验收条件。 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanningResult } from "@ui-forge/shared-protocol";
import type { CodeGenerationState } from "../model/codeGenerationState";
import { CodeGenerationPanel } from "./CodeGenerationPanel";

describe("CodeGenerationPanel", () => {
  it("marks every Plan acceptance criterion as pending verification", () => {
    const markup = renderToStaticMarkup(createElement(CodeGenerationPanel, {
      plan,
      state: readyState,
      isStopping: false,
      onGenerate: () => {},
      onStop: () => {},
    }));

    expect(markup).toContain("验收条件状态");
    expect(markup).toContain("0 项已验证 · 2 项待验证");
    expect(markup).toContain("页面结构与设计一致");
    expect(markup).toContain("类型检查通过");
    expect(markup).toContain("候选代码尚未执行验收");
  });
});

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
  },
};
