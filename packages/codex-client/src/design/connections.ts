/** 使用标准 MCP SDK 检查设计连接，仅返回白名单元数据，不读取设计或执行模型。 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import {
  loopbackUrl,
  parseVibeStatus,
  type VibeConnection,
  type VibeTarget,
} from "./boundaries.js";

const timeout = 15_000;
/** 原始设计读取的传输与工具请求共用截止时间，握手和检查仍使用较短超时。 */
export const vibeReadTimeoutMs = 120_000;
const requestOptions = { timeout };
const safeLabel = (value: string | undefined) =>
  value?.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 128) ?? "unknown";
/** 只读 MCP 握手返回的工具和版本信息。 */
export interface DesignConnectionInfo {
  /** 已握手的服务名称。 */
  serverName: string;
  /** 上游声明的服务版本，不代表兼容性保证。 */
  serverVersion: string;
  /** 服务声明的工具名，不包含工具描述或参数。 */
  tools: string[];
}

/** 为固定本机端点提供无重定向、无凭据的 fetch，默认使用连接检查的超时。 */
export function fixedLoopbackFetch(endpoint: string, timeoutMs = timeout): typeof fetch {
  const allowed = loopbackUrl(endpoint).href;
  return async (input, init) => {
    const requested =
      typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    if (loopbackUrl(requested).href !== allowed) throw new Error("Unexpected Vibe endpoint");
    const headers = new Headers(init?.headers);
    if (headers.has("authorization") || headers.has("cookie"))
      throw new Error("Vibe credentials are not supported");
    return fetch(allowed, {
      ...init,
      headers,
      redirect: "error",
      credentials: "omit",
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
  };
}

/** 读取当前画布身份；响应中的其他字段立即丢弃，错误不携带响应正文。 */
export async function readVibeStatus(
  connection: VibeConnection,
): Promise<Pick<VibeTarget, "documentId" | "pageId">> {
  try {
    const response = await fixedLoopbackFetch(connection.statusEndpoint)(connection.statusEndpoint);
    if (!response.ok) throw new Error("status request failed");
    const text = await response.text();
    if (text.length > 64 * 1024) throw new Error("status response too large");
    return parseVibeStatus(JSON.parse(text));
  } catch {
    throw new Error(
      "无法读取 Vibe 当前文件和页面，请在客户端打开目标画布，并检查画布状态地址（不是 MCP 地址）。",
    );
  }
}

/** 建立固定本机 MCP 连接；失败时释放 SDK transport，不传递上游错误正文。 */
export async function connectVibe(connection: VibeConnection): Promise<Client> {
  const client = new Client({ name: "ui-forge-design-reader", version: "1.0.0" });
  const endpoint = loopbackUrl(connection.endpoint);
  const transport = new StreamableHTTPClientTransport(endpoint, {
    fetch: fixedLoopbackFetch(endpoint.href, vibeReadTimeoutMs),
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1,
    },
  });
  try {
    // SDK transport declarations do not yet support exactOptionalPropertyTypes.
    await client.connect(transport as Transport, requestOptions);
    return client;
  } catch {
    await transport.close().catch(() => {});
    throw new Error(
      "无法连接 Vibe MCP，请确认 MCP 服务已启动，并检查 MCP 地址（不是画布状态地址）。",
    );
  }
}

/** 检查原生画布身份和 JSON 读取工具；不读取节点、不安装或启动软件。 */
export async function checkVibeConnection(
  connection: VibeConnection,
): Promise<DesignConnectionInfo & Pick<VibeTarget, "documentId" | "pageId">> {
  loopbackUrl(connection.statusEndpoint);
  const status = await readVibeStatus(connection);
  const client = await connectVibe(connection);
  try {
    const result = await client.listTools({}, requestOptions).catch(() => {
      throw new Error("无法获取 Vibe MCP 工具清单，请检查服务连接后重试。");
    });
    const tool = result.tools.find((entry) => entry.name === "get_frontend_code");
    const properties = tool?.inputSchema.properties;
    if (
      !tool ||
      !properties ||
      !["frontendFramework", "writeToFile", "targetNodeId", "projectDir"].every(
        (key) => key in properties,
      )
    )
      throw new Error("Vibe MCP 未提供所需的 JSON 读取工具，请检查 Vibe 服务版本及工具配置。");
    const after = await readVibeStatus(connection);
    if (status.documentId !== after.documentId || status.pageId !== after.pageId)
      throw new Error("连接检查期间 Vibe 画布发生变化，请保持目标文件和页面打开后重试。");
    const info = client.getServerVersion();
    return {
      ...status,
      serverName: safeLabel(info?.name),
      serverVersion: safeLabel(info?.version),
      tools: result.tools.map((entry) => safeLabel(entry.name)),
    };
  } finally {
    await client.close().catch(() => {});
  }
}

/** 使用现有凭据 helper 检查官方 Magic SSE 服务，凭据与响应正文不进入返回值。 */
export async function checkMagicConnection(): Promise<DesignConnectionInfo> {
  const client = new Client({ name: "ui-forge-design-check", version: "1.0.0" });
  let transport: SSEClientTransport | undefined;
  try {
    const script = fileURLToPath(new URL("../../scripts/mastergo-headers.mjs", import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, [script], {
      timeout,
      maxBuffer: 16 * 1024,
    });
    const headers = z.record(z.string(), z.string()).parse(JSON.parse(stdout));
    const safeFetch: typeof fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input.toString() : input.url,
      );
      if (
        url.origin !== "https://mastergo.com" ||
        !url.pathname.startsWith("/mcp/") ||
        url.username ||
        url.password
      )
        throw new Error("Unexpected Magic endpoint");
      return fetch(url, {
        ...init,
        headers: { ...headers, ...Object.fromEntries(new Headers(init?.headers)) },
        redirect: "error",
        credentials: "omit",
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)])
          : AbortSignal.timeout(timeout),
      });
    };
    transport = new SSEClientTransport(new URL("https://mastergo.com/mcp/xf/sse"), {
      fetch: safeFetch,
      eventSourceInit: { fetch: safeFetch },
      requestInit: { headers },
    });
    await client.connect(transport, requestOptions);
    const result = await client.listTools({}, requestOptions);
    const info = client.getServerVersion();
    return {
      serverName: safeLabel(info?.name),
      serverVersion: safeLabel(info?.version),
      tools: result.tools.map((entry) => safeLabel(entry.name)),
    };
  } catch {
    throw new Error("Magic MCP 连接检查失败，请检查 MG_MCP_TOKEN、网络连接及账号的 MCP 服务权益。");
  } finally {
    await client.close().catch(() => {});
    await transport?.close().catch(() => {});
  }
}
