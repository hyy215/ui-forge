/** 验证像素评测器对相同图片和显著差异图片产生确定性门禁结论。 */

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { SharpPixelVisualEvaluator } from "./index.js";

describe("SharpPixelVisualEvaluator", () => {
  it("passes identical images with a zero difference ratio", async () => {
    const image = await solidPng("#ffffff");
    const result = await new SharpPixelVisualEvaluator().evaluate({
      referenceImage: { data: image, mimeType: "image/png" },
      actualImage: { data: image, mimeType: "image/png" },
      viewport: { width: 4, height: 4 },
      threshold: 0,
    });

    expect(result).toMatchObject({ passed: true, pixelDifferenceRatio: 0, regions: [] });
    await expect(sharp(result.differenceImage).metadata()).resolves.toMatchObject({ width: 4, height: 4 });
  });

  it("blocks a materially different image and returns a bounded difference region", async () => {
    const result = await new SharpPixelVisualEvaluator().evaluate({
      referenceImage: { data: await solidPng("#ffffff"), mimeType: "image/png" },
      actualImage: { data: await solidPng("#000000"), mimeType: "image/png" },
      viewport: { width: 4, height: 4 },
      threshold: 0.1,
    });

    expect(result).toMatchObject({
      passed: false,
      pixelDifferenceRatio: 1,
      regions: [{ x: 0, y: 0, width: 4, height: 4 }],
    });
  });
});

/** 创建测试使用的固定尺寸纯色 PNG。 */
async function solidPng(background: string): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 4, background },
  }).png().toBuffer();
}
