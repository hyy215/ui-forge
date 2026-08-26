/** 提供与设计平台无关的 PNG 标准化、像素差异计算和差异图生成能力。 */

import sharp from "sharp";

/** 一张只在验收进程内流转的受控图片。 */
export interface VisualImage {
  data: Uint8Array;
  mimeType: "image/png" | "image/svg+xml";
}

/** 自动视觉评测消费的设计参考图、实际截图和统一视口。 */
export interface VisualEvidence {
  referenceImage: VisualImage;
  actualImage: VisualImage;
  viewport: { width: number; height: number };
  threshold: number;
}

/** 像素差异区域的最小外接矩形。 */
export interface VisualDifferenceRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  reason: string;
}

/** 确定性视觉门禁的差异率、区域和 PNG 差异证据。 */
export interface VisualEvaluation {
  passed: boolean;
  pixelDifferenceRatio: number;
  threshold: number;
  regions: VisualDifferenceRegion[];
  differenceImage: Uint8Array;
}

/** 隔离交付流程与具体图像评测实现。 */
export interface VisualEvaluator {
  /** 将两张图片归一到同一视口并返回确定性像素门禁结果。 */
  evaluate(evidence: VisualEvidence): Promise<VisualEvaluation>;
}

const materialChannelDifference = 32;

/** 使用 Sharp 归一化图片，并把明显像素差异渲染为洋红色蒙层。 */
export class SharpPixelVisualEvaluator implements VisualEvaluator {
  /** 计算显著差异像素占比，并生成可以人工复核的差异 PNG。 */
  async evaluate(evidence: VisualEvidence): Promise<VisualEvaluation> {
    const { width, height } = validateEvidence(evidence);
    const reference = await normalizeImage(evidence.referenceImage.data, width, height);
    const actual = await normalizeImage(evidence.actualImage.data, width, height);
    const difference = Buffer.alloc(width * height * 4);
    let differentPixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      const red = Math.abs(readChannel(reference, offset) - readChannel(actual, offset));
      const green = Math.abs(readChannel(reference, offset + 1) - readChannel(actual, offset + 1));
      const blue = Math.abs(readChannel(reference, offset + 2) - readChannel(actual, offset + 2));
      const changed = Math.max(red, green, blue) > materialChannelDifference;
      if (changed) {
        differentPixels += 1;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        difference[offset] = 255;
        difference[offset + 1] = 0;
        difference[offset + 2] = 160;
        difference[offset + 3] = 220;
      } else {
        const gray = Math.round((
          readChannel(actual, offset)
          + readChannel(actual, offset + 1)
          + readChannel(actual, offset + 2)
        ) / 3);
        difference[offset] = gray;
        difference[offset + 1] = gray;
        difference[offset + 2] = gray;
        difference[offset + 3] = 90;
      }
    }
    const pixelDifferenceRatio = differentPixels / (width * height);
    return {
      passed: pixelDifferenceRatio <= evidence.threshold,
      pixelDifferenceRatio,
      threshold: evidence.threshold,
      regions: differentPixels === 0 ? [] : [{
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        reason: "存在超过通道差异阈值的像素。",
      }],
      differenceImage: await sharp(difference, {
        raw: { width, height, channels: 4 },
      }).png().toBuffer(),
    };
  }
}

/** 校验图片尺寸和通过阈值，拒绝异常内存分配。 */
function validateEvidence(evidence: VisualEvidence): { width: number; height: number } {
  const { width, height } = evidence.viewport;
  if (!Number.isInteger(width) || width < 1 || width > 1920
    || !Number.isInteger(height) || height < 1 || height > 1200) {
    throw new Error("视觉验收视口必须位于 1×1 到 1920×1200 范围内。");
  }
  if (!Number.isFinite(evidence.threshold) || evidence.threshold < 0 || evidence.threshold > 1) {
    throw new Error("视觉差异阈值必须位于 0 到 1 之间。");
  }
  return { width, height };
}

/** 将任意受支持图片按固定尺寸转为白底 RGBA 原始像素。 */
async function normalizeImage(data: Uint8Array, width: number, height: number): Promise<Buffer> {
  const { data: normalized, info } = await sharp(data, { limitInputPixels: 1920 * 1200 * 4 })
    .resize(width, height, { fit: "fill" })
    .flatten({ background: "#ffffff" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== width || info.height !== height || info.channels !== 4) {
    throw new Error("视觉验收图片无法归一到目标 RGBA 视口。");
  }
  return normalized;
}

/** 在 noUncheckedIndexedAccess 下安全读取一个已知存在的 RGBA 通道。 */
function readChannel(data: Buffer, index: number): number {
  const value = data[index];
  if (value === undefined) throw new Error("视觉验收像素数据不完整。");
  return value;
}
