/** 验证代码生成结果恢复时整体修改方案默认折叠且仍可手动展开。 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConversationStreamState } from "../model/conversationStreamState";
import { PlanningProgressPanel } from "./PlanningProgressPanel";

describe("PlanningProgressPanel", () => {
  it("starts collapsed when code generation is already active or complete", () => {
    const markup = renderToStaticMarkup(createElement(PlanningProgressPanel, {
      conversation,
      collapseForCodeGeneration: true,
    }));

    expect(markup).toContain("整体修改方案");
    expect(markup).toContain("展开整体修改方案");
    expect(markup).not.toContain("布局与交互理解");
  });

  it("keeps the full Plan expanded before code generation", () => {
    const markup = renderToStaticMarkup(createElement(PlanningProgressPanel, {
      conversation,
      collapseForCodeGeneration: false,
    }));

    expect(markup).toContain("折叠整体修改方案");
    expect(markup).toContain("布局与交互理解");
  });
});

const conversation: ConversationStreamState = {
  status: "ready",
  streamStartedAt: null,
  streamFinishedAt: null,
  streamActive: false,
  processEntries: [],
  projectValidation: null,
  designComponentRecognition: null,
  errorMessage: null,
  activeStage: null,
  failureStage: null,
  plan: {
    status: "reviewable",
    summary: "实现客户列表",
    designUnderstanding: {
      layout: { summary: "上下布局", regions: [], evidence: ["设计结构"], warnings: [] },
      interactions: [],
    },
    reusableComponents: [],
    newComponents: [],
    componentDecisions: [],
    fileImpacts: [],
    steps: [{
      id: "layout",
      kind: "layout",
      targetId: "page-layout",
      title: "建立布局",
      description: "创建页面容器",
      decision: "create",
      dependsOn: [],
      files: [],
      evidence: ["设计结构"],
      acceptanceCriteria: ["布局一致"],
      risks: [],
    }],
    files: [],
    contextGaps: [],
    stopConditions: ["验证失败时停止"],
  },
};
