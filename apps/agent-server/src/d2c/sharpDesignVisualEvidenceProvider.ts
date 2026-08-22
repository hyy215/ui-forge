/** 在 Agent Server 组合边界把安全设计 SVG 栅格化为 Plan DeepAgent 的 PNG 证据。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import sharp from "sharp";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_OVERVIEW_WIDTH = 1_600;
const MAX_CANDIDATE_WIDTH = 768;
const MAX_CANDIDATE_IMAGES = 12;

/** 使用任务绑定 Artifact 定位候选，并通过 Sharp 生成有界 PNG。 */
export class SharpDesignVisualEvidenceProvider implements D2CAgent.DesignVisualEvidenceProvider {
  /** 保存只允许按 Artifact ID 读取的领域端口。 */
  constructor(private readonly artifactReader: D2CAgent.DesignArtifactReader) {}

  /** 创建一张整体图和有限数量的候选局部图，不写入磁盘。 */
  async create(
    inspection: D2CAgent.DesignInspection,
    recognition: D2CAgent.DesignComponentRecognition,
    signal?: AbortSignal,
  ): Promise<D2CAgent.DesignVisualEvidence> {
    throwIfAborted(signal);
    const warnings: string[] = [];
    const artifactId = inspection.artifact?.artifactId;
    const artifact = artifactId ? await this.artifactReader.read(artifactId) : undefined;
    const structure = artifact?.content.structure;
    const preview = inspection.context.preview;
    const svg = preview ? decodeSafeSvgDataUrl(preview.url) : undefined;
    if (!svg) return {
      images: [],
      ...(structure ? { structure: structuredClone(structure) } : {}),
      warnings: ["设计预览不是可供视觉复核使用的安全 SVG。"],
    };
    const images: D2CAgent.DesignVisualImage[] = [];
    const overview = await renderPng(
      svg,
      Math.min(MAX_OVERVIEW_WIDTH, Math.max(1, Math.round(preview?.width ?? MAX_OVERVIEW_WIDTH))),
    );
    throwIfAborted(signal);
    if (overview) images.push({ label: "整体设计预览", dataUrl: overview });
    else warnings.push("整体设计预览栅格化失败或超过图片大小上限。");

    if (!structure) return { images, warnings: [...warnings, "Artifact 缺少候选裁剪所需的结构坐标。"] };
    const nodeBounds = indexNodeBounds(structure.roots);
    for (const component of recognition.components.slice(0, MAX_CANDIDATE_IMAGES)) {
      throwIfAborted(signal);
      const bounds = unionBounds(component.sourceNodeIds.flatMap((nodeId) => {
        const value = nodeBounds.get(nodeId);
        return value ? [value] : [];
      }));
      if (!bounds) continue;
      const padded = padBounds(bounds, preview?.width, preview?.height);
      const croppedSvg = replaceSvgViewport(svg, padded);
      const image = await renderPng(
        croppedSvg,
        Math.min(MAX_CANDIDATE_WIDTH, Math.max(1, Math.round(padded.width))),
      );
      throwIfAborted(signal);
      if (image) images.push({ candidateId: component.id, label: component.name, dataUrl: image });
    }
    if (recognition.components.length > MAX_CANDIDATE_IMAGES) {
      warnings.push(`候选局部图超过 ${MAX_CANDIDATE_IMAGES} 张上限，其余候选仅使用整体预览复核。`);
    }
    return { images, structure: structuredClone(structure), warnings };
  }
}

interface AbsoluteBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 解码由设计 Adapter 生成的 SVG，并再次拒绝可执行或外部资源标记。 */
function decodeSafeSvgDataUrl(value: string): string | undefined {
  const match = /^data:image\/svg\+xml;base64,([a-z0-9+/=]+)$/i.exec(value);
  if (!match?.[1]) return undefined;
  const svg = Buffer.from(match[1], "base64").toString("utf8");
  if (!/^\s*<svg\b/i.test(svg)) return undefined;
  if (/<(?:script|foreignObject|style)\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i.test(svg)) {
    return undefined;
  }
  return svg;
}

/** 使用 Sharp 渲染 PNG，并拒绝超出 AgentCore 图片上限的结果。 */
async function renderPng(svg: string, width: number): Promise<string | undefined> {
  try {
    const buffer = await sharp(Buffer.from(svg))
      .flatten({ background: "#ffffff" })
      .resize({ width })
      .png()
      .toBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) return undefined;
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/** 将结构树中的完整绝对边界建立为节点索引。 */
function indexNodeBounds(roots: readonly D2CAgent.DesignNodeEvidence[]): Map<string, AbsoluteBounds> {
  const result = new Map<string, AbsoluteBounds>();
  const pending = [...roots];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    const bounds = node.bounds;
    if (bounds?.x !== undefined && bounds.y !== undefined
      && bounds.width !== undefined && bounds.height !== undefined
      && bounds.width > 0 && bounds.height > 0) {
      result.set(node.id, bounds as AbsoluteBounds);
    }
    pending.push(...node.children);
  }
  return result;
}

/** 合并复合组件多个来源节点的边界。 */
function unionBounds(bounds: readonly AbsoluteBounds[]): AbsoluteBounds | undefined {
  if (bounds.length === 0) return undefined;
  const left = Math.min(...bounds.map((value) => value.x));
  const top = Math.min(...bounds.map((value) => value.y));
  const right = Math.max(...bounds.map((value) => value.x + value.width));
  const bottom = Math.max(...bounds.map((value) => value.y + value.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** 为候选增加少量上下文，并限制在已知画布内。 */
function padBounds(
  bounds: AbsoluteBounds,
  canvasWidth: number | undefined,
  canvasHeight: number | undefined,
): AbsoluteBounds {
  const padding = Math.max(4, Math.min(24, Math.round(Math.min(bounds.width, bounds.height) * 0.12)));
  const x = Math.max(0, bounds.x - padding);
  const y = Math.max(0, bounds.y - padding);
  const right = Math.min(canvasWidth ?? Number.POSITIVE_INFINITY, bounds.x + bounds.width + padding);
  const bottom = Math.min(canvasHeight ?? Number.POSITIVE_INFINITY, bounds.y + bounds.height + padding);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/** 用候选绝对边界替换根 SVG viewport，使 Sharp 直接渲染局部区域。 */
function replaceSvgViewport(svg: string, bounds: AbsoluteBounds): string {
  return svg.replace(/<svg\b([^>]*)>/i, (_match, rawAttributes: string) => {
    const attributes = rawAttributes
      .replace(/\s(?:viewBox|width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");
    return `<svg${attributes} viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" width="${bounds.width}" height="${bounds.height}">`;
  });
}

/** 在栅格化批次边界响应用户取消。 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("设计视觉证据生成已由用户终止。", "AbortError");
}
