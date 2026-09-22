/** 串行化同一 Vibe 实例的执行准入；占用资格始终通过原生会话查询确认。 */

/** 只读取原生状态字段，避免将历史载荷转为执行缓存。 */
export interface NativeExecutionSnapshot {
  /** 原生线程是否仍处于活动状态。 */
  status: { type: string };
  /** 原生轮次的当前状态。 */
  turns: readonly { status: string }[];
}

/** 已持久化的实例与任务关联，不记录第二套执行状态。 */
export interface VibeLeaseTask {
  /** 原生线程身份。 */
  taskId: string;
  /** 创建时冻结的设计绑定身份。 */
  bindingId: string;
}

/** 读取原生状态时仍运行或等待交互的线程必须保留 Vibe 使用权。 */
function isRunning(thread: NativeExecutionSnapshot): boolean {
  return (
    thread.status.type === "active" || thread.turns.some((turn) => turn.status === "inProgress")
  );
}

/** 原生状态服务的回环别名与路径共用端口时视为同一画布实例，MCP 代理端口不决定身份。 */
export function vibeInstanceKey(statusEndpoint: string): string {
  const url = new URL(statusEndpoint);
  return url.port || "80";
}

/** owner 仅供受限桥拒绝旧连接读取，执行状态不从该缓存推断。 */
export class VibeLeases {
  private readonly owners = new Map<string, string>();
  private readonly operations = new Map<string, Promise<unknown>>();

  /** 注入索引查询和只读原生查询，避免将会话启动逻辑引入资源保护。 */
  constructor(
    private readonly candidates: (instance: string) => VibeLeaseTask[],
    private readonly read: (taskId: string) => Promise<NativeExecutionSnapshot>,
  ) {}

  /** 创建或继续前排队检查其他任务；无法读取状态时拒绝抢占。 */
  run<T>(instance: string, bindingId: string, action: () => Promise<T>): Promise<T> {
    const operation = (this.operations.get(instance) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        for (const task of this.candidates(instance)) {
          if (task.bindingId === bindingId) continue;
          let thread: NativeExecutionSnapshot;
          try {
            thread = await this.read(task.taskId);
          } catch {
            throw new Error("无法确认 Vibe 实例的任务占用状态，请先检查原任务。");
          }
          if (isRunning(thread))
            throw new Error(`Vibe 实例正由任务 ${task.taskId} 使用，请先结束该轮次。`);
        }
        this.owners.set(instance, bindingId);
        return action();
      });
    this.operations.set(instance, operation);
    void operation
      .finally(() => {
        if (this.operations.get(instance) === operation) this.operations.delete(instance);
      })
      .catch(() => undefined);
    return operation;
  }

  /** 读桥在请求前后核对 owner 和原生状态，不允许已结束的旧线程继续访问设计。 */
  async assertOwner(instance: string, bindingId: string, taskId: string): Promise<void> {
    if (this.owners.get(instance) !== bindingId)
      throw new Error("当前任务未持有 Vibe 实例，请先继续原任务。");
    const thread = await this.read(taskId);
    if (this.owners.get(instance) !== bindingId || !isRunning(thread))
      throw new Error("当前任务的 Vibe 使用权已失效。");
  }
}
