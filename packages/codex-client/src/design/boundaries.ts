/** 校验固定设计目标、本机端点与上游 JSON 数据，避免转发工具附带指令。 */
import { z } from "zod";

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[\w:.-]+$/);
const jsonSchema = z.json();
/** 经过连接检查确认的单文件、单页面、单节点目标。 */
export const vibeTargetSchema = z.strictObject({
  documentId: identifier,
  pageId: identifier,
  nodeId: z.string().regex(/^\d+:\d+$/),
});
/** 原生画布必须保持一致的目标身份。 */
export type VibeTarget = z.infer<typeof vibeTargetSchema>;
/** 用户显式配置的本机 MCP 和状态端点。 */
export interface VibeConnection {
  /** Streamable HTTP MCP 地址。 */
  endpoint: string;
  /** 原生画布状态读取地址。 */
  statusEndpoint: string;
}

/** 仅允许无凭据、无查询参数的本机 HTTP 地址；localhost 固定为回环 IP。 */
export function loopbackUrl(value: string): URL {
  let url: URL;
  const message = "Vibe 地址须为无凭据、无查询参数的本机 HTTP 地址。";
  try {
    url = new URL(value);
  } catch {
    throw new Error(message);
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(message);
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url;
}

/** 从官方 MasterGo 链接读取明确的文件与图层身份，不访问设计内容。 */
export function parseMasterGoTarget(
  value: string,
): Omit<VibeTarget, "pageId"> & { pageId?: string } {
  let url: URL;
  const linkMessage = "请输入完整的 MasterGo HTTPS 文件或图层链接。";
  try {
    url = new URL(value);
  } catch {
    throw new Error(linkMessage);
  }
  if (
    url.protocol !== "https:" ||
    !["mastergo.com", "www.mastergo.com"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error(linkMessage);
  const filePath = /^\/file\/([^/]+)/.exec(url.pathname)?.[1];
  const documentId = identifier.safeParse(url.searchParams.get("file") ?? filePath);
  if (!documentId.success)
    throw new Error("设计链接缺少有效的文件标识，请从 MasterGo 重新复制完整图层链接。");
  const layer = url.searchParams.get("layer_id");
  if (!layer)
    throw new Error("Vibe 需要包含 layer_id 的图层链接，请在 MasterGo 中选中目标图层后复制链接。");
  const nodeId = vibeTargetSchema.shape.nodeId.safeParse(layer);
  if (!nodeId.success)
    throw new Error("设计链接中的 layer_id 格式无效，应形如 2:3，请重新复制目标图层链接。");
  const page = url.searchParams.get("page_id");
  const pageId = page ? identifier.safeParse(page) : undefined;
  if (pageId && !pageId.success)
    throw new Error("设计链接中的 page_id 格式无效，请重新复制目标页面的图层链接。");
  return {
    documentId: documentId.data,
    nodeId: nodeId.data,
    ...(pageId?.success ? { pageId: pageId.data } : {}),
  };
}

/** 构造完整固定目标，避免上游按当前选区隐式选择节点。 */
export function masterGoTargetUrl(target: VibeTarget): string {
  const parsed = vibeTargetSchema.parse(target);
  const url = new URL("https://mastergo.com/goto");
  url.search = new URLSearchParams({
    file: parsed.documentId,
    page_id: parsed.pageId,
    layer_id: parsed.nodeId,
  }).toString();
  return url.href;
}

/** 状态响应只保留画布身份；token、标题等未知字段不会进入结果。 */
export function parseVibeStatus(value: unknown): Pick<VibeTarget, "documentId" | "pageId"> {
  const status = z
    .object({
      documentId: identifier,
      pageId: identifier.optional(),
      documentPageId: identifier.optional(),
    })
    .parse(value);
  if (status.pageId && status.documentPageId && status.pageId !== status.documentPageId)
    throw new Error("Vibe status has conflicting page identifiers");
  const pageId = status.documentPageId ?? status.pageId;
  if (!pageId) throw new Error("Vibe status does not identify the active page");
  return { documentId: status.documentId, pageId };
}

/** 从成功工具响应中提取原始 JsonDom；丢弃保存提示、Markdown 标题和其他内容。 */
export function extractVibeDesignData(value: unknown): z.infer<typeof jsonSchema>[] {
  const result = z
    .object({
      isError: z.boolean().optional(),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
    })
    .parse(value);
  if (result.isError) throw new Error("Vibe design read failed");
  const texts = result.content
    .filter((entry) => entry.type === "text")
    .map((entry) => entry.text ?? "");
  if (!texts.some((text) => text.includes("已获取 JsonDom 图层数据，未写入本地文件。")))
    throw new Error("Vibe did not return a read-only JsonDom result");
  const blocks: z.infer<typeof jsonSchema>[] = [];
  for (const text of texts) {
    if (text.length > 16 * 1024 * 1024) throw new Error("Vibe design response is too large");
    for (const match of text.matchAll(/^```json\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm)) {
      const parsed: unknown = JSON.parse(match[1]!);
      if (!parsed || typeof parsed !== "object")
        throw new Error("Vibe design JSON must be structured data");
      blocks.push(z.json().parse(parsed));
    }
  }
  if (blocks.length !== 1) throw new Error("Vibe must return exactly one bound design node");
  return blocks;
}
