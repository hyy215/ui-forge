/** 将 MasterGo 分段 DSL 与官方 SVG 提取结果确定性合成为安全的整页预览。 */

import { z } from "zod";
import type { D2CAgent } from "@ui-forge/d2c-agent";
import type { RawDesignPayload } from "./types.js";

const extractedSvgSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  svg: z.string().min(1).max(2 * 1024 * 1024),
}).passthrough();

const extractedSvgPageSchema = z.object({
  totalCount: z.number().int().nonnegative().optional(),
  count: z.number().int().nonnegative().optional(),
  svgs: z.array(extractedSvgSchema).max(100),
  page: z.number().int().nonnegative().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  hasMore: z.boolean().optional(),
}).passthrough();

const MAX_PREVIEW_SVG_BYTES = 5 * 1024 * 1024;

/** 表示 MasterGo `extractSvg` 返回的一个原始矢量资源。 */
export type MasterGoExtractedSvg = z.infer<typeof extractedSvgSchema>;

/** 表示经过运行时校验的单页 MasterGo SVG 提取结果。 */
export type MasterGoExtractedSvgPage = z.infer<typeof extractedSvgPageSchema>;

/** 记录官方 SVG 资源在安全预览合成中的使用情况。 */
export interface MasterGoPreviewDiagnostics {
  extractedAssetCount: number;
  renderedAssetCount: number;
  rejectedAssetCount: number;
  unmatchedAssetCount: number;
}

/** 返回可选预览及其资源覆盖诊断。 */
export interface MasterGoPreviewBuildResult {
  preview?: D2CAgent.DesignPreview;
  diagnostics: MasterGoPreviewDiagnostics;
}

/** 校验 MCP 的单页 SVG 提取结果，拒绝形状异常或数量失控的外部数据。 */
export function parseMasterGoExtractedSvgPage(value: unknown): MasterGoExtractedSvgPage {
  return extractedSvgPageSchema.parse(value);
}

/**
 * 使用完整分段布局、文本与官方矢量资源创建无需模型参与的 SVG data URL。
 * 无法确认根画布尺寸、没有可渲染节点或结果超限时返回 undefined，由调用方降级。
 */
export function createMasterGoHighFidelityPreview(
  payload: RawDesignPayload,
  extractedSvgs: MasterGoExtractedSvg[],
): D2CAgent.DesignPreview | undefined {
  return createMasterGoHighFidelityPreviewResult(payload, extractedSvgs).preview;
}

/** 合成安全预览，并返回资源匹配覆盖率供 Adapter 生成明确降级警告。 */
export function createMasterGoHighFidelityPreviewResult(
  payload: RawDesignPayload,
  extractedSvgs: MasterGoExtractedSvg[],
): MasterGoPreviewBuildResult {
  const metadata = asRecord(payload.sectionList.rootMetadata);
  const width = readPositiveNumber(metadata?.width);
  const height = readPositiveNumber(metadata?.height);
  const safeAssets = extractedSvgs.filter((asset) => isSafeExtractedSvg(asset.svg));
  const diagnostics = createPreviewDiagnostics(extractedSvgs.length, safeAssets.length);
  if (!width || !height) return { diagnostics };

  const assetIndex = createAssetIndex(safeAssets);
  const usedAssetIds = new Set<string>();
  const sectionDirectory = Array.isArray(payload.sectionList.sections)
    ? payload.sectionList.sections
    : [];

  const renderedSections = payload.sections.flatMap((sectionPayload, index) => {
    const directoryEntry = asRecord(sectionDirectory[index]);
    const sectionX = readFiniteNumber(directoryEntry?.x) ?? 0;
    const sectionY = readFiniteNumber(directoryEntry?.y) ?? 0;
    const sectionRecord = asRecord(sectionPayload);
    const dsl = asRecord(sectionRecord?.dsl);
    const nodes = Array.isArray(dsl?.nodes) ? dsl.nodes : [];
    const styles = asRecord(dsl?.styles) ?? {};
    const rendered = nodes.map((node) => renderNode(node, {
      assetIndex,
      styles,
      usedAssetIds,
    })).join("");
    return rendered ? [`<g transform="translate(${formatNumber(sectionX)} ${formatNumber(sectionY)})">${rendered}</g>`] : [];
  });

  const fallbackAssets = renderUnmatchedAssets(
    safeAssets,
    usedAssetIds,
    payload.sectionList,
    sectionDirectory,
  );
  const background = resolveRootBackground(payload.sectionList) ?? "#ffffff";
  const body = `${fallbackAssets}${renderedSections.join("")}`;
  diagnostics.renderedAssetCount = usedAssetIds.size;
  diagnostics.unmatchedAssetCount = safeAssets.length - usedAssetIds.size;
  if (!body) return { diagnostics };

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNumber(width)} ${formatNumber(height)}"`,
    ` width="${formatNumber(width)}" height="${formatNumber(height)}" role="img" aria-label="${escapeXml(readString(metadata, ["name"]) ?? "MasterGo design preview")}">`,
    `<rect width="100%" height="100%" fill="${escapeXml(background)}"/>`,
    body,
    "</svg>",
  ].join("");
  if (Buffer.byteLength(svg, "utf8") > MAX_PREVIEW_SVG_BYTES) return { diagnostics };

  return {
    preview: {
      url: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`,
      width,
      height,
    },
    diagnostics,
  };
}

interface AssetIndex {
  byId: Map<string, MasterGoExtractedSvg>;
  byUniqueName: Map<string, MasterGoExtractedSvg>;
}

interface RenderContext {
  assetIndex: AssetIndex;
  styles: Record<string, unknown>;
  usedAssetIds: Set<string>;
}

/** 将一个已校验收窄过程中的 DSL 节点递归渲染为 SVG 片段。 */
function renderNode(
  value: unknown,
  context: RenderContext,
  inheritedAsset?: MasterGoExtractedSvg,
): string {
  const node = asRecord(value);
  if (!node) return "";
  const layout = asRecord(node.layoutStyle) ?? {};
  const x = readFiniteNumber(layout.relativeX) ?? readFiniteNumber(layout.x) ?? 0;
  const y = readFiniteNumber(layout.relativeY) ?? readFiniteNumber(layout.y) ?? 0;
  const width = readPositiveNumber(layout.width);
  const height = readPositiveNumber(layout.height);
  const type = readString(node, ["type"])?.toUpperCase();
  const children = Array.isArray(node.children) ? node.children : [];
  const pathDescendantCount = countPathNodes(node);
  const asset = type === "PATH"
    ? findAsset(context.assetIndex, node) ?? inheritedAsset
    : undefined;
  const descendantAsset = type !== "PATH" && pathDescendantCount === 1
    ? findAsset(context.assetIndex, node) ?? inheritedAsset
    : undefined;
  const intrinsicSize = asset ? readExtractedSvgSize(asset.svg) : undefined;
  const assetWidth = width ?? intrinsicSize?.width;
  const assetHeight = height ?? intrinsicSize?.height;
  const transform = x || y ? ` transform="translate(${formatNumber(x)} ${formatNumber(y)})"` : "";

  if (asset && assetWidth && assetHeight) {
    const extracted = renderExtractedAsset(asset, assetWidth, assetHeight);
    if (extracted) {
      context.usedAssetIds.add(asset.id);
      return `<g${transform}>${extracted}</g>`;
    }
  }

  if (type === "TEXT") return renderTextNode(node, layout, context.styles, transform);
  if (type === "PATH") return renderPathNode(node, transform);

  const fill = resolveColor(node._color, node.fill, context.styles);
  const stroke = resolveColor(undefined, node.strokeColor, context.styles);
  const strokeWidth = readCssNumber(node.strokeWidth);
  const radius = readCssNumber(node.radius) ?? readCssNumber(node.cornerRadius) ?? 0;
  const opacity = readOpacity(node.opacity);
  const shape = width && height && (fill || stroke)
    ? `<rect width="${formatNumber(width)}" height="${formatNumber(height)}"${fill ? ` fill="${escapeXml(fill)}"` : " fill=\"none\""}${stroke ? ` stroke="${escapeXml(stroke)}"` : ""}${strokeWidth ? ` stroke-width="${formatNumber(strokeWidth)}"` : ""}${radius ? ` rx="${formatNumber(radius)}" ry="${formatNumber(radius)}"` : ""}${opacity !== undefined ? ` opacity="${formatNumber(opacity)}"` : ""}/>`
    : "";
  const renderedChildren = children.map((child) => renderNode(
    child,
    context,
    descendantAsset && countPathNodes(child) === 1 ? descendantAsset : undefined,
  )).join("");
  if (!shape && !renderedChildren) return "";
  return `<g${transform}>${shape}${renderedChildren}</g>`;
}

/** 将文本节点及其首个字体样式渲染为不依赖 foreignObject 的 SVG text。 */
function renderTextNode(
  node: Record<string, unknown>,
  layout: Record<string, unknown>,
  styles: Record<string, unknown>,
  transform: string,
): string {
  const segments = Array.isArray(node.text) ? node.text : [];
  const text = segments.map((segment) => readString(asRecord(segment), ["text"]) ?? "").join("");
  if (!text) return "";
  const firstSegment = asRecord(segments[0]);
  const fontKey = readString(firstSegment, ["font"]);
  const fontStyle = fontKey ? asRecord(asRecord(styles[fontKey])?.value) : undefined;
  const fontSize = readPositiveNumber(fontStyle?.size) ?? 12;
  const lineHeight = readCssNumber(fontStyle?.lineHeight) ?? fontSize * 1.2;
  const letterSpacing = readCssNumber(fontStyle?.letterSpacing) ?? 0;
  const fontFamily = readString(fontStyle, ["family"]);
  const fontWeight = readString(fontStyle, ["weight"]);
  const width = readPositiveNumber(layout.width) ?? 0;
  const height = readPositiveNumber(layout.height) ?? lineHeight;
  const align = readString(node, ["textAlign"]);
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
  const textX = align === "center" ? width / 2 : align === "right" ? width : 0;
  const fill = resolveColor(node._color, node.fill, styles) ?? "#1f1f1f";
  const textMode = readString(node, ["textMode"]);
  const lines = textMode === "auto-height" && width > 0
    ? wrapTextToWidth(text, width, fontSize, letterSpacing)
    : text.split(/\r?\n/);
  const firstY = Math.max(fontSize, (height - lineHeight * lines.length) / 2 + fontSize);
  const tspans = lines.map((line, index) => (
    `<tspan x="${formatNumber(textX)}" dy="${index === 0 ? formatNumber(firstY) : formatNumber(lineHeight)}">${escapeXml(line)}</tspan>`
  )).join("");
  return `<text${transform} fill="${escapeXml(fill)}" font-size="${formatNumber(fontSize)}"${fontFamily ? ` font-family="${escapeXml(fontFamily)}"` : ""}${fontWeight ? ` font-weight="${escapeXml(fontWeight)}"` : ""} text-anchor="${anchor}">${tspans}</text>`;
}

/** 按 MasterGo 文本框宽度折行，保留显式换行并避免依赖浏览器测量 API。 */
function wrapTextToWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
  letterSpacing: number,
): string[] {
  return text.split(/\r?\n/).flatMap((paragraph) => {
    if (!paragraph) return [""];
    const lines: string[] = [];
    let current = "";
    let currentWidth = 0;
    for (const character of Array.from(paragraph)) {
      const characterWidth = estimateCharacterWidth(character, fontSize) + letterSpacing;
      if (current && currentWidth + characterWidth > maxWidth) {
        if (isClosingPunctuation(character)) {
          current += character;
          currentWidth += characterWidth;
          continue;
        }
        lines.push(current.trimEnd());
        current = character.trimStart();
        currentWidth = current ? characterWidth : 0;
        continue;
      }
      current += character;
      currentWidth += characterWidth;
    }
    if (current || lines.length === 0) lines.push(current.trimEnd());
    return lines;
  });
}

/** 使用字体无关的保守字宽模型估算 CJK、拉丁字符、数字和空白的 SVG 占位宽度。 */
function estimateCharacterWidth(character: string, fontSize: number): number {
  if (/\s/u.test(character)) return fontSize * 0.33;
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(character)) {
    return fontSize;
  }
  if (/\p{Extended_Pictographic}/u.test(character)) return fontSize;
  if (/[，。；：！？、]/u.test(character)) return fontSize;
  if (/[A-Z]/.test(character)) return fontSize * 0.65;
  if (/[a-z0-9]/.test(character)) return fontSize * 0.56;
  if (/[,.;:!?'"`()\[\]{}]/u.test(character)) return fontSize * 0.5;
  return fontSize * 0.6;
}

/** 判断字符是否属于换行时不应出现在行首的闭合标点。 */
function isClosingPunctuation(character: string): boolean {
  return /[，。；：！？、,.;;:!?）】》〉」』”’\])}]/u.test(character);
}

/** 统计节点自身及其后代中的 PATH 数量，用于限制 SVG 资源的无歧义向下传递。 */
function countPathNodes(value: unknown): number {
  const node = asRecord(value);
  if (!node) return 0;
  const ownCount = readString(node, ["type"])?.toUpperCase() === "PATH" ? 1 : 0;
  const children = Array.isArray(node.children) ? node.children : [];
  return ownCount + children.reduce((total, child) => total + countPathNodes(child), 0);
}

/** 渲染仍然内联保留 path data 的 PATH 节点。 */
function renderPathNode(node: Record<string, unknown>, transform: string): string {
  const paths = Array.isArray(node.path) ? node.path : [];
  const rendered = paths.flatMap((value) => {
    const path = asRecord(value);
    const data = readString(path, ["data"]);
    if (!data) return [];
    const fill = readString(path, ["fill"]) ?? "currentColor";
    return [`<path d="${escapeXml(data)}" fill="${escapeXml(fill)}"/>`];
  }).join("");
  return rendered ? `<g${transform}>${rendered}</g>` : "";
}

/** 将未在节点树中命中的聚合矢量按 section 或 split container 的绝对坐标补入预览。 */
function renderUnmatchedAssets(
  assets: MasterGoExtractedSvg[],
  usedAssetIds: Set<string>,
  sectionList: Record<string, unknown>,
  sectionDirectory: unknown[],
): string {
  const placements = new Map<string, Record<string, unknown>>();
  for (const value of sectionDirectory) {
    const placement = asRecord(value);
    const id = readString(placement, ["id"]);
    if (id && placement) placements.set(id, placement);
  }
  const splitContainers = Array.isArray(sectionList.splitContainers) ? sectionList.splitContainers : [];
  for (const value of splitContainers) {
    const placement = asRecord(value);
    const id = readString(placement, ["id"]);
    if (id && placement) placements.set(id, placement);
  }

  return assets.flatMap((asset) => {
    if (usedAssetIds.has(asset.id)) return [];
    const placement = placements.get(asset.id);
    const x = readFiniteNumber(placement?.x);
    const y = readFiniteNumber(placement?.y);
    const width = readPositiveNumber(placement?.width);
    const height = readPositiveNumber(placement?.height);
    if (x === undefined || y === undefined || !width || !height) return [];
    const rendered = renderExtractedAsset(asset, width, height);
    if (rendered) usedAssetIds.add(asset.id);
    return rendered
      ? [`<g transform="translate(${formatNumber(x)} ${formatNumber(y)})">${rendered}</g>`]
      : [];
  }).join("");
}

/** 将官方 SVG 的安全内部 markup 放入设计节点自身坐标系。 */
function renderExtractedAsset(asset: MasterGoExtractedSvg, width: number, height: number): string {
  if (!isSafeExtractedSvg(asset.svg)) return "";
  const inner = asset.svg
    .replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, "")
    .replace(/^\s*<svg\b[^>]*>/i, "")
    .replace(/<\/svg>\s*$/i, "");
  if (!inner.trim()) return "";
  const viewBox = readExtractedSvgViewBox(asset.svg)
    ?? `0 0 ${formatNumber(width)} ${formatNumber(height)}`;
  return `<svg width="${formatNumber(width)}" height="${formatNumber(height)}" viewBox="${viewBox}" preserveAspectRatio="none" overflow="visible">${inner}</svg>`;
}

/** 对 MCP SVG 执行可执行标记、foreignObject 和外部资源拒绝。 */
function isSafeExtractedSvg(svg: string): boolean {
  if (!/<svg\b/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) return false;
  if (/<\s*(?:script|foreignObject|style)\b|\son[a-z]+\s*=|javascript:|@import\b/i.test(svg)) return false;
  if (/(?:href|src)\s*=\s*["']\s*(?!#)[^"']+/i.test(svg)) return false;
  if (/url\(\s*["']?\s*(?:https?:|\/\/|data:|javascript:)/i.test(svg)) return false;
  return true;
}

/** 使用精确 ID，或实例展开后形成的末级 ID，匹配官方提取资源。 */
function findAsset(index: AssetIndex, node: Record<string, unknown>): MasterGoExtractedSvg | undefined {
  const keys = [
    readString(node, ["svgShortKey"]),
    readString(node, ["id"]),
  ].filter((value): value is string => value !== undefined);
  for (const key of keys) {
    const exact = index.byId.get(key);
    if (exact) return exact;
    for (const asset of index.byId.values()) {
      if (asset.id.endsWith(`/${key}`) || key.endsWith(`/${asset.id}`)) return asset;
    }
  }
  const name = readString(node, ["name"]);
  return name ? index.byUniqueName.get(name) : undefined;
}

/** 为官方资源创建 ID 与无歧义名称索引，避免同名图标错误复用。 */
function createAssetIndex(assets: MasterGoExtractedSvg[]): AssetIndex {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const nameCounts = new Map<string, number>();
  for (const asset of assets) {
    if (asset.name) nameCounts.set(asset.name, (nameCounts.get(asset.name) ?? 0) + 1);
  }
  const byUniqueName = new Map(assets.flatMap((asset) => (
    asset.name && nameCounts.get(asset.name) === 1 ? [[asset.name, asset] as const] : []
  )));
  return { byId, byUniqueName };
}

/** 读取安全的数值 viewBox，保留官方坐标系并拒绝属性注入。 */
function readExtractedSvgViewBox(svg: string): string | undefined {
  const match = /\bviewBox\s*=\s*["']\s*([-+\d.eE]+)[ ,]+([-+\d.eE]+)[ ,]+([-+\d.eE]+)[ ,]+([-+\d.eE]+)\s*["']/i.exec(svg);
  if (!match) return undefined;
  const values = match.slice(1).map(Number);
  if (values.some((value) => !Number.isFinite(value)) || values[2]! <= 0 || values[3]! <= 0) {
    return undefined;
  }
  return values.map(formatNumber).join(" ");
}

/** 从官方 viewBox 读取缺失布局尺寸时可用的固有宽高。 */
function readExtractedSvgSize(svg: string): { width: number; height: number } | undefined {
  const viewBox = readExtractedSvgViewBox(svg);
  if (!viewBox) return undefined;
  const values = viewBox.split(" ").map(Number);
  const width = values[2];
  const height = values[3];
  return width && height ? { width, height } : undefined;
}

/** 初始化不会包含负数的预览资源覆盖统计。 */
function createPreviewDiagnostics(
  extractedAssetCount: number,
  safeAssetCount: number,
): MasterGoPreviewDiagnostics {
  return {
    extractedAssetCount,
    renderedAssetCount: 0,
    rejectedAssetCount: extractedAssetCount - safeAssetCount,
    unmatchedAssetCount: safeAssetCount,
  };
}

/** 从根容器或元数据解析已收窄的十六进制背景色。 */
function resolveRootBackground(sectionList: Record<string, unknown>): string | undefined {
  const rootContainer = asRecord(sectionList.rootContainer);
  const direct = readString(rootContainer, ["background"]);
  if (direct && /^#[\da-f]{3,8}$/i.test(direct)) return direct;
  const metadata = asRecord(sectionList.rootMetadata);
  const styles = asRecord(metadata?.styles) ?? {};
  return resolveColor(undefined, metadata?.fill, styles);
}

/** 从内联颜色或 MasterGo style 引用中解析安全的 CSS 颜色。 */
function resolveColor(
  directValue: unknown,
  styleReference: unknown,
  styles: Record<string, unknown>,
): string | undefined {
  const direct = typeof directValue === "string" ? directValue : undefined;
  if (direct && isSafeColor(direct)) return direct;
  if (typeof styleReference !== "string") return undefined;
  if (isSafeColor(styleReference)) return styleReference;
  const style = asRecord(styles[styleReference]);
  const value = style?.value;
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && isSafeColor(candidate) ? candidate : undefined;
}

/** 只接受可直接放入 SVG 属性且不包含 URL 或 CSS 表达式的颜色。 */
function isSafeColor(value: string): boolean {
  return /^#[\da-f]{3,8}$/i.test(value)
    || /^(?:rgba?|hsla?)\([\d.,%\s+-]+\)$/i.test(value)
    || /^(?:transparent|currentColor|black|white)$/i.test(value);
}

/** 将未知值收窄为普通记录。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** 从记录的候选键读取首个非空字符串。 */
function readString(
  value: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

/** 读取有限数值。 */
function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 读取正有限数值。 */
function readPositiveNumber(value: unknown): number | undefined {
  const number = readFiniteNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

/** 从 number 或带 px 的 CSS 字符串读取首个有限数值。 */
function readCssNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const match = /^\s*(-?\d+(?:\.\d+)?)/.exec(value);
  if (!match?.[1]) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 将不透明度收窄到 SVG 接受的 0..1。 */
function readOpacity(value: unknown): number | undefined {
  const number = readFiniteNumber(value);
  if (number === undefined) return undefined;
  return Math.min(1, Math.max(0, number));
}

/** 用稳定精度输出 SVG 数值，避免无意义的小数膨胀。 */
function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

/** 转义 SVG 文本和属性中的 XML 元字符。 */
function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
