/** 在 Agent Server D2C 组合边界装配确定性 D2C Service 与外部 Adapter。 */

import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { D2CAgent, parseComponentCatalog } from "@ui-forge/d2c-agent";
import {
  AntDesignMcpKnowledgeProvider,
  antDesignComponentCatalog,
} from "@ui-forge/design-system-adapter";
import { FileDesignArtifactStore } from "@ui-forge/d2c-storage";
import {
  FileSystemProjectContextAnalyzer,
  FileSystemProjectInspector,
} from "@ui-forge/component-indexer";
import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import {
  MasterGoFixtureAdapter,
  MasterGoMcpAdapter,
} from "@ui-forge/mastergo-adapter";
import { WorkspaceIdentityResolver } from "../logging/workspaceIdentityResolver.js";
import { ArtifactCleanupWorker } from "./artifactCleanupWorker.js";
import { D2CWorkflowService } from "./d2cWorkflowService.js";
import { SharpDesignVisualEvidenceProvider } from "./sharpDesignVisualEvidenceProvider.js";
import type { ModelInvocationLog } from "../logging/workspaceRequestLogger.js";

const masterGoFixturePath = fileURLToPath(new URL(
  "../../../../fixtures/design-cases/mastergo-table-filter.json",
  import.meta.url,
));

/** 生产 D2C Service 组合入口允许注入的安全模型诊断端口。 */
export interface D2CWorkflowServiceEnvironmentOptions {
  modelDiagnosticReporter?: (event: ModelInvocationLog) => void | Promise<void>;
}

/** 使用进程环境创建生产 D2C Workflow Service 及其全部运行时依赖。 */
export function createD2CWorkflowServiceFromEnvironment(
  options: D2CWorkflowServiceEnvironmentOptions = {},
): D2CWorkflowService {
  const token = process.env.MG_MCP_TOKEN ?? process.env.MASTERGO_API_TOKEN;
  const baseUrl = process.env.MASTERGO_BASE_URL;
  const designProvider = process.env.UI_FORGE_DESIGN_PROVIDER ?? "mastergo";
  const designArtifactStore = new FileDesignArtifactStore(
    process.env.UI_FORGE_ARTIFACT_DIR
      ?? fileURLToPath(new URL("../../../../.ui-forge/artifacts", import.meta.url)),
  );
  const artifactCleanupWorker = new ArtifactCleanupWorker({
    store: designArtifactStore,
    retentionMs: readArtifactRetentionMs(),
  });
  const checkpointResource = createCheckpointResource(
    process.env.DATABASE_URL,
    process.env.UI_FORGE_CHECKPOINT_SCHEMA,
  );
  const workspaceIdentityResolver = new WorkspaceIdentityResolver();
  const projectInspector = new FileSystemProjectInspector();
  const designSystemKnowledgeProvider = new AntDesignMcpKnowledgeProvider();
  const designAdapter = createDesignAdapter(
    designProvider,
    { token, baseUrl },
    designArtifactStore,
  );
  const service = D2CAgent.createService({
    designSourceAdapters: [designAdapter],
    projectInspector,
    projectContextAnalyzer: new FileSystemProjectContextAnalyzer(),
    componentCatalog: readComponentCatalogFromEnvironment(),
    designSystemKnowledgeProvider,
    modelOptions: readSecondStepModelOptions(options.modelDiagnosticReporter),
    visualEvidenceProvider: new SharpDesignVisualEvidenceProvider(designArtifactStore),
    designArtifactReader: designArtifactStore,
    designArtifactLifecycle: designArtifactStore,
    checkpointer: checkpointResource.checkpointer,
  });
  return new D2CWorkflowService({
    designProvider,
    designArtifactReader: designArtifactStore,
    resolveWorkspaceId: async (projectPath) => {
      const identity = await workspaceIdentityResolver.resolve(projectPath);
      return `${identity.type}:${identity.directoryName}`;
    },
    initialize: async () => {
      await checkpointResource.initialize();
      await artifactCleanupWorker.start();
    },
    dispose: async () => {
      artifactCleanupWorker.stop();
      await designSystemKnowledgeProvider.dispose();
      await checkpointResource.dispose();
    },
    service,
  });
}

/** 从受控启动配置读取组件目录；未配置时使用内置 Ant Design 目录。 */
export function readComponentCatalogFromEnvironment(): D2CAgent.ComponentCatalog {
  const configuredPath = process.env.UI_FORGE_COMPONENT_CATALOG_PATH?.trim();
  if (!configuredPath) return parseComponentCatalog(antDesignComponentCatalog);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configuredPath, "utf8"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法读取 UI_FORGE_COMPONENT_CATALOG_PATH：${message}`);
  }
  return parseComponentCatalog(parsed);
}

/** 从标准模型环境变量读取第二步 DeepAgent 配置，并保留缺失项的延迟报错。 */
function readSecondStepModelOptions(
  diagnosticReporter?: (event: ModelInvocationLog) => void | Promise<void>,
): D2CAgent.PlanDeepAgentModelOptions {
  const provider = process.env.MODEL_PROVIDER?.trim();
  const model = process.env.MODEL_NAME?.trim();
  const apiKey = process.env.MODEL_API_KEY?.trim();
  const baseUrl = process.env.MODEL_BASE_URL?.trim();
  const structuredOutputMode = readStructuredOutputMode();
  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    structuredOutputMode,
    ...(diagnosticReporter ? { diagnosticReporter } : {}),
  };
}

/** 读取结构化输出协议；默认使用不依赖强制 tool_choice 的 JSON 文本模式。 */
function readStructuredOutputMode(): "json-text" | "tool" {
  const configured = process.env.MODEL_STRUCTURED_OUTPUT_MODE?.trim();
  if (!configured || configured === "json-text") return "json-text";
  if (configured === "tool") return "tool";
  throw new Error("MODEL_STRUCTURED_OUTPUT_MODE 必须是 json-text 或 tool。");
}

/** 将已废弃 Artifact 的保留小时数转换为毫秒，并拒绝无效环境输入。 */
function readArtifactRetentionMs(): number {
  const configured = process.env.UI_FORGE_ARTIFACT_PENDING_RETENTION_HOURS?.trim();
  if (!configured) return 24 * 60 * 60_000;
  const hours = Number(configured);
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error("UI_FORGE_ARTIFACT_PENDING_RETENTION_HOURS 必须是非负数值。");
  }
  return hours * 60 * 60_000;
}

interface CheckpointResource {
  checkpointer: BaseCheckpointSaver;
  initialize: () => Promise<void>;
  dispose: () => Promise<void>;
}

/** 根据环境配置创建共享 PostgreSQL Saver；测试和无数据库联调回退到进程内 Saver。 */
function createCheckpointResource(
  databaseUrl: string | undefined,
  schema: string | undefined,
): CheckpointResource {
  if (!databaseUrl?.trim()) {
    return {
      checkpointer: new MemorySaver(),
      initialize: async () => undefined,
      dispose: async () => undefined,
    };
  }
  const checkpointer = PostgresSaver.fromConnString(
    databaseUrl,
    schema?.trim() ? { schema: schema.trim() } : undefined,
  );
  return {
    checkpointer,
    initialize: async () => checkpointer.setup(),
    dispose: async () => checkpointer.end(),
  };
}

/** 根据受控环境配置选择实时 MasterGo 或仓库内固定测试来源。 */
function createDesignAdapter(
  designProvider: string,
  masterGoOptions: { token: string | undefined; baseUrl: string | undefined },
  artifactWriter: D2CAgent.DesignArtifactWriter,
): D2CAgent.DesignSourceAdapter {
  switch (designProvider) {
    case "mastergo":
      return new MasterGoMcpAdapter({
        artifactWriter,
        ...(masterGoOptions.token ? { token: masterGoOptions.token } : {}),
        ...(masterGoOptions.baseUrl ? { baseUrl: masterGoOptions.baseUrl } : {}),
      });
    case "mastergo-fixture":
      return new MasterGoFixtureAdapter({
        artifactWriter,
        fixtures: { "table-filter": masterGoFixturePath },
        defaultFixture: masterGoFixturePath,
      });
    default:
      throw new Error(`不支持的 UI_FORGE_DESIGN_PROVIDER：${designProvider}`);
  }
}
