/** 按目标目录和设计接入范围复用 Codex 进程，服务关闭时统一回收。 */
import { CodexClient, type CodexClientOptions, type CodexEvent } from "@ui-forge/codex-client";
import { computerUseDisabledConfig, disableDesktopMcp } from "./computerUsePolicy.js";

/** 可测试的原生连接端口，不重定义 Codex 方法类型。 */
export type CodexConnection = Pick<
  CodexClient,
  | "request"
  | "prepareD2C"
  | "prepareD2CRuntime"
  | "subscribe"
  | "pendingRequests"
  | "respond"
  | "close"
>;
/** 为一个明确工作区创建连接。 */
export type CodexConnectionFactory = (
  cwd: string,
  configOverrides: NonNullable<CodexClientOptions["configOverrides"]>,
) => CodexConnection;
/** 单个连接的装载标记只是连接状态，不是任务执行状态。 */
export interface WorkspaceConnection {
  client: CodexConnection;
  loaded: Set<string>;
  loading: Map<string, Promise<void>>;
}
/** 管理原生连接生命周期和事件来源工作区。 */
export class CodexConnections {
  private readonly connections = new Map<string, Promise<WorkspaceConnection>>();
  private closed = false;
  /** 事件接收方按任务路由，测试可替换原生进程。 */
  constructor(
    private readonly onEvent: (cwd: string, event: CodexEvent, loaded: ReadonlySet<string>) => void,
    private readonly factory: CodexConnectionFactory = (cwd, configOverrides) =>
      new CodexClient({
        cwd,
        configOverrides,
        ...(process.env.UI_FORGE_CODEX_PATH ? { executable: process.env.UI_FORGE_CODEX_PATH } : {}),
      }),
  ) {}
  /** 首次使用时创建连接；原生进程异常退出后允许重新连接。 */
  async get(cwd: string, scope = "magic"): Promise<WorkspaceConnection> {
    if (this.closed) throw new Error("Agent Server 已关闭。");
    const key = JSON.stringify([cwd, scope]);
    let connection = this.connections.get(key);
    if (!connection) {
      connection = this.prepare(cwd, key);
      this.connections.set(key, connection);
      const pending = connection;
      void pending.catch(() => {
        if (this.connections.get(key) === pending) this.connections.delete(key);
      });
    }
    return connection;
  }
  /** 先只读发现配置，再用完整禁用参数启动实际连接；探测进程不创建线程或启动 MCP。 */
  private async prepare(cwd: string, key: string): Promise<WorkspaceConnection> {
    let client = this.factory(cwd, computerUseDisabledConfig);
    try {
      const desktopMcp = await disableDesktopMcp(client, cwd);
      if (Object.keys(desktopMcp).length) {
        await client.close();
        if (this.closed) throw new Error("Agent Server 已关闭。");
        client = this.factory(cwd, { ...computerUseDisabledConfig, ...desktopMcp });
      }
      if (this.closed) throw new Error("Agent Server 已关闭。");
      const loaded = new Set<string>();
      client.subscribe((event) => {
        if (event.type === "close") this.connections.delete(key);
        this.onEvent(cwd, event, loaded);
      });
      return { client, loaded, loading: new Map() };
    } catch (error) {
      await client.close();
      throw error;
    }
  }
  /** 服务退出才关闭所有原生进程。 */
  async close(): Promise<void> {
    this.closed = true;
    const clients = [...this.connections.values()];
    this.connections.clear();
    const settled = await Promise.allSettled(clients);
    await Promise.all(
      settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value.client.close()] : [],
      ),
    );
  }
}
