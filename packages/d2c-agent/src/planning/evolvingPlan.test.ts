/** 验证版本化 Plan 只自动调整未锁字段，并正确失效受影响 Patch。 */

import { describe, expect, it } from "vitest";
import type { PlanningResult } from "./planningResult.js";
import {
  applyHumanPlanCorrections,
  applyPlanDelta,
  bindPatchToPlan,
  createEvolvingPlanningResult,
  unlockHumanPlanFields,
} from "./evolvingPlan.js";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);

describe("evolving plan", () => {
  it("locks human corrections and invalidates only the affected step and downstream patches", () => {
    const initial = createPlan();
    const bound = bindPatchToPlan(bindPatchToPlan(bindPatchToPlan(initial, {
      patchHash: hashA, planHash: initial.planHash, stepId: "layout",
    }), {
      patchHash: hashB, planHash: initial.planHash, stepId: "navigation",
    }), {
      patchHash: hashC, planHash: initial.planHash, stepId: "validation",
    });

    const corrected = applyHumanPlanCorrections(bound, {
      reason: "人工确认左侧必须使用 Tree",
      corrections: [{
        targetId: "component:left-navigation",
        field: "component.componentType",
        value: "Tree",
      }],
    });

    expect(corrected.planVersion).toBe(2);
    expect(corrected.planHash).not.toBe(initial.planHash);
    expect(corrected.locks).toContainEqual(expect.objectContaining({
      field: "component.componentType", value: "Tree", lockedAtVersion: 2,
    }));
    expect(corrected.patchBindings).toEqual([
      expect.objectContaining({ patchHash: hashA, status: "active", planHash: corrected.planHash }),
      expect.objectContaining({ patchHash: hashB, status: "invalidated", invalidatedByPlanVersion: 2 }),
      expect.objectContaining({ patchHash: hashC, status: "invalidated", invalidatedByPlanVersion: 2 }),
    ]);
  });

  it("stops automatic revision when it conflicts with a human lock", () => {
    const corrected = applyHumanPlanCorrections(createPlan(), {
      reason: "人工确认",
      corrections: [{
        targetId: "component:left-navigation",
        field: "component.componentType",
        value: "Tree",
      }],
    });

    expect(applyPlanDelta(corrected, {
      id: "delta-menu",
      basePlanVersion: corrected.planVersion,
      basePlanHash: corrected.planHash,
      reason: "尝试改用 Menu",
      evidence: ["仓库存在 Menu"],
      intentUpdates: [{
        targetId: "component:left-navigation",
        field: "component.componentType",
        value: "Menu",
      }],
      executionChanges: [],
    })).toEqual({
      status: "human-decision-required",
      conflicts: [expect.objectContaining({ lockedValue: "Tree", proposedValue: "Menu" })],
    });
  });

  it("applies an unlocked delta, increments the version and propagates downstream impact", () => {
    const initial = createPlan();
    const result = applyPlanDelta(initial, {
      id: "delta-responsibility",
      basePlanVersion: initial.planVersion,
      basePlanHash: initial.planHash,
      reason: "编码前发现需要异步加载",
      evidence: ["目标组件 Props 不支持 loadData"],
      intentUpdates: [{
        targetId: "component:left-navigation",
        field: "component.responsibility",
        value: "展示、选择并异步加载层级目录",
      }],
      executionChanges: [{
        action: "upsert-step",
        step: {
          ...execution.steps[1],
          description: "使用 antd.Tree 包装异步目录数据",
          designElementIds: [],
        },
      }],
    });

    expect(result).toMatchObject({ status: "applied", affectedStepIds: ["navigation", "validation"] });
    if (result.status !== "applied") throw new Error("测试预期 PlanDelta 应用成功。");
    expect(result.plan.planVersion).toBe(2);
    expect(result.plan.intent.targets[1]?.fields["component.responsibility"])
      .toBe("展示、选择并异步加载层级目录");
    expect(result.plan.execution.steps[1]?.description).toContain("antd.Tree");
  });

  it("rejects stale deltas and execution changes with dangling dependencies", () => {
    const initial = createPlan();
    expect(applyPlanDelta(initial, {
      id: "stale",
      basePlanVersion: 99,
      basePlanHash: initial.planHash,
      reason: "旧版本",
      evidence: ["旧上下文"],
      intentUpdates: [{
        targetId: "component:left-navigation",
        field: "component.responsibility",
        value: "旧职责",
      }],
      executionChanges: [],
    })).toMatchObject({ status: "stale", expectedVersion: 1 });

    expect(applyPlanDelta(initial, {
      id: "remove-component",
      basePlanVersion: initial.planVersion,
      basePlanHash: initial.planHash,
      reason: "错误删除",
      evidence: ["测试结构门禁"],
      intentUpdates: [],
      executionChanges: [{ action: "remove-step", stepId: "navigation" }],
    })).toMatchObject({
      status: "rejected",
      errors: ["步骤 validation 引用了未知依赖：navigation"],
    });
  });

  it("requires explicit human unlock before a different automatic value can be applied", () => {
    const corrected = applyHumanPlanCorrections(createPlan(), {
      reason: "人工确认",
      corrections: [{
        targetId: "component:left-navigation",
        field: "component.componentType",
        value: "Tree",
      }],
    });
    const unlocked = unlockHumanPlanFields(corrected, [{
      targetId: "component:left-navigation",
      field: "component.componentType",
    }], "用户同意重新评估组件类型");
    const result = applyPlanDelta(unlocked, {
      id: "delta-menu-after-unlock",
      basePlanVersion: unlocked.planVersion,
      basePlanHash: unlocked.planHash,
      reason: "解锁后采用新证据",
      evidence: ["用户已解锁"],
      intentUpdates: [{
        targetId: "component:left-navigation",
        field: "component.componentType",
        value: "Menu",
      }],
      executionChanges: [],
    });

    expect(result).toMatchObject({ status: "applied" });
  });
});

function createPlan() {
  return createEvolvingPlanningResult({
    targets: [{
      id: "layout:page",
      kind: "layout",
      fields: { "layout.role": "左右分栏页面" },
    }, {
      id: "component:left-navigation",
      kind: "component",
      fields: {
        "component.componentType": "Tree",
        "component.responsibility": "展示并选择层级目录",
      },
    }],
  }, execution);
}

const execution: PlanningResult = {
  status: "reviewable",
  summary: "实现页面",
  designUnderstanding: {
    layout: { summary: "左右布局", regions: [], evidence: ["设计图"], warnings: [] },
    interactions: [],
  },
  reusableComponents: [],
  newComponents: [],
  componentDecisions: [],
  fileImpacts: [{
    path: "src/Navigation.tsx",
    action: "create",
    reason: "实现导航",
    affectedSymbols: ["Navigation"],
    downstreamConsumers: [],
    risk: "low",
    evidence: ["组件步骤"],
  }],
  steps: [{
    id: "layout", kind: "layout", targetId: "layout:page", title: "布局", description: "建立左右布局",
    decision: "create", dependsOn: [], files: [], evidence: ["设计图"], acceptanceCriteria: ["布局一致"], risks: [],
  }, {
    id: "navigation", kind: "component", targetId: "component:left-navigation", title: "导航", description: "实现目录树",
    decision: "create", dependsOn: ["layout"], files: [{ path: "src/Navigation.tsx", action: "create" }],
    evidence: ["设计图"], acceptanceCriteria: ["可选择节点"], risks: [],
  }, {
    id: "validation", kind: "validation", targetId: "validation", title: "验证", description: "验证页面",
    decision: "validate", dependsOn: ["navigation"], files: [], evidence: ["计划约束"], acceptanceCriteria: ["检查通过"], risks: [],
  }],
  files: ["src/Navigation.tsx"],
  validationTarget: { previewPath: "/" },
  contextGaps: [],
  stopConditions: ["未批准 Patch 前不得写入"],
};
