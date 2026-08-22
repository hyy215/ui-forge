/** 通过官方 Ant Design CLI 的 stdio MCP Server 提供版本化组件知识。 */

import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { DesignSystemComponentCatalogEntry } from "./index.js";

type KnowledgeSection = "info" | "semantic" | "token" | "demo";

interface KnowledgeDataLimits {
  maximumBytes: number;
  maximumDepth: number;
  maximumEntries: number;
  maximumStringLength: number;
}

const maximumMcpPayloadBytes = 512 * 1024;
const maximumOfficialComponents = 500;
const knowledgeDataLimits: Record<KnowledgeSection, KnowledgeDataLimits> = {
  info: { maximumBytes: 64 * 1024, maximumDepth: 6, maximumEntries: 500, maximumStringLength: 8_192 },
  semantic: { maximumBytes: 48 * 1024, maximumDepth: 6, maximumEntries: 400, maximumStringLength: 6_144 },
  token: { maximumBytes: 48 * 1024, maximumDepth: 5, maximumEntries: 600, maximumStringLength: 4_096 },
  demo: { maximumBytes: 96 * 1024, maximumDepth: 6, maximumEntries: 500, maximumStringLength: 12_288 },
};

interface ProjectInspectionInput {
  kind: "empty" | "react_antd";
  projectRoot: string;
  antdVersion?: string;
}

interface ComponentCatalogInput {
  components: DesignSystemComponentCatalogEntry[];
}

/** 抽象单个 Ant Design MCP 连接，允许 Adapter 测试替换进程传输。 */
export interface AntDesignMcpConnection {
  /** 调用一个已由上层白名单约束的官方工具。 */
  callTool(name: string, argumentsValue: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  /** 关闭 MCP Client 及其子进程。 */
  close(): Promise<void>;
}

/** 配置 Ant Design MCP Adapter 的可替换连接工厂。 */
export interface AntDesignMcpKnowledgeProviderOptions {
  /** 测试或宿主用于替换默认 stdio 子进程创建逻辑。 */
  createConnection?: (projectRoot: string) => Promise<AntDesignMcpConnection>;
}

/** 使用本地官方 CLI，并按目标项目目录复用只读 MCP 连接。 */
export class AntDesignMcpKnowledgeProvider {
  private readonly connections = new Map<string, Promise<AntDesignMcpConnection>>();
  private readonly createConnection: (projectRoot: string) => Promise<AntDesignMcpConnection>;

  /** 保存可替换的连接工厂；生产默认启动本地安装的官方 CLI。 */
  constructor(options: AntDesignMcpKnowledgeProviderOptions = {}) {
    this.createConnection = options.createConnection ?? createOfficialMcpConnection;
  }

  /** 使用 antd_list 扩充人工目录；连接失败时显式回退而不伪装成功。 */
  async resolveCatalog(input: {
    inspection: ProjectInspectionInput;
    baseCatalog: ComponentCatalogInput;
    signal?: AbortSignal;
  }): Promise<{ catalog: ComponentCatalogInput; warnings: string[] }> {
    try {
      const components = parseComponentList(await this.callTool(
        input.inspection.projectRoot,
        "antd_list",
        {},
        input.signal,
      ));
      return {
        catalog: {
          components: mergeCatalogEntries(input.baseCatalog.components, components),
        },
        warnings: [],
      };
    } catch (error: unknown) {
      if (isAbortError(error) || input.signal?.aborted) throw error;
      return {
        catalog: structuredClone(input.baseCatalog),
        warnings: [`Ant Design MCP 目录查询失败，已回退静态目录：${errorMessage(error)}`],
      };
    }
  }

  /** 按规划 Agent 请求调用白名单内的官方只读组件工具。 */
  async queryComponent(input: {
    inspection: ProjectInspectionInput;
    componentName: string;
    sections: readonly KnowledgeSection[];
    signal?: AbortSignal;
  }): Promise<Array<{ toolName: string; componentName: string; data: unknown }>> {
    const uniqueSections = [...new Set(input.sections)];
    return Promise.all(uniqueSections.map(async (section) => {
      const toolName = toolNameForSection(section);
      const rawData = await this.callTool(input.inspection.projectRoot, toolName, {
        component: rootComponentName(input.componentName),
        ...(section === "info" ? { detail: true } : {}),
      }, input.signal);
      const data = sanitizeKnowledgeData(section, rawData);
      return { toolName, componentName: input.componentName, data };
    }));
  }

  /** 关闭所有由 Adapter 启动的 MCP 子进程。 */
  async dispose(): Promise<void> {
    const connections = [...this.connections.values()];
    this.connections.clear();
    await Promise.allSettled(connections.map(async (connection) => (await connection).close()));
  }

  /** 获取任务目录绑定的连接并调用一个固定名称的 MCP 工具。 */
  private async callTool(
    projectRoot: string,
    name: string,
    argumentsValue: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (signal?.aborted) throw new DOMException("Ant Design MCP 查询已取消。", "AbortError");
    const connection = await this.getConnection(projectRoot);
    return signal
      ? connection.callTool(name, argumentsValue, signal)
      : connection.callTool(name, argumentsValue);
  }

  /** 延迟创建连接，并在启动失败时清除缓存以允许后续重试。 */
  private async getConnection(projectRoot: string): Promise<AntDesignMcpConnection> {
    let pending = this.connections.get(projectRoot);
    if (!pending) {
      pending = this.createConnection(projectRoot);
      this.connections.set(projectRoot, pending);
    }
    try {
      return await pending;
    } catch (error: unknown) {
      if (this.connections.get(projectRoot) === pending) this.connections.delete(projectRoot);
      throw error;
    }
  }
}

/** 启动当前依赖树中的 CLI 入口，避免运行期 npx 下载或 Shell 解释。 */
async function createOfficialMcpConnection(projectRoot: string): Promise<AntDesignMcpConnection> {
  const require = createRequire(import.meta.url);
  const cliEntry = require.resolve("@ant-design/cli");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliEntry, "mcp", "--lang", "zh"],
    cwd: projectRoot,
    env: {
      ...getDefaultEnvironment(),
      CI: "1",
      NO_UPDATE_CHECK: "1",
      ANTD_NO_AUTO_REPORT: "1",
    },
    stderr: "pipe",
    maxBufferSize: 50 * 1024 * 1024,
  });
  const client = new Client({ name: "ui-forge", version: "0.1.0" });
  let stderr = "";
  transport.stderr?.on("data", (chunk: unknown) => {
    if (stderr.length < 8_192) stderr += String(chunk).slice(0, 8_192 - stderr.length);
  });
  try {
    await client.connect(transport);
  } catch (error: unknown) {
    await transport.close().catch(() => undefined);
    const detail = stderr.trim();
    throw new Error(`无法启动 Ant Design MCP：${detail || errorMessage(error)}`);
  }
  return {
    async callTool(name, argumentsValue, signal) {
      const result = await client.callTool(
        { name, arguments: argumentsValue },
        undefined,
        signal ? { signal } : undefined,
      );
      if (result.isError) throw new Error(readMcpError(result.content));
      return parseMcpContent(result.content);
    },
    async close() {
      await client.close();
    },
  };
}

/** 将官方列表校验为生成目录所需的最小结构。 */
function parseComponentList(value: unknown): Array<{ name: string; nameZh?: string }> {
  if (!Array.isArray(value)) throw new Error("antd_list 未返回组件数组。");
  if (value.length > maximumOfficialComponents) {
    throw new Error(`antd_list 返回组件数超过 ${maximumOfficialComponents} 项上限。`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || !entry.name.trim()) {
      throw new Error(`antd_list 第 ${index + 1} 项缺少组件名称。`);
    }
    if (entry.name.length > 100 || (typeof entry.nameZh === "string" && entry.nameZh.length > 100)) {
      throw new Error(`antd_list 第 ${index + 1} 项组件名称超过长度上限。`);
    }
    return {
      name: entry.name.trim(),
      ...(typeof entry.nameZh === "string" && entry.nameZh.trim()
        ? { nameZh: entry.nameZh.trim() }
        : {}),
    };
  });
}

/** 以人工条目为优先级合并官方组件，既保留业务别名又扩充完整清单。 */
function mergeCatalogEntries(
  baseEntries: readonly DesignSystemComponentCatalogEntry[],
  officialComponents: readonly { name: string; nameZh?: string }[],
): DesignSystemComponentCatalogEntry[] {
  const merged = new Map(baseEntries.map((entry) => [entry.id, structuredClone(entry)]));
  for (const component of officialComponents) {
    const id = toComponentId(component.name);
    const current = merged.get(id);
    const aliases = [component.name, ...(component.nameZh ? [component.nameZh] : [])];
    if (current) {
      current.aliases = [...new Set([...current.aliases, ...aliases])];
      continue;
    }
    merged.set(id, {
      id,
      name: component.name,
      aliases,
      implementation: { packageName: "antd", exportName: component.name },
    });
  }
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** 把 PascalCase 官方组件名转换为开放目录使用的短横线 ID。 */
function toComponentId(name: string): string {
  const id = name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`无法为官方组件生成安全目录 ID：${name}`);
  }
  return id;
}

/** 将目录中的子组件导出名归一到官方 MCP 接受的根组件名。 */
function rootComponentName(name: string): string {
  return name.split(".")[0] ?? name;
}

/** 将受限知识类别映射为官方 MCP 工具名。 */
function toolNameForSection(section: KnowledgeSection): string {
  switch (section) {
    case "info": return "antd_info";
    case "semantic": return "antd_semantic";
    case "token": return "antd_token";
    case "demo": return "antd_demo";
  }
}

/** 从 MCP content blocks 中读取并解析官方 JSON 结果。 */
function parseMcpContent(content: unknown): unknown {
  if (!Array.isArray(content)) throw new Error("Ant Design MCP 返回了无效 content。");
  const text = content
    .filter((block): block is { type: "text"; text: string } =>
      isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
  if (!text) throw new Error("Ant Design MCP 未返回文本结果。");
  if (new TextEncoder().encode(text).byteLength > maximumMcpPayloadBytes) {
    throw new Error(`Ant Design MCP 文本结果超过 ${maximumMcpPayloadBytes} 字节上限。`);
  }
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    throw new Error(`Ant Design MCP 未返回合法 JSON：${errorMessage(error)}`);
  }
}

/** 将各知识类别的未知 MCP 数据校验、裁剪为有界 JSON 值。 */
function sanitizeKnowledgeData(section: KnowledgeSection, value: unknown): unknown {
  const limits = knowledgeDataLimits[section];
  const state = { entries: 0, truncated: false };
  const sanitized = sanitizeJsonValue(value, limits, state, 0);
  const serialized = JSON.stringify(sanitized);
  if (new TextEncoder().encode(serialized).byteLength <= limits.maximumBytes) {
    return state.truncated ? markTruncated(sanitized) : sanitized;
  }
  return {
    __uiForgeTruncated: true,
    preview: serialized.slice(0, Math.floor(limits.maximumBytes / 4)),
  };
}

/** 递归拒绝非 JSON 类型，并限制字段长度、集合规模、节点总量和嵌套深度。 */
function sanitizeJsonValue(
  value: unknown,
  limits: KnowledgeDataLimits,
  state: { entries: number; truncated: boolean },
  depth: number,
): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Ant Design MCP 知识包含非有限数字。");
    return value;
  }
  if (typeof value === "string") {
    if (value.length <= limits.maximumStringLength) return value;
    state.truncated = true;
    return value.slice(0, limits.maximumStringLength);
  }
  if (depth >= limits.maximumDepth) {
    state.truncated = true;
    return "[已裁剪：嵌套层级超限]";
  }
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const entry of value) {
      if (state.entries >= limits.maximumEntries) {
        state.truncated = true;
        break;
      }
      state.entries += 1;
      result.push(sanitizeJsonValue(entry, limits, state, depth + 1));
    }
    return result;
  }
  if (!isRecord(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error("Ant Design MCP 知识包含非 JSON 数据类型。");
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (state.entries >= limits.maximumEntries) {
      state.truncated = true;
      break;
    }
    state.entries += 1;
    const safeKey = key.slice(0, 200);
    if (safeKey !== key) state.truncated = true;
    result[safeKey] = sanitizeJsonValue(entry, limits, state, depth + 1);
  }
  return result;
}

/** 在不改变对象主体可读性的前提下标记已发生裁剪。 */
function markTruncated(value: unknown): unknown {
  return isRecord(value)
    ? { ...value, __uiForgeTruncated: true }
    : { value, __uiForgeTruncated: true };
}

/** 尽量读取 MCP 错误正文，避免向上泄露 SDK 内部对象。 */
function readMcpError(content: unknown): string {
  try {
    const value = parseMcpContent(content);
    if (isRecord(value) && typeof value.message === "string") return value.message;
    return JSON.stringify(value);
  } catch (error: unknown) {
    return errorMessage(error);
  }
}

/** 判断未知值是否为可安全读取的普通记录。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 将未知异常收窄为可展示消息。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 判断上游调用是否由用户主动取消。 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
