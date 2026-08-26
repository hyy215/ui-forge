/** 验证候选代码 Patch、阻塞结论和流事件的公共协议门禁。 */

import { describe, expect, it } from "vitest";
import {
  codeGenerationStreamEventSchema,
  codeGenerationViewModelSchema,
  codePatchSetSchema,
} from "./codeGenerationProtocol.js";

const hash = "a".repeat(64);

describe("code generation protocol", () => {
  it("accepts a reviewable Patch without exposing generated file contents", () => {
    const result = codePatchSetSchema.parse({
      patchSetHash: hash,
      planVersion: 1,
      planHash: hash,
      summary: "候选代码",
      patches: [{
        stepId: "layout",
        patchHash: hash,
        operations: [{
          path: "src/Page.tsx",
          action: "create",
          beforeHash: null,
          afterHash: hash,
          reviewDiff: "--- /dev/null\n+++ b/src/Page.tsx",
        }],
      }],
      warnings: [],
    });

    expect(result.patches[0]?.operations[0]).not.toHaveProperty("content");
  });

  it("rejects malformed hashes and incomplete blocked states", () => {
    expect(codePatchSetSchema.safeParse({ patchSetHash: "short" }).success).toBe(false);
    expect(codeGenerationViewModelSchema.safeParse({
      status: "blocked",
      summary: "文件变化",
      reasons: [],
      warnings: [],
    }).success).toBe(false);
    expect(codeGenerationViewModelSchema.safeParse({
      status: "ready",
      patchSet: {
        patchSetHash: hash,
        planVersion: 1,
        planHash: hash,
        summary: "候选代码",
        patches: [{
          stepId: "layout",
          patchHash: hash,
          operations: [{
            path: "src/Page.tsx",
            action: "create",
            beforeHash: null,
            afterHash: hash,
            reviewDiff: "diff",
          }],
        }],
        warnings: [],
      },
      application: {
        status: "applied",
        patchSetHash: hash,
        files: [],
        alreadyApplied: false,
        appliedAt: "2026-08-28T00:00:00.000Z",
      },
    }).success).toBe(false);
    expect(codePatchSetSchema.safeParse({
      patchSetHash: hash,
      planVersion: 1,
      planHash: hash,
      summary: "越界 Patch",
      patches: [{
        stepId: "layout",
        patchHash: hash,
        operations: [{
          path: "../secret.ts",
          action: "create",
          beforeHash: null,
          afterHash: hash,
          reviewDiff: "diff",
        }],
      }],
      warnings: [],
    }).success).toBe(false);
  });

  it("accepts only declared code generation phases", () => {
    expect(codeGenerationStreamEventSchema.safeParse({
      type: "code-generation-progress",
      phase: "generating-code",
      summary: "正在生成",
    }).success).toBe(true);
    expect(codeGenerationStreamEventSchema.safeParse({
      type: "code-generation-progress",
      phase: "applying-patch",
      summary: "正在安全落盘",
    }).success).toBe(true);
    expect(codeGenerationStreamEventSchema.safeParse({
      type: "code-generation-progress",
      phase: "evaluating-visual",
      summary: "正在执行视觉差异门禁",
    }).success).toBe(true);
    expect(codeGenerationStreamEventSchema.safeParse({
      type: "code-generation-progress",
      phase: "executing-shell",
      summary: "越界阶段",
    }).success).toBe(false);
  });
});
