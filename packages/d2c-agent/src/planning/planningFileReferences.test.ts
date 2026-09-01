/** 验证规划消费者路径只在证据唯一时归一化，并支持方案内新建文件。 */

import { describe, expect, it } from "vitest";
import type { PlanningResult } from "./planningResult.js";
import {
  normalizePlanningConsumerPaths,
  reconcilePlanningFileOperations,
} from "./planningFileReferences.js";

describe("planning file references", () => {
  it("normalizes unique file names, stems, and index directory names", () => {
    const plan = createPlan(["App.tsx", "router", "CustomerPage"]);

    const normalized = normalizePlanningConsumerPaths(plan, [
      "src/App.tsx",
      "src/router/index.tsx",
      "src/pages/CustomerPage.tsx",
      "src/components/Table.tsx",
    ]);

    expect(normalized.fileImpacts[0]?.downstreamConsumers).toEqual([
      "src/App.tsx",
      "src/router/index.tsx",
      "src/pages/CustomerPage.tsx",
    ]);
  });

  it("accepts an exact consumer path created by the same plan", () => {
    const plan = createPlan(["src/pages/NewPage.tsx"]);
    plan.fileImpacts.push({
      path: "src/pages/NewPage.tsx", action: "create", reason: "新增页面",
      affectedSymbols: ["NewPage"], downstreamConsumers: [], risk: "low", evidence: ["方案步骤"],
    });

    const normalized = normalizePlanningConsumerPaths(plan, ["src/components/Table.tsx"]);

    expect(normalized.fileImpacts[0]?.downstreamConsumers).toEqual(["src/pages/NewPage.tsx"]);
  });

  it("rejects ambiguous or unknown consumer shorthand", () => {
    expect(() => normalizePlanningConsumerPaths(createPlan(["App.tsx"]), [
      "src/App.tsx", "src/admin/App.tsx", "src/components/Table.tsx",
    ])).toThrow("消费者路径存在歧义");
    expect(() => normalizePlanningConsumerPaths(createPlan(["missing"]), [
      "src/components/Table.tsx",
    ])).toThrow("未知消费者");
  });

  it("treats an unscanned file as create when the component has explicit create intent", () => {
    const plan = createPlan([]);
    plan.componentDecisions = [{
      candidateId: "navigation-tree",
      action: "create-new",
      source: "new",
      reason: "仓库没有可复用组件",
      evidence: ["组件检索为空"],
    }];
    plan.fileImpacts = [{
      path: "src/components/NavigationTree.tsx",
      action: "modify",
      reason: "实现导航树",
      affectedSymbols: ["NavigationTree"],
      downstreamConsumers: [],
      risk: "low",
      evidence: ["设计包含左侧导航树"],
    }];
    plan.steps = [{
      id: "navigation-tree",
      kind: "component",
      targetId: "navigation-tree",
      title: "实现导航树",
      description: "新增左侧导航树",
      decision: "create",
      dependsOn: [],
      files: [{ path: "src/components/NavigationTree.tsx", action: "modify" }],
      evidence: ["设计包含左侧导航树"],
      acceptanceCriteria: ["导航树结构匹配"],
      risks: [],
    }];

    const reconciled = reconcilePlanningFileOperations(plan, ["src/App.tsx"], true);

    expect(reconciled.fileImpacts[0]?.action).toBe("create");
    expect(reconciled.steps[0]?.files[0]?.action).toBe("create");
    expect(reconciled.contextGaps).not.toContain(expect.stringContaining("NavigationTree.tsx"));
  });

  it("blocks an unproven modified path instead of silently changing it to create", () => {
    const plan = createPlan([]);
    plan.fileImpacts = [{
      ...plan.fileImpacts[0]!,
      path: "src/components/Unknown.tsx",
      action: "modify",
    }];

    const reconciled = reconcilePlanningFileOperations(plan, ["src/components/Table.tsx"], false);

    expect(reconciled.status).toBe("blocked");
    expect(reconciled.fileImpacts[0]?.action).toBe("modify");
    expect(reconciled.contextGaps).toContainEqual(expect.stringContaining("仓库扫描不完整"));
    expect(reconciled.stopConditions).toContainEqual(expect.stringContaining("Unknown.tsx"));
  });

  it("keeps an explicit create plan blocked when the repository scan is incomplete", () => {
    const plan = createPlan([]);
    plan.fileImpacts = [{
      ...plan.fileImpacts[0]!,
      path: "src/components/PossiblyExisting.tsx",
      action: "create",
    }];

    const reconciled = reconcilePlanningFileOperations(plan, [], false);

    expect(reconciled.status).toBe("blocked");
    expect(reconciled.fileImpacts[0]?.action).toBe("create");
    expect(reconciled.contextGaps).toContainEqual(expect.stringContaining("仓库扫描不完整"));
  });

  it("creates a new file once and changes later step operations to modify", () => {
    const plan = createPlan([]);
    plan.steps = [{
      ...plan.steps[0]!, id: "create-page", kind: "layout", decision: "create",
      files: [{ path: "src/Page.tsx", action: "create" }],
    }, {
      ...plan.steps[0]!, id: "wire-page", kind: "cross-cutting", decision: "modify",
      files: [{ path: "src/Page.tsx", action: "create" }],
    }];

    const reconciled = reconcilePlanningFileOperations(plan, [], true);

    expect(reconciled.steps.map((step) => step.files[0]?.action)).toEqual(["create", "modify"]);
  });
});

/** 创建只包含文件影响字段的最小规划测试数据。 */
function createPlan(consumers: string[]): PlanningResult {
  return {
    status: "blocked",
    summary: "测试文件影响",
    designUnderstanding: {
      layout: { summary: "测试布局", regions: [], evidence: ["测试"], warnings: [] },
      interactions: [],
    },
    reusableComponents: [],
    newComponents: [],
    componentDecisions: [],
    fileImpacts: [{
      path: "src/components/Table.tsx", action: "modify", reason: "更新表格",
      affectedSymbols: ["Table"], downstreamConsumers: consumers, risk: "medium", evidence: ["依赖分析"],
    }],
    steps: [{
      id: "validation", kind: "validation", targetId: "plan", title: "验证", description: "验证文件影响",
      decision: "validate", dependsOn: [], files: [], evidence: ["测试"], acceptanceCriteria: ["通过"], risks: [],
    }],
    files: [],
    validationTarget: { previewPath: "/" },
    contextGaps: [],
    stopConditions: ["不得写入"],
  };
}
