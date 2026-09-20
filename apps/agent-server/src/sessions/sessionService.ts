/** 将 ui-forge 会话操作交给 Codex；仅持有连接、订阅和导航索引。 */
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  checkCodexVersion,
  prepareTemporaryWorkspace,
  temporaryWorkspaceContext,
} from "@ui-forge/codex-client";
import {
  sessionSnapshotSchema,
  type CreateSessionInput,
  type SendSessionInput,
  type SessionEvent,
  type SessionSnapshot,
} from "@ui-forge/shared-protocol";
import {
  CodexConnections,
  type CodexConnectionFactory,
  type WorkspaceConnection,
} from "../runtime/codexConnections.js";
import { prepareSessionPolicy } from "../runtime/sessionPolicy.js";
import { SessionIndex } from "./sessionIndex.js";
import { SessionEventHub } from "./sessionEventHub.js";
import { saveImageAttachments } from "./imageAttachments.js";

/** 会话服务装配依赖。 */
export interface SessionServiceOptions {
  directory: string;
  connectionFactory?: CodexConnectionFactory;
}
/** 页面与 CLI 共享同一组原生连接，操作串行化到指定任务。 */
export class SessionService {
  /** 只保存导航信息的任务索引。 */
  readonly index: SessionIndex;
  private readonly connections: CodexConnections;
  private readonly events: SessionEventHub;
  private readonly operations = new Map<string, Promise<unknown>>();
  /** 创建服务对象时不启动 Codex。 */
  constructor(private readonly options: SessionServiceOptions) {
    this.index = new SessionIndex(options.directory);
    this.events = new SessionEventHub((taskId) => this.index.get(taskId).projectPath);
    this.connections = new CodexConnections(
      (cwd, event) => this.events.onEvent(cwd, event),
      options.connectionFactory,
    );
  }
  /** 在取得服务锁后加载索引。 */
  initialize(): Promise<void> {
    return this.index.initialize();
  }
  /** 只有 Server 生命周期结束才释放 Codex 连接。 */
  close(): Promise<void> {
    return this.connections.close();
  }
  /** 检查版本和登录，不返回账号详情或凭据。 */
  async status() {
    const version = await checkCodexVersion(process.env.UI_FORGE_CODEX_PATH || "codex");
    const { client } = await this.connections.get(this.options.directory);
    const { account } = await client.request("account/read", { refreshToken: false });
    return { ...version, authenticated: account !== null };
  }
  /** 准备 D2C 配置并启动一个原生线程，身份落盘后才发送第一轮。 */
  async create(input: CreateSessionInput): Promise<{ taskId: string; warning?: string }> {
    if (!isAbsolute(input.projectPath)) throw new Error("目标工作区必须是绝对路径。");
    const cwd = await realpath(input.projectPath);
    if (!(await stat(cwd)).isDirectory()) throw new Error("目标工作区必须是目录。");
    const images = await saveImageAttachments(this.options.directory, input.images);
    const connection = await this.connections.get(cwd);
    const temporary = await prepareTemporaryWorkspace(cwd, this.options.directory);
    const prepared = await connection.client.prepareD2C({
      prompt: input.prompt,
      images,
      temporaryDirectory: temporary,
      ...(process.env.UI_FORGE_CODEX_MODEL ? { model: process.env.UI_FORGE_CODEX_MODEL } : {}),
    });
    const { thread } = await connection.client.request("thread/start", {
      ...prepared.thread,
      ...(await prepareSessionPolicy(connection.client, cwd, prepared.thread.config, temporary)),
    });
    await this.index.put({
      taskId: thread.id,
      projectPath: cwd,
      title: input.prompt.trim().slice(0, 100) || "图片设计任务",
      updatedAt: new Date().toISOString(),
    });
    this.events.seed(thread);
    connection.loaded.add(thread.id);
    try {
      const started = await connection.client.request("turn/start", {
        threadId: thread.id,
        input: prepared.input,
        additionalContext: temporaryWorkspaceContext(temporary),
      });
      // 仅补入尚未观察到的轮次，不能用启动响应覆盖较新的原生通知。
      this.events.publishTurnStart(thread.id, started.turn);
    } catch (error) {
      return {
        taskId: thread.id,
        warning: `会话已创建，请查看实际状态后继续：${error instanceof Error ? error.message : "首轮请求失败"}`,
      };
    }
    return { taskId: thread.id };
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
      const input = [
        ...(text.trim() ? [{ type: "text" as const, text, text_elements: [] }] : []),
        ...paths.map((path) => ({ type: "localImage" as const, path })),
      ];
      const additionalContext = temporaryWorkspaceContext(temporary);
      if (active)
        await connection.client.request("turn/steer", {
          threadId: taskId,
          expectedTurnId: active.id,
          input,
          additionalContext,
        });
      else {
        const started = await connection.client.request("turn/start", {
          threadId: taskId,
          input,
          additionalContext,
        });
        // 与新建任务共用只补缺失轮次的兜底，不重放已有轮次的启动事件。
        this.events.publishTurnStart(taskId, started.turn);
      }
      await this.index.put({ ...this.index.get(taskId), updatedAt: new Date().toISOString() });
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
  /** 并发访问共享同一次原生装载，历史不会触发新一轮执行。 */
  private async load(taskId: string): Promise<WorkspaceConnection> {
    const entry = this.index.get(taskId);
    const connection = await this.connections.get(entry.projectPath);
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
          });
          const { thread } = await connection.client.request("thread/resume", {
            threadId: taskId,
            cwd: entry.projectPath,
            ...(await prepareSessionPolicy(
              connection.client,
              entry.projectPath,
              prepared.config,
              temporary,
            )),
          });
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
