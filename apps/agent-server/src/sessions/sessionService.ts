/** 将 ui-forge 会话操作交给 Codex；诊断观测独立保存，不参与执行或审批决策。 */
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  checkCodexVersion,
  CodexRpcError,
  prepareTemporaryWorkspace,
  resolveCodexExecutable,
  temporaryWorkspaceContext,
  deliveryContext,
  type CodexEvent,
  type NativeMethods,
} from "@ui-forge/codex-client";
import {
  diagnosticTokenUsageSchema,
  diagnosticAgentSummarySchema,
  diagnosticRuntimeSchema,
  sessionSnapshotSchema,
  type CreateSessionInput,
  type SendSessionInput,
  type SessionEvent,
  type SessionSnapshot,
  type TaskDiagnostics,
  type TaskDelivery,
  type DiagnosticAgentSummary,
  type DiagnosticRuntime,
  type DesignBinding,
  type DesignSource,
} from "@ui-forge/shared-protocol";
import {
  SessionDesignBindings,
  type SessionDesignOptions,
} from "../design/sessionDesignBindings.js";
import { DiagnosticMetadataStore } from "../diagnostics/diagnosticMetadataStore.js";
import { projectTaskDiagnostics } from "../diagnostics/taskDiagnostics.js";
import { DeliveryService } from "../delivery/deliveryService.js";
import {
  CodexConnections,
  type CodexConnectionFactory,
  type WorkspaceConnection,
} from "../runtime/codexConnections.js";
import { prepareSessionPolicy } from "../runtime/sessionPolicy.js";
import { SessionIndex } from "./sessionIndex.js";
import { SessionEventHub } from "./sessionEventHub.js";
import { saveImageAttachments } from "./imageAttachments.js";

const reasoningEfforts = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

const childThreadSourceKinds = [
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
] satisfies NonNullable<NativeMethods["thread/list"]["params"]["sourceKinds"]>;

function safeMetadataText(value: unknown, maxLength = 256): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
}

function safeReasoningEffort(value: unknown): DiagnosticAgentSummary["reasoningEffort"] {
  return typeof value === "string" && reasoningEfforts.has(value)
    ? (value as DiagnosticAgentSummary["reasoningEffort"])
    : null;
}

function taskDiagnosticsStatus(value: unknown): TaskDiagnostics["status"] {
  const statuses = new Set(["notLoaded", "idle", "systemError", "active", "unknown"]);
  return typeof value === "string" && statuses.has(value)
    ? (value as TaskDiagnostics["status"])
    : "unknown";
}

/** 从原生线程配置中提取安全的并发上限，不复制配置正文。 */
function configuredConcurrency(config: unknown): number | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const agents = (config as Record<string, unknown>).agents;
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) return null;
  const value = (agents as Record<string, unknown>).max_concurrent_threads_per_session;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** 将原生线程来源转成不含嵌套正文的单一标识。 */
function threadSource(thread: NativeMethods["thread/read"]["result"]["thread"]): string | null {
  if (typeof thread.threadSource === "string") return thread.threadSource;
  if (typeof thread.source === "string") return thread.source;
  return null;
}

/** 根据 thread/start 响应建立运行时白名单。未提供的宿主信息保持未知。 */
function runtimeFromStart(config: unknown, serviceTier: string | null): DiagnosticRuntime {
  const executable = resolveCodexExecutable(process.env.UI_FORGE_CODEX_PATH || "codex");
  return diagnosticRuntimeSchema.parse({
    executablePath: isAbsolute(executable) ? safeMetadataText(executable, 4096) : null,
    codexHome:
      process.env.CODEX_HOME && isAbsolute(process.env.CODEX_HOME)
        ? safeMetadataText(process.env.CODEX_HOME, 4096)
        : null,
    serviceTier: safeMetadataText(serviceTier),
    configuredConcurrency: configuredConcurrency(config),
    currentConcurrency: null,
    peakConcurrency: null,
    platform: safeMetadataText(process.platform),
    arch: safeMetadataText(process.arch),
  });
}

/** 只保存线程身份、模型、状态和错误类别；不复制线程正文。 */
function agentFromThread(
  thread: NativeMethods["thread/read"]["result"]["thread"],
  serviceTier: string | null,
) {
  return diagnosticAgentSummarySchema.parse({
    threadId: thread.id,
    parentThreadId: safeMetadataText(thread.parentThreadId),
    source: safeMetadataText(threadSource(thread)),
    model: safeMetadataText(thread.model),
    modelProvider: safeMetadataText(thread.modelProvider),
    reasoningEffort: safeReasoningEffort(thread.reasoningEffort),
    serviceTier: safeMetadataText(serviceTier),
    status: taskDiagnosticsStatus(thread.status?.type),
    errorCodes: [],
  });
}

/** 会话服务装配依赖。 */
export interface SessionServiceOptions extends SessionDesignOptions {
  directory: string;
  connectionFactory?: CodexConnectionFactory;
}
/** 页面与 CLI 共享同一组原生连接，操作串行化到指定任务。 */
export class SessionService {
  /** 只保存导航信息的任务索引。 */
  readonly index: SessionIndex;
  private readonly connections: CodexConnections;
  private readonly events: SessionEventHub;
  private readonly diagnostics: DiagnosticMetadataStore;
  private readonly designs: SessionDesignBindings;
  private readonly delivery: DeliveryService;
  private readonly operations = new Map<string, Promise<unknown>>();
  /** 将原生线程及其子线程映射到 ui-forge 根任务，供并发诊断使用。 */
  private readonly diagnosticRoots = new Map<string, string>();
  private readonly diagnosticActive = new Map<string, Set<string>>();
  /** 创建服务对象时不启动 Codex。 */
  constructor(private readonly options: SessionServiceOptions) {
    this.index = new SessionIndex(options.directory);
    this.diagnostics = new DiagnosticMetadataStore(options.directory);
    this.events = new SessionEventHub(
      (taskId) => this.index.get(taskId).projectPath,
      (taskId) => this.index.get(taskId).designBinding,
    );
    this.connections = new CodexConnections((cwd, event, loaded) => {
      this.observeDiagnostics(cwd, event);
      this.events.onEvent(cwd, event, loaded);
    }, options.connectionFactory);
    this.designs = new SessionDesignBindings(
      this.index,
      (taskId) => this.readNative(taskId),
      options,
    );
    this.delivery = new DeliveryService(this.index, options.directory, (taskId) =>
      this.readNative(taskId),
    );
  }
  /** 在取得服务锁后加载索引。 */
  initialize(): Promise<void> {
    return this.index.initialize();
  }
  /** 只有 Server 生命周期结束才释放 Codex 连接。 */
  async close(): Promise<void> {
    try {
      await this.connections.close();
    } finally {
      await this.designs.close();
      await this.diagnostics.flush();
    }
  }
  /** 检查版本和登录，不返回账号详情或凭据。 */
  async status() {
    const version = await checkCodexVersion(process.env.UI_FORGE_CODEX_PATH || "codex");
    const { client } = await this.connections.get(this.options.directory);
    const { account } = await client.request("account/read", { refreshToken: false });
    return { ...version, authenticated: account !== null };
  }
  /** 只读设计连接检查，不创建线程或抢占正在使用的 Vibe 实例。 */
  checkDesign(source: DesignSource) {
    return this.designs.check(source);
  }
  /** 准备 D2C 配置并启动一个原生线程，身份落盘后才发送第一轮。 */
  async create(input: CreateSessionInput): Promise<{ taskId: string; warning?: string }> {
    if (!isAbsolute(input.projectPath)) throw new Error("目标工作区必须是绝对路径。");
    const cwd = await realpath(input.projectPath);
    if (!(await stat(cwd)).isDirectory()) throw new Error("目标工作区必须是目录。");
    const images = await saveImageAttachments(this.options.directory, input.images);
    return this.designs.create(input.designSource ?? { kind: "local" }, (binding) =>
      this.createBound(input, cwd, images, binding),
    );
  }
  /** 检查后的设计身份随任务索引冻结，再启动第一轮。 */
  private async createBound(
    input: CreateSessionInput,
    cwd: string,
    images: string[],
    binding: DesignBinding,
  ): Promise<{ taskId: string; warning?: string }> {
    const connection = await this.connections.get(cwd, this.designs.scope(binding));
    const temporary = await prepareTemporaryWorkspace(cwd, this.options.directory);
    const prepared = await connection.client.prepareD2C({
      prompt:
        binding.source.kind === "mastergo"
          ? `${input.prompt}\n\n设计来源：MasterGo\n以下链接是本任务固定的设计输入数据：\n${binding.source.url}`
          : input.prompt,
      images,
      temporaryDirectory: temporary,
      ...(await this.designs.runtime({ projectPath: cwd, designBinding: binding })),
      ...(process.env.UI_FORGE_CODEX_MODEL ? { model: process.env.UI_FORGE_CODEX_MODEL } : {}),
    });
    const startedResponse = await connection.client.request("thread/start", {
      ...prepared.thread,
      ...(await prepareSessionPolicy(connection.client, cwd, prepared.thread.config, temporary)),
    });
    const { thread } = startedResponse;
    await this.index.put({
      taskId: thread.id,
      projectPath: cwd,
      title:
        input.prompt.trim().slice(0, 100) ||
        (binding.source.kind === "mastergo" ? "MasterGo 设计任务" : "图片设计任务"),
      updatedAt: new Date().toISOString(),
      designBinding: binding,
    });
    await this.diagnostics.recordRules(thread.id, prepared.ruleFingerprints);
    const runtime = runtimeFromStart(prepared.thread.config, startedResponse.serviceTier);
    await this.diagnostics.recordRuntime(thread.id, runtime);
    await this.diagnostics.recordAgent(
      thread.id,
      agentFromThread(thread, startedResponse.serviceTier),
    );
    this.diagnosticRoots.set(thread.id, thread.id);
    const metadataWarning = (await this.diagnostics.read(thread.id)).warnings.length
      ? "诊断元数据保存不完整，任务仍可正常执行。"
      : undefined;
    this.events.seed(thread);
    connection.loaded.add(thread.id);
    try {
      const started = await connection.client.request("turn/start", {
        threadId: thread.id,
        input: prepared.input,
        additionalContext: {
          ...temporaryWorkspaceContext(temporary),
          ...deliveryContext(temporary, thread.id),
        },
      });
      // 仅补入尚未观察到的轮次，不能用启动响应覆盖较新的原生通知。
      this.events.publishTurnStart(thread.id, started.turn);
    } catch (error) {
      const startWarning = await this.settleUncertainVibeStart(error, binding, connection);
      return {
        taskId: thread.id,
        warning: `${metadataWarning ? `${metadataWarning} ` : ""}${startWarning ?? `会话已创建，请查看实际状态后继续：${error instanceof Error ? error.message : "首轮请求失败"}`}`,
      };
    }
    return { taskId: thread.id, ...(metadataWarning ? { warning: metadataWarning } : {}) };
  }
  /** 直接读取原生历史生成诊断；不恢复线程、不准备工具或启动轮次。 */
  async readDiagnostics(taskId: string): Promise<TaskDiagnostics> {
    const entry = this.index.get(taskId);
    const thread = await (async () => {
      try {
        return await this.readNative(taskId);
      } catch {
        throw new Error("原生任务历史读取失败，诊断暂不可用。");
      }
    })();
    if (thread.id !== taskId || thread.cwd !== entry.projectPath)
      throw new Error("原生历史与当前任务身份不一致，无法读取诊断。");
    const children = await this.readChildThreads(taskId, entry.projectPath);
    for (const child of children.threads) this.diagnosticRoots.set(child.id, taskId);
    const current = [thread, ...children.threads].filter(
      (item) => item.status.type === "active",
    ).length;
    await this.diagnostics.recordConcurrency(taskId, current);
    const metadata = await this.diagnostics.read(taskId);
    return projectTaskDiagnostics(thread, metadata, children.threads, children.warnings);
  }
  /** 核对交付声明与现有文件，只有引用原生工具时读取历史，不恢复或启动任务。 */
  readDelivery(taskId: string): Promise<TaskDelivery> {
    return this.delivery.read(taskId);
  }
  /** 原生恢复仅装载历史，不重新执行之前的用户输入。 */
  async read(taskId: string): Promise<SessionSnapshot> {
    const connection = await this.load(taskId);
    const { thread } = await connection.client.request("thread/read", {
      threadId: taskId,
      includeTurns: true,
    });
    return sessionSnapshotSchema.parse({
      thread,
      ...(this.index.get(taskId).designBinding
        ? { designBinding: this.index.get(taskId).designBinding }
        : {}),
      pendingRequests: connection.client
        .pendingRequests()
        .filter((pending) => this.events.requestBelongsTo(pending, taskId)),
    });
  }
  /** 保存本轮附件并传入原生输入；自动续接可在已有运行轮次时原子地跳过。 */
  send(
    taskId: string,
    text: string,
    images: SendSessionInput["images"] = [],
    startOnlyIfIdle = false,
  ): Promise<void> {
    return this.serial(taskId, async () => {
      const connection = await this.load(taskId);
      const paths = await saveImageAttachments(this.options.directory, images);
      const temporary = await prepareTemporaryWorkspace(
        this.index.get(taskId).projectPath,
        this.options.directory,
      );
      const snapshot = await this.read(taskId);
      const active = snapshot.thread.turns.findLast((turn) => turn.status === "inProgress");
      if (active && startOnlyIfIdle) return;
      return this.designs.run(this.index.get(taskId).designBinding, async () => {
        const input = [
          ...(text.trim() ? [{ type: "text" as const, text, text_elements: [] }] : []),
          ...paths.map((path) => ({ type: "localImage" as const, path })),
        ];
        const additionalContext = {
          ...temporaryWorkspaceContext(temporary),
          ...deliveryContext(temporary, taskId),
        };
        if (active)
          await connection.client.request("turn/steer", {
            threadId: taskId,
            expectedTurnId: active.id,
            input,
            additionalContext,
          });
        else {
          const started = await connection.client
            .request("turn/start", {
              threadId: taskId,
              input,
              additionalContext,
            })
            .catch(async (error: unknown) => {
              const warning = await this.settleUncertainVibeStart(
                error,
                this.index.get(taskId).designBinding,
                connection,
              );
              if (warning) throw new Error(warning);
              throw error;
            });
          // 与新建任务共用只补缺失轮次的兜底，不重放已有轮次的启动事件。
          this.events.publishTurnStart(taskId, started.turn);
        }
        await this.index.put({ ...this.index.get(taskId), updatedAt: new Date().toISOString() });
      });
    });
  }
  /** 只停止用户看到的当前轮次，失效的 turn ID 不用于后续轮次。 */
  stop(taskId: string, turnId: string): Promise<void> {
    return this.serial(taskId, async () => {
      const snapshot = await this.read(taskId);
      if (!snapshot.thread.turns.some((turn) => turn.id === turnId && turn.status === "inProgress"))
        throw new Error("该轮次已结束，停止请求已失效。");
      const connection = await this.load(taskId);
      await connection.client.request("turn/interrupt", { threadId: taskId, turnId });
    });
  }
  /** 回复当前任务的真实请求；连接令牌和原生 Schema 共同阻止旧决议复用。 */
  async respond(taskId: string, token: string, result: unknown): Promise<void> {
    const connection = await this.load(taskId);
    const pending = connection.client.pendingRequests().find((entry) => entry.token === token);
    if (!pending || !this.events.requestBelongsTo(pending, taskId))
      throw new Error("请求已失效或不属于当前任务。");
    await connection.client.respond(token, result);
    this.events.publish(taskId, { type: "resolved", token });
  }
  /** 订阅模块负责快照和增量；取消订阅不关闭工作区连接。 */
  subscribe(taskId: string, signal: AbortSignal): AsyncIterable<SessionEvent | undefined> {
    return this.events.subscribe(taskId, signal, async () => (await this.load(taskId)).client);
  }
  /** 原生连接事件只记录白名单状态和累计量，不保存提示词、命令正文或原始异常。 */
  private observeDiagnostics(cwd: string, event: CodexEvent): void {
    if (event.type !== "notification") return;
    const notification = event.notification;
    if (notification.method === "thread/tokenUsage/updated") {
      const { threadId, tokenUsage } = notification.params;
      const root = this.rootForThread(threadId, cwd);
      if (!root) return;
      const { total } = tokenUsage;
      const parsed = diagnosticTokenUsageSchema.safeParse({
        observedAt: new Date().toISOString(),
        total: {
          totalTokens: total.totalTokens,
          inputTokens: total.inputTokens,
          cachedInputTokens: total.cachedInputTokens,
          cacheWriteInputTokens: total.cacheWriteInputTokens,
          outputTokens: total.outputTokens,
          reasoningOutputTokens: total.reasoningOutputTokens,
        },
      });
      if (parsed.success && root === threadId)
        void this.diagnostics.recordTokenUsage(root, parsed.data);
      return;
    }
    if (notification.method === "thread/started") {
      const { thread } = notification.params;
      const root = thread.parentThreadId
        ? this.rootForThread(thread.parentThreadId, cwd)
        : thread.id;
      if (!root) return;
      this.diagnosticRoots.set(thread.id, root);
      void this.diagnostics.recordAgent(root, agentFromThread(thread, null));
      return;
    }
    if (notification.method === "thread/status/changed") {
      const { threadId, status } = notification.params;
      const root = this.rootForThread(threadId, cwd);
      if (!root) return;
      const active = this.diagnosticActive.get(root) ?? new Set<string>();
      if (status.type === "active") active.add(threadId);
      else active.delete(threadId);
      this.diagnosticActive.set(root, active);
      void this.diagnostics.recordConcurrency(root, active.size);
      return;
    }
    if (notification.method === "thread/settings/updated") {
      const { threadId, threadSettings } = notification.params;
      const root = this.rootForThread(threadId, cwd);
      if (!root || !threadSettings.serviceTier) return;
      void this.diagnostics.read(root).then((metadata) => {
        const agent = metadata.agents.find((item) => item.threadId === threadId);
        const agentUpdate = agent
          ? this.diagnostics.recordAgent(root, {
              ...agent,
              model: threadSettings.model,
              modelProvider: threadSettings.modelProvider,
              reasoningEffort: safeReasoningEffort(threadSettings.effort),
              serviceTier: threadSettings.serviceTier,
            })
          : Promise.resolve();
        const runtimeUpdate = threadId === root && metadata.runtime
          ? this.diagnostics.recordRuntime(root, {
              ...metadata.runtime,
              serviceTier: threadSettings.serviceTier,
            })
          : Promise.resolve();
        return Promise.all([agentUpdate, runtimeUpdate]);
      });
    }
  }

  /** 查找根任务；未知线程只通过索引或已收到的 thread/started 建立关联。 */
  private rootForThread(threadId: string, cwd: string): string | undefined {
    const known = this.diagnosticRoots.get(threadId);
    if (known) return known;
    try {
      if (this.index.get(threadId).projectPath !== cwd) return undefined;
      this.diagnosticRoots.set(threadId, threadId);
      return threadId;
    } catch {
      return undefined;
    }
  }

  /** 读取根任务的子线程摘要；读取失败只暴露固定诊断缺口。 */
  private async readChildThreads(
    taskId: string,
    cwd: string,
  ): Promise<{
    threads: NativeMethods["thread/list"]["result"]["data"];
    warnings: TaskDiagnostics["warnings"];
  }> {
    try {
      const { client } = await this.connections.get(
        cwd,
        this.designs.scope(this.index.get(taskId).designBinding),
      );
      const threads: NativeMethods["thread/list"]["result"]["data"] = [];
      let cursor: string | null = null;
      do {
        const response: NativeMethods["thread/list"]["result"] = await client.request(
          "thread/list",
          {
            ancestorThreadId: taskId,
            cwd,
            limit: 100,
            sourceKinds: childThreadSourceKinds,
            ...(cursor ? { cursor } : {}),
          },
        );
        threads.push(...response.data.filter((thread) => thread.cwd === cwd));
        cursor = response.nextCursor;
      } while (cursor);
      return { threads, warnings: [] };
    } catch {
      return { threads: [], warnings: ["agentsUnavailable"] };
    }
  }
  /** 并发访问共享同一次原生装载，历史不会触发新一轮执行。 */
  private async load(taskId: string): Promise<WorkspaceConnection> {
    const entry = this.index.get(taskId);
    const connection = await this.connections.get(
      entry.projectPath,
      this.designs.scope(entry.designBinding),
    );
    if (!connection.loaded.has(taskId)) {
      let loading = connection.loading.get(taskId);
      if (!loading) {
        loading = (async () => {
          const temporary = await prepareTemporaryWorkspace(
            entry.projectPath,
            this.options.directory,
          );
          const prepared = await connection.client.prepareD2CRuntime({
            temporaryDirectory: temporary,
            ...(await this.designs.runtime(entry)),
          });
          const resumed = await connection.client.request("thread/resume", {
            threadId: taskId,
            cwd: entry.projectPath,
            ...(await prepareSessionPolicy(
              connection.client,
              entry.projectPath,
              prepared.config,
              temporary,
            )),
          });
          const { thread } = resumed;
          await this.diagnostics.recordRuntime(
            taskId,
            runtimeFromStart(prepared.config, resumed.serviceTier),
          );
          await this.diagnostics.recordAgent(taskId, agentFromThread(thread, resumed.serviceTier));
          this.diagnosticRoots.set(thread.id, taskId);
          this.events.seed(thread);
          connection.loaded.add(taskId);
        })().finally(() => {
          connection.loading.delete(taskId);
        });
        connection.loading.set(taskId, loading);
      }
      await loading;
    }
    return connection;
  }
  /** 资源保护和诊断只读取原生历史，不恢复会话或访问平台画布。 */
  private async readNative(
    taskId: string,
  ): Promise<NativeMethods["thread/read"]["result"]["thread"]> {
    const entry = this.index.get(taskId);
    const { client } = await this.connections.get(
      entry.projectPath,
      this.designs.scope(entry.designBinding),
    );
    const { thread } = await client.request("thread/read", {
      threadId: taskId,
      includeTurns: true,
    });
    if (thread.id !== taskId || thread.cwd !== entry.projectPath)
      throw new Error("原生历史与当前任务身份不一致。");
    return thread;
  }
  /** 未决启动可能在超时后生效；等待独立 Vibe 进程终止后才能让其他任务检查占用。 */
  private async settleUncertainVibeStart(
    error: unknown,
    binding: DesignBinding | undefined,
    connection: WorkspaceConnection,
  ): Promise<string | undefined> {
    if (
      !(error instanceof CodexRpcError) &&
      binding?.source.kind === "mastergo" &&
      binding.source.connection.kind === "vibe"
    ) {
      await connection.client.close();
      return "Vibe 启动结果未确认，为避免并发已终止连接，请检查原任务后继续。";
    }
    return undefined;
  }
  /** 串行化同一任务的输入和停止操作，不阻塞其他会话。 */
  private serial(taskId: string, action: () => Promise<void>): Promise<void> {
    const operation = (this.operations.get(taskId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(action);
    this.operations.set(taskId, operation);
    void operation
      .finally(() => {
        if (this.operations.get(taskId) === operation) this.operations.delete(taskId);
      })
      .catch(() => undefined);
    return operation;
  }
}
