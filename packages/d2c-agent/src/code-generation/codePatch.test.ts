/** 验证候选 Patch 只能逐步骤执行当前 Plan，并正确串联文件版本哈希。 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEvolvingPlanningResult } from "../planning/evolvingPlan.js";
import type { PlanningResult } from "../planning/planningResult.js";
import {
  assertCodePatchSetIntegrity,
  createCodePatchSet,
  parseCodeGenerationProposal,
} from "./codePatch.js";

describe("structured code patch", () => {
  it("creates sequential step patches and chains hashes without writing files", () => {
    const plan = createPlan();
    const firstContent = "export function Page() { return <main />; }\n";
    const finalContent = "export function Page() { return <main aria-label=\"客户列表\" />; }\n";

    const result = createCodePatchSet(plan, {
      files: [{ path: "src/Page.tsx", role: "planned", status: "missing", byteSize: 0 }],
      warnings: [],
    }, {
      status: "generated",
      summary: "实现客户列表页面",
      stepPatches: [{
        stepId: "layout",
        files: [{ path: "src/Page.tsx", action: "create", content: firstContent }],
      }, {
        stepId: "interaction",
        files: [{ path: "src/Page.tsx", action: "modify", content: finalContent }],
      }],
      warnings: [],
      blockedReasons: [],
    });

    expect("blocked" in result).toBe(false);
    if ("blocked" in result) throw new Error("测试预期生成候选 Patch。");
    expect(result.planHash).toBe(plan.planHash);
    expect(result.patches[0]?.operations[0]).toMatchObject({ beforeHash: null, afterHash: sha(firstContent) });
    expect(result.patches[1]?.operations[0]).toMatchObject({ beforeHash: sha(firstContent), afterHash: sha(finalContent) });
    expect(result.patches[1]?.operations[0]?.reviewDiff).toContain("+export function Page");
    expect(() => assertCodePatchSetIntegrity(result)).not.toThrow();

    const corrupted = structuredClone(result);
    const operation = corrupted.patches[1]?.operations[0];
    if (!operation) throw new Error("测试候选 Patch 缺少文件操作。");
    operation.content = "export const corrupted = true;\n";
    expect(() => assertCodePatchSetIntegrity(corrupted)).toThrow("内容哈希不一致");
  });

  it("rejects paths, actions and step order that differ from the Plan", () => {
    const plan = createPlan();
    expect(() => createCodePatchSet(plan, {
      files: [{ path: "src/Page.tsx", role: "planned", status: "missing", byteSize: 0 }],
      warnings: [],
    }, {
      status: "generated",
      summary: "越界提案",
      stepPatches: [{
        stepId: "layout",
        files: [{ path: "src/Other.tsx", action: "create", content: "export {};\n" }],
      }, {
        stepId: "interaction",
        files: [{ path: "src/Page.tsx", action: "modify", content: "export {};\n" }],
      }],
      warnings: [],
      blockedReasons: [],
    })).toThrow("扩大或改变");
  });

  it("requires explicit reasons for a blocked model result", () => {
    expect(() => parseCodeGenerationProposal({
      status: "blocked",
      summary: "缺少证据",
      stepPatches: [],
      warnings: [],
      blockedReasons: [],
    })).toThrow();
  });
});

/** 创建包含同一文件连续 create/modify 生命周期的版本化 Plan。 */
function createPlan() {
  return createEvolvingPlanningResult({
    targets: [{
      id: "page-layout",
      kind: "layout",
      fields: {
        "layout.role": "页面容器",
        "layout.relationship": "承载客户列表",
      },
    }, {
      id: "search",
      kind: "interaction",
      fields: {
        "interaction.trigger": "change",
        "interaction.expectedEffect": "筛选客户列表",
      },
    }],
  }, executionPlan);
}

const executionPlan: PlanningResult = {
  status: "reviewable",
  summary: "实现客户列表",
  designUnderstanding: {
    layout: { summary: "上下布局", regions: [], evidence: ["设计结构"], warnings: [] },
    interactions: [{
      id: "search",
      triggerNodeIds: ["input"],
      trigger: "change",
      expectedEffect: "筛选客户列表",
      confidence: 0.9,
      evidence: ["搜索输入框"],
      status: "inferred",
    }],
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
    title: "创建页面",
    description: "创建页面容器",
    decision: "create",
    dependsOn: [],
    files: [{ path: "src/Page.tsx", action: "create" }],
    evidence: ["设计结构"],
    acceptanceCriteria: ["页面可渲染"],
    risks: [],
  }, {
    id: "interaction",
    kind: "interaction",
    targetId: "search",
    title: "接入筛选",
    description: "实现搜索筛选",
    decision: "modify",
    dependsOn: ["layout"],
    files: [{ path: "src/Page.tsx", action: "modify" }],
    evidence: ["交互推断"],
    acceptanceCriteria: ["输入后筛选"],
    risks: [],
  }],
  files: ["src/Page.tsx"],
  validationTarget: { previewPath: "/" },
  contextGaps: [],
  stopConditions: ["Patch 未批准前不得写入"],
};

/** 计算测试断言使用的文本 SHA-256。 */
function sha(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
