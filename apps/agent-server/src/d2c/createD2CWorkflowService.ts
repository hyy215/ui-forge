/** 在 Agent Server 组合边界装配 D2C Service、外部读取 Adapter 与受控写入器。 */

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { D2CAgent, parseComponentCatalog } from "@ui-forge/d2c-agent";
import {
  AntDesignMcpKnowledgeProvider,
  antDesignComponentCatalog,
} from "@ui-forge/design-system-adapter";
import { FileDeliveryEvidenceStore, FileDesignArtifactStore } from "@ui-forge/d2c-storage";
import {
  FileSystemProjectContextAnalyzer,
  FileSystemProjectCodeContextReader,
  FileSystemProjectInspector,
} from "@ui-forge/component-indexer";
import {
  FileSystemProjectDeliveryValidator,
  FileSystemProjectPatchApplier,
} from "@ui-forge/tools";
import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import {
  MasterGoFixtureAdapter,
  MasterGoMcpAdapter,
} from "@ui-forge/mastergo-adapter";
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
  commandAuditReporter?: (event: D2CAgent.DeliveryCommandAuditEvent) => void | Promise<void>;
}

/** 使用进程环境创建生产 D2C Workflow Service 及其全部运行时依赖。 */
export function createD2CWorkflowServiceFromEnvironment(
  options: D2CWorkflowServiceEnvironmentOptions = {},
): D2CWorkflowService {
  const token = process.env.MG_MCP_TOKEN ?? process.env.MASTERGO_API_TOKEN;
  const baseUrl = process.env.MASTERGO_BASE_URL;
  const designProvider = process.env.UI_FORGE_DESIGN_PROVIDER ?? "mastergo";
  const runtimeRoot = process.env.UI_FORGE_RUNTIME_DIR
    ?? fileURLToPath(new URL("../../../../.ui-forge/runtime", import.meta.url));
  const artifactRoot = process.env.UI_FORGE_ARTIFACT_DIR
    ?? fileURLToPath(new URL("../../../../.ui-forge/artifacts", import.meta.url));
  const designArtifactStore = new FileDesignArtifactStore(artifactRoot);
  const deliveryEvidenceStore = new FileDeliveryEvidenceStore(artifactRoot);
  const checkpointResource = createCheckpointResource(
    process.env.DATABASE_URL,
    process.env.UI_FORGE_CHECKPOINT_SCHEMA,
    join(runtimeRoot, "checkpoints.sqlite"),
    process.env.UI_FORGE_CHECKPOINT_BACKEND,
  );
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
    projectCodeContextReader: new FileSystemProjectCodeContextReader(),
    projectPatchApplier: new FileSystemProjectPatchApplier(),
    projectDeliveryValidator: new FileSystemProjectDeliveryValidator(deliveryEvidenceStore, {
      visualThreshold: readVisualDifferenceThreshold(),
      ...(options.commandAuditReporter
        ? { commandAuditReporter: options.commandAuditReporter }
        : {}),
    }),
    deliveryEvidenceStore,
    componentCatalog: readComponentCatalogFromEnvironment(),
    designSystemKnowledgeProvider,
    modelOptions: readSecondStepModelOptions(options.modelDiagnosticReporter),
    visualEvidenceProvider: new SharpDesignVisualEvidenceProvider(designArtifactStore),
    designArtifactReader: designArtifactStore,
    designArtifactLifecycle: designArtifactStore,
    checkpointer: checkpointResource.checkpointer,
  });
  const artifactCleanupWorker = new ArtifactCleanupWorker({
    store: designArtifactStore,
    service,
    retentionMs: readArtifactRetentionMs(),
  });
  return new D2CWorkflowService({
    designProvider,
    designArtifactReader: designArtifactStore,
    deliveryEvidenceStore,
    ...(options.commandAuditReporter
      ? { commandAuditReporter: options.commandAuditReporter }
      : {}),
    resolveWorkspaceId: createWorkspaceScopeId,
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

/** 以 Workspace 真实目录而非 Git remote 生成任务访问范围，避免同源克隆互相授权。 */
export async function createWorkspaceScopeId(projectPath: string): Promise<string> {
  if (!projectPath.trim()) return "unknown";
  const canonicalPath = await realpath(projectPath);
  const stats = await lstat(canonicalPath);
  if (!stats.isDirectory()) throw new Error("Workspace 项目路径必须是目录。");
  return `workspace:${createHash("sha256").update(canonicalPath).digest("hex")}`;
}

/** 读取自动视觉门禁阈值；默认允许 10% 显著差异像素。 */
function readVisualDifferenceThreshold(): number {
  const configured = process.env.UI_FORGE_VISUAL_DIFF_THRESHOLD?.trim();
  if (!configured) return 0.1;
  const threshold = Number(configured);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("UI_FORGE_VISUAL_DIFF_THRESHOLD 必须是 0 到 1 之间的数值。");
  }
  return threshold;
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

/** 根据环境配置创建 PostgreSQL、默认本地 SQLite 或显式测试内存 Saver。 */
function createCheckpointResource(
  databaseUrl: string | undefined,
  schema: string | undefined,
  sqlitePath: string,
  configuredBackend: string | undefined,
): CheckpointResource {
  const backend = configuredBackend?.trim();
  if (backend && backend !== "memory" && backend !== "sqlite" && backend !== "postgres") {
    throw new Error("UI_FORGE_CHECKPOINT_BACKEND 必须是 memory、sqlite 或 postgres。");
  }
  if (backend === "memory") {
    return {
      checkpointer: new MemorySaver(),
      initialize: async () => undefined,
      dispose: async () => undefined,
    };
  }
  if (backend === "postgres" || (!backend && databaseUrl?.trim())) {
    if (!databaseUrl?.trim()) throw new Error("PostgreSQL Checkpointer 要求配置 DATABASE_URL。");
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
  mkdirSync(dirname(sqlitePath), { recursive: true, mode: 0o700 });
  const checkpointer = SqliteSaver.fromConnString(sqlitePath);
  chmodSync(sqlitePath, 0o600);
  return {
    checkpointer,
    initialize: async () => undefined,
    dispose: async () => checkpointer.db.close(),
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
