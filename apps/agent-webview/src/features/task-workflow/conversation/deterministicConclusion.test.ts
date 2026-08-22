/** 验证右侧结论只消费主 Agent 的最终组件判断。 */

import { describe, expect, it } from "vitest";
import { createDeterministicConclusion } from "./deterministicConclusion";

describe("createDeterministicConclusion", () => {
  it("returns project facts and only confirmed component types", () => {
    expect(createDeterministicConclusion(
      { kind: "empty", message: "空项目" },
      {
        status: "recognized",
        components: [
          { id: "search-1", name: "搜索", instanceCount: 1, evidence: ["搜索结构"], evidenceStrength: "structural", effectiveTypeId: "search-input", resolvedBy: "model", resolutionReason: "视觉证据明确" },
          { id: "table-1", name: "表格", instanceCount: 1, evidence: ["表格结构"], evidenceStrength: "structural", effectiveTypeId: "table", resolvedBy: "catalog", resolutionReason: "目录映射明确" },
          { id: "unknown-1", name: "未知", instanceCount: 1, evidence: ["证据不足"], evidenceStrength: "weak", resolvedBy: "unresolved", resolutionReason: "证据不足" },
        ],
        warnings: [],
      },
    )).toEqual({
      projectConclusion: "当前为空项目，实施前需要初始化 React + TypeScript + Ant Design 项目。",
      componentTypes: ["Search Input", "Table"],
      unresolvedComponents: ["未知"],
      blocked: false,
    });
  });

  it("reports unsupported project reasons without producing component guesses", () => {
    expect(createDeterministicConclusion({
      kind: "unsupported",
      message: "不支持",
      reasons: ["缺少 React", "缺少 Ant Design"],
    }, null)).toEqual({
      projectConclusion: "当前项目不在支持范围：缺少 React；缺少 Ant Design。",
      componentTypes: [],
      unresolvedComponents: [],
      blocked: true,
    });
  });

  it("keeps unresolved main-agent decisions pending", () => {
    expect(createDeterministicConclusion(null, {
      status: "recognized",
      components: [{
        id: "navigation-1",
        name: "顶部区域",
        instanceCount: 1,
        evidence: ["名称包含导航语义"],
        evidenceStrength: "weak",
        visualSuggestion: {
          suggestedTypeId: "tabs",
          confidence: 0.8,
          evidence: ["图片更接近页签结构"],
        },
        resolvedBy: "unresolved",
        resolutionReason: "目录提示与视觉建议冲突",
      }],
      warnings: [],
    })).toMatchObject({
      componentTypes: [],
      unresolvedComponents: ["顶部区域"],
    });
  });
});
