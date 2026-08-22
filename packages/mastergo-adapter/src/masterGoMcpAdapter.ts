/** 通过官方 MasterGo Magic MCP 读取设计分段并标准化为领域上下文。 */

import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { D2CAgent } from "@ui-forge/d2c-agent";
import { writeMasterGoDesignArtifact } from "./masterGoDesignArtifact.js";
import {
  createMasterGoHighFidelityPreviewResult,
  parseMasterGoExtractedSvgPage,
  type MasterGoExtractedSvg,
  type MasterGoPreviewDiagnostics,
} from "./masterGoHighFidelityPreview.js";
import { StdioMcpClient, type McpClient } from "./stdioMcpClient.js";
import type { MasterGoDesignSource, RawDesignPayload } from "./types.js";

const mcpTextResultSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({
    type: z.string(),
    text: z.string().optional(),
  }).passthrough()),
}).passthrough();

const sectionListSchema = z.object({
  totalSections: z.number().int().nonnegative(),
  sections: z.array(z.record(z.string(), z.unknown())).default([]),
}).passthrough();

const recordSchema = z.record(z.string(), z.unknown());
const MAX_PREVIEW_DATA_URL_LENGTH = 7 * 1024 * 1024;
const MAX_SVG_EXTRACTION_BYTES = 2 * 1024 * 1024;
const MAX_SVG_EXTRACTION_PAGES = 10;

/** 标记已经去除外部载荷和内部细节、可以继续向上传递的稳定错误。 */
class SafeMasterGoMcpError extends Error {}

/** 配置 MasterGo MCP 认证、端点、读取上限及可测试客户端工厂。 */
export interface MasterGoMcpAdapterOptions {
  token?: string;
  baseUrl?: string;
  maxSections?: number;
  clientFactory?: () => McpClient;
  artifactWriter?: D2CAgent.DesignArtifactWriter;
}

/** 表示一次受限 SVG 提取的分页参数。 */
export interface MasterGoSvgExtractionOptions {
  page?: number;
  pageSize?: number;
}

/** 表示经过体积与可执行标记检查的 MasterGo SVG MCP 结果。 */
export interface MasterGoSvgExtraction {
  data: unknown;
  byteSize: number;
}

/** 使用受控 Magic MCP 工具完整读取一个 MasterGo 设计文件或图层。 */
export class MasterGoMcpAdapter implements D2CAgent.DesignSourceAdapter {
  /** 在通用设计来源注册表中选择当前 Adapter 的稳定标识。 */
  readonly id = "mastergo";

  private readonly token: string | undefined;
  private readonly baseUrl: string;
  private readonly maxSections: number;
  private readonly clientFactory: (() => McpClient) | undefined;
  private readonly artifactWriter: D2CAgent.DesignArtifactWriter | undefined;

  /** 创建延迟连接的适配器，真实令牌只在首次读取时传给子进程环境。 */
  constructor(options: MasterGoMcpAdapterOptions = {}) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? "https://mastergo.com";
    this.maxSections = options.maxSections ?? 100;
    this.clientFactory = options.clientFactory;
    this.artifactWriter = options.artifactWriter;
  }

  /** 从 MasterGo MCP 读取目录及全部分段 DSL，并在任一步失败时释放连接。 */
  async load(source: MasterGoDesignSource): Promise<RawDesignPayload> {
    const toolArguments = this.parseReference(source.reference);
    let client: McpClient | undefined;
    try {
      client = this.createClient();
      const sectionListResult = sectionListSchema.safeParse(
        this.parseToolResult(await client.callTool("getDesignSections", {
          ...toolArguments,
          format: "json",
        })),
      );
      if (!sectionListResult.success) {
        throw new SafeMasterGoMcpError("MasterGo MCP 返回的分段目录格式无效。");
      }
      const sectionList = sectionListResult.data;
      if (sectionList.totalSections > this.maxSections) {
        throw new SafeMasterGoMcpError(
          `MasterGo 设计分段数 ${sectionList.totalSections} 超过读取上限 ${this.maxSections}。`,
        );
      }
      const sections: Array<Record<string, unknown>> = [];
      for (let sectionIndex = 0; sectionIndex < sectionList.totalSections; sectionIndex += 1) {
        const sectionResult = recordSchema.safeParse(this.parseToolResult(await client.callTool(
          "getDesignSections",
          { ...toolArguments, sectionIndex, format: "json" },
        )));
        if (!sectionResult.success) {
          throw new SafeMasterGoMcpError(`MasterGo MCP 第 ${sectionIndex} 个分段格式无效。`);
        }
        sections.push(sectionResult.data);
      }
      return { source, sectionList, sections };
    } catch (error: unknown) {
      if (error instanceof SafeMasterGoMcpError) throw error;
      throw new SafeMasterGoMcpError("MasterGo MCP 读取失败。");
    } finally {
      await client?.close().catch(() => undefined);
    }
  }

  /** 从分段目录和 DSL 中提取页面名、节点数、区域及设计 Token。 */
  async normalize(payload: RawDesignPayload): Promise<D2CAgent.DesignContext> {
    const listedSections = Array.isArray(payload.sectionList.sections)
      ? payload.sectionList.sections
      : [];
    const regions = listedSections.flatMap((section, index): D2CAgent.DesignRegion[] => {
      if (!isRecord(section)) return [];
      const id = readString(section, ["id", "nodeId", "layerId"]) ?? `section-${index}`;
      const name = readString(section, ["name", "textPreview"]) ?? id;
      const role = readString(section, ["role", "type"]);
      const x = readFiniteNumber(section.x);
      const y = readFiniteNumber(section.y);
      const width = readPositiveNumber(section.width);
      const height = readPositiveNumber(section.height);
      return [{
        id,
        name,
        ...(role ? { role } : {}),
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
      }];
    });
    const nodeCount = listedSections.reduce((total, section) => {
      if (!isRecord(section)) return total;
      const value = section.nodeCount;
      return total + (typeof value === "number" && Number.isFinite(value) ? value : 0);
    }, 0);
    const name = this.findDesignName(payload) ?? "MasterGo Design";
    const preview = findDesignPreview(payload.sectionList, this.baseUrl);
    const structurePreview = findDesignStructurePreview(payload.sectionList, regions);
    const warnings = regions.length === 0 ? ["MasterGo MCP 未返回可识别的设计区域。"] : [];
    return {
      source: { provider: "mastergo", reference: payload.source.reference },
      name,
      nodeCount,
      tokens: collectTokens([payload.sectionList, ...payload.sections]),
      regions,
      ...(preview ? { preview } : {}),
      ...(structurePreview ? { structurePreview } : {}),
      warnings,
    };
  }

  /** 读取并标准化 MasterGo 设计，同时返回供工作流审计的实现来源信息。 */
  async inspect(reference: string): Promise<D2CAgent.DesignInspection> {
    const payload = await this.load({ kind: "mastergo", reference });
    let context = await this.normalize(payload);
    const operations = ["getDesignSections"];
    try {
      const extractedSvgs = await this.extractAllSvgPages(reference);
      const { preview, diagnostics } = createMasterGoHighFidelityPreviewResult(
        payload,
        extractedSvgs,
      );
      const diagnosticWarnings = createSvgDiagnosticWarnings(diagnostics);
      operations.push("extractSvg");
      context = preview
        ? {
            ...context,
            preview,
            warnings: [...context.warnings, ...diagnosticWarnings],
          }
        : {
            ...context,
            warnings: [
              ...context.warnings,
              ...diagnosticWarnings,
              "MasterGo SVG 数据不足，无法生成可确认的高还原预览。",
            ],
          };
    } catch {
      context = {
        ...context,
        warnings: [...context.warnings, "MasterGo 高还原 SVG 读取失败，当前预览不可直接确认。"],
      };
    }
    const artifact = await writeMasterGoDesignArtifact(this.artifactWriter, payload, context);
    return {
      context,
      provenance: {
        provider: "MasterGo",
        transport: "MCP",
        operations,
      },
      ...(artifact ? { artifact } : {}),
    };
  }

  /** 从已绑定的设计引用提取 SVG，并拒绝超限或含明显可执行标记的载荷。 */
  async extractSvg(
    reference: string,
    options: MasterGoSvgExtractionOptions = {},
  ): Promise<MasterGoSvgExtraction> {
    const toolArguments = this.parseReference(reference);
    const page = options.page ?? 0;
    const pageSize = options.pageSize ?? 20;
    if (!Number.isInteger(page) || page < 0) throw new Error("SVG 页码必须是非负整数。");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new Error("SVG 每页数量必须是 1 到 100 的整数。");
    }
    let client: McpClient | undefined;
    try {
      client = this.createClient();
      const data = this.parseToolResult(await client.callTool("extractSvg", {
        ...toolArguments,
        page,
        pageSize,
        format: "json",
      }));
      const serialized = JSON.stringify(data);
      if (serialized === undefined) throw new SafeMasterGoMcpError("SVG 提取结果不可序列化。");
      const byteSize = Buffer.byteLength(serialized, "utf8");
      if (byteSize > MAX_SVG_EXTRACTION_BYTES) {
        throw new SafeMasterGoMcpError("SVG 提取结果超过 2 MB 单页上限。");
      }
      if (containsExecutableSvgMarkup(data)) {
        throw new SafeMasterGoMcpError("SVG 提取结果包含不允许的可执行标记。");
      }
      return { data, byteSize };
    } catch (error: unknown) {
      if (error instanceof SafeMasterGoMcpError) throw error;
      throw new SafeMasterGoMcpError("MasterGo SVG 提取失败。");
    } finally {
      await client?.close().catch(() => undefined);
    }
  }

  /** 分页读取全部官方 SVG 资源，避免只使用首屏图标导致预览缺失。 */
  private async extractAllSvgPages(reference: string): Promise<MasterGoExtractedSvg[]> {
    const extracted: MasterGoExtractedSvg[] = [];
    for (let page = 0; page < MAX_SVG_EXTRACTION_PAGES; page += 1) {
      const result = await this.extractSvg(reference, { page, pageSize: 100 });
      const parsed = parseMasterGoExtractedSvgPage(result.data);
      extracted.push(...parsed.svgs);
      if (!parsed.hasMore) return extracted;
    }
    throw new SafeMasterGoMcpError(
      `MasterGo SVG 分页超过读取上限 ${MAX_SVG_EXTRACTION_PAGES}。`,
    );
  }

  /** 创建生产客户端或测试注入的 MCP 客户端。 */
  private createClient(): McpClient {
    if (this.clientFactory) return this.clientFactory();
    if (!this.token?.trim()) {
      throw new SafeMasterGoMcpError("缺少 MG_MCP_TOKEN，无法读取 MasterGo 设计文件。");
    }
    const entrypoint = fileURLToPath(import.meta.resolve("@mastergo/magic-mcp"));
    return new StdioMcpClient({
      command: process.execPath,
      args: [entrypoint, "--no-prefix", "--format=json"],
      env: {
        ...process.env,
        MG_MCP_TOKEN: this.token,
        API_BASE_URL: this.baseUrl,
      },
    });
  }

  /** 将 MasterGo 文件链接转换为 MCP 工具的结构化参数。 */
  private parseReference(reference: string): Record<string, string> {
    let url: URL;
    try {
      url = new URL(reference);
    } catch {
      throw new SafeMasterGoMcpError("MasterGo 设计链接不是有效 URL。");
    }
    const allowedOrigin = new URL(this.baseUrl).origin;
    if (url.origin !== allowedOrigin) {
      throw new SafeMasterGoMcpError(`MasterGo 设计链接必须属于 ${allowedOrigin}。`);
    }
    if (url.pathname.startsWith("/goto/")) return { shortLink: url.toString() };
    const fileMatch = /^\/file\/([^/]+)\/?$/.exec(url.pathname);
    const fileId = fileMatch?.[1];
    const sourceLayerId = url.searchParams.get("source_layer_id") ?? undefined;
    const layerId = url.searchParams.get("layer_id")
      ?? url.searchParams.get("node-id")
      ?? url.searchParams.get("node_id")
      ?? url.searchParams.get("page_id")
      ?? undefined;
    if (!fileId || (!layerId && !sourceLayerId)) {
      throw new SafeMasterGoMcpError(
        "MasterGo 文件链接必须包含文件 ID 和 layer_id（或 source_layer_id）。",
      );
    }
    return {
      fileId,
      ...(layerId ? { layerId } : {}),
      ...(sourceLayerId ? { sourceLayerId } : {}),
    };
  }

  /** 校验 MCP 工具结果并解析唯一文本载荷中的 JSON。 */
  private parseToolResult(result: unknown): unknown {
    const resultSchema = mcpTextResultSchema.safeParse(result);
    if (!resultSchema.success) {
      throw new SafeMasterGoMcpError("MasterGo MCP 返回结果格式无效。");
    }
    const parsed = resultSchema.data;
    const text = parsed.content.find((item) => item.type === "text" && item.text)?.text;
    if (parsed.isError) throw new SafeMasterGoMcpError("MasterGo MCP 工具调用失败。");
    if (!text) throw new SafeMasterGoMcpError("MasterGo MCP 未返回文本数据。");
    try {
      return JSON.parse(text);
    } catch {
      throw new SafeMasterGoMcpError("MasterGo MCP 返回了无法解析的 JSON 数据。");
    }
  }

  /** 从已校验载荷的常见元数据字段中选择设计名称。 */
  private findDesignName(payload: RawDesignPayload): string | undefined {
    const candidates = [payload.sectionList.rootMetadata, payload.sectionList];
    for (const candidate of candidates) {
      if (!isRecord(candidate)) continue;
      const name = readString(candidate, ["name", "pageName", "nodeName", "title"]);
      if (name) return name;
    }
    return undefined;
  }
}

/** 将 SVG 覆盖统计转换为不暴露设计内容的安全预览警告。 */
function createSvgDiagnosticWarnings(
  diagnostics: MasterGoPreviewDiagnostics,
): string[] {
  return [
    ...(diagnostics.rejectedAssetCount > 0
      ? [`${diagnostics.rejectedAssetCount} 个 MasterGo SVG 资源未通过安全校验。`]
      : []),
    ...(diagnostics.unmatchedAssetCount > 0
      ? [`${diagnostics.unmatchedAssetCount} 个 MasterGo SVG 资源缺少可靠布局，预览可能缺少图标细节。`]
      : []),
  ];
}

/** 递归检查 SVG 字符串中的脚本、事件处理器和 javascript URL。 */
function containsExecutableSvgMarkup(value: unknown): boolean {
  if (typeof value === "string") {
    return /<\s*(?:script|foreignObject|style)\b|\son[a-z]+\s*=|@import\b|(?:href|src)\s*=\s*["']?\s*(?:javascript:|https?:|\/\/)|url\(\s*["']?\s*(?:https?:|\/\/|data:|javascript:)/i.test(value);
  }
  if (Array.isArray(value)) return value.some(containsExecutableSvgMarkup);
  if (!isRecord(value)) return false;
  return Object.values(value).some(containsExecutableSvgMarkup);
}

/** 从目录坐标构建设计结构轮廓，作为真实截图缺失时的明确降级信息。 */
function findDesignStructurePreview(
  sectionList: Record<string, unknown>,
  regions: D2CAgent.DesignRegion[],
): D2CAgent.DesignStructurePreview | undefined {
  const metadata = isRecord(sectionList.rootMetadata) ? sectionList.rootMetadata : undefined;
  const width = readPositiveNumber(metadata?.width);
  const height = readPositiveNumber(metadata?.height);
  if (!width || !height) return undefined;
  const positionedRegions = regions.filter((region): region is D2CAgent.DesignStructureRegion => (
    region.x !== undefined
    && region.y !== undefined
    && region.width !== undefined
    && region.height !== undefined
  ));
  if (positionedRegions.length === 0) return undefined;
  const rootContainer = isRecord(sectionList.rootContainer) ? sectionList.rootContainer : undefined;
  const background = sanitizePreviewColor(rootContainer?.background);
  return {
    width,
    height,
    ...(background ? { background } : {}),
    regions: positionedRegions,
  };
}

/** 从分段目录的受信元数据位置提取预览，避免误用 DSL 内的普通图片资产。 */
function findDesignPreview(
  sectionList: Record<string, unknown>,
  baseUrl: string,
): D2CAgent.DesignPreview | undefined {
  const candidates = [sectionList, sectionList.rootMetadata];
  const directKeys = [
    "previewImageUrl",
    "previewUrl",
    "thumbnailUrl",
    "coverUrl",
    "previewImage",
    "preview",
    "thumbnail",
    "cover",
  ];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    for (const key of directKeys) {
      const preview = parseDesignPreview(candidate[key], baseUrl);
      if (preview) return preview;
    }
  }
  return undefined;
}

/** 校验预览 URL 与可选尺寸，只接受 HTTP(S) 或安全的图片 data URL。 */
function parseDesignPreview(value: unknown, baseUrl: string): D2CAgent.DesignPreview | undefined {
  const source = typeof value === "string"
    ? value
    : isRecord(value)
      ? readString(value, ["url", "src", "imageUrl", "previewUrl", "thumbnailUrl"])
      : undefined;
  if (!source) return undefined;
  const url = normalizePreviewUrl(source, baseUrl);
  if (!url) return undefined;
  if (!isRecord(value)) return { url };
  const width = readPositiveNumber(value.width);
  const height = readPositiveNumber(value.height);
  return {
    url,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  };
}

/** 将相对预览地址解析到 MasterGo 服务，并拒绝可执行或未知协议。 */
function normalizePreviewUrl(value: string, baseUrl: string): string | undefined {
  if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(value)) {
    return value.length <= MAX_PREVIEW_DATA_URL_LENGTH ? value : undefined;
  }
  try {
    const allowedOrigin = new URL(baseUrl).origin;
    const url = new URL(value, baseUrl);
    return url.origin === allowedOrigin && (url.protocol === "https:" || url.protocol === "http:")
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/** 读取有限且为正数的图片尺寸。 */
function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 读取有限数值；坐标允许为零或负数。 */
function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 仅保留不会触发外部资源加载的十六进制画布颜色。 */
function sanitizePreviewColor(value: unknown): string | undefined {
  return typeof value === "string" && /^#[\da-f]{3,8}$/i.test(value) ? value : undefined;
}

/** 判断未知输入是否为可安全遍历的普通记录。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 按顺序读取记录中的首个非空字符串字段。 */
function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

/** 递归提取 `_token`/`_color` 和全局变量，避免保留无关编辑器元数据。 */
function collectTokens(values: unknown[]): Record<string, string | number> {
  const tokens = new Map<string, string | number>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    if (isRecord(value.globalVars)) {
      for (const [key, tokenValue] of Object.entries(value.globalVars)) {
        if (typeof tokenValue === "string" || typeof tokenValue === "number") tokens.set(key, tokenValue);
      }
    }
    const tokenName = typeof value._token === "string" ? value._token : undefined;
    const tokenValue = typeof value._color === "string" || typeof value._color === "number"
      ? value._color
      : undefined;
    if (tokenName && tokenValue !== undefined) tokens.set(tokenName, tokenValue);
    Object.values(value).forEach(visit);
  };
  values.forEach(visit);
  return Object.fromEntries(tokens);
}
