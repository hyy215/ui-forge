/** 验证审阅面板展示布局、交互、复用决策、文件影响和原子步骤。 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanDetails } from "./PlanDetails";

describe("PlanDetails", () => {
  it("renders repository-evidence-driven planning sections", () => {
    const markup = renderToStaticMarkup(createElement(PlanDetails, { plan: {
      status: "reviewable",
      summary: "实现客户列表",
      designUnderstanding: {
        layout: {
          summary: "筛选区位于表格上方",
          regions: [{
            id: "filter", sourceNodeIds: ["node-filter"], name: "筛选区", role: "过滤条件",
            relationship: "位于内容区上方", evidence: ["结构坐标"],
          }],
          evidence: ["设计结构"],
          warnings: [],
        },
        interactions: [{
          id: "submit-search", triggerNodeIds: ["search"], trigger: "submit", expectedEffect: "提交搜索条件",
          confidence: 0.8, evidence: ["搜索按钮"], status: "inferred",
        }],
        elements: [{
          id: "element-search", sourceNodeIds: ["search"], regionId: "filter", kind: "input",
          name: "搜索输入框", text: "输入过滤文本", textStatus: "exact", states: ["default"],
          implementation: "required", evidence: ["整体图"],
        }],
      },
      reusableComponents: [],
      newComponents: [],
      componentDecisions: [{
        candidateId: "design-table", action: "reuse-configured", source: "repository",
        repositoryComponentId: "src/Table.tsx#Table",
        reason: "Props 与结构可适配", evidence: ["AST 组件证据"],
      }],
      fileImpacts: [{
        path: "src/Page.tsx", action: "modify", reason: "装配表格", affectedSymbols: ["Page"],
        downstreamConsumers: ["src/routes.tsx"], risk: "medium", evidence: ["反向导入"],
      }],
      steps: [{
        id: "layout", kind: "layout", targetId: "page-layout", title: "建立布局", description: "创建外部容器",
        decision: "modify", dependsOn: [], files: [{ path: "src/Page.tsx", action: "modify" }], evidence: ["结构坐标"],
        designElementIds: ["element-search"], acceptanceCriteria: ["布局区域顺序一致"], risks: [],
      }],
      files: ["src/Page.tsx"],
      validationTarget: { previewPath: "/" },
      contextGaps: [],
      stopConditions: ["验证失败时停止"],
    } }));

    expect(markup).toContain("筛选区位于表格上方");
    expect(markup).toContain("静态稿推断");
    expect(markup).toContain("配置后复用");
    expect(markup).toContain("目标仓库");
    expect(markup).toContain("src/routes.tsx");
    expect(markup).toContain("外部布局");
    expect(markup).toContain("搜索输入框");
    expect(markup).toContain("覆盖视觉元素：element-search");
  });
});
