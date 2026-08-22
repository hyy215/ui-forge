/** 验证 D2C 设置阶段的命令输入和设计预览协议边界。 */
import { describe, expect, it } from "vitest";
import {
  designPreviewSchema,
  inspectD2CDesignInputSchema,
} from "./setupProtocol.js";

describe("D2C setup protocol", () => {
  it("validates design inspection commands independently from task start", () => {
    expect(inspectD2CDesignInputSchema.parse({
      taskId: "3f566a42-9f11-4db5-91cf-16f99cb20e16",
      expectedRevision: 0,
      designUrl: "https://mastergo.com/file/123?layer_id=12:48",
    })).toMatchObject({ expectedRevision: 0 });
  });

  it("rejects oversized inline design previews", () => {
    const result = designPreviewSchema.safeParse({
      url: `data:image/png;base64,${"a".repeat(7 * 1024 * 1024)}`,
    });

    expect(result.success).toBe(false);
  });

  it("accepts a bounded Server-generated SVG data URL", () => {
    const encoded = Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>").toString("base64");

    expect(designPreviewSchema.safeParse({
      url: `data:image/svg+xml;base64,${encoded}`,
      width: 320,
      height: 180,
    }).success).toBe(true);
  });

  it("rejects non-base64 inline SVG previews", () => {
    expect(designPreviewSchema.safeParse({
      url: "data:image/svg+xml,<svg></svg>",
    }).success).toBe(false);
  });
});
