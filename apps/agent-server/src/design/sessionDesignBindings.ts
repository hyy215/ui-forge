/** 管理任务创建时的设计绑定和受限读桥；恢复与查看不会检查或切换当前画布。 */
import { randomUUID } from "node:crypto";
import {
  startVibeReadOnlyBridge,
  type D2CRuntimeOptions,
  type VibeReadOnlyBridge,
} from "@ui-forge/codex-client";
import {
  designBindingSchema,
  designSourceSchema,
  type DesignBinding,
  type DesignSource,
  type TaskHistoryEntry,
} from "@ui-forge/shared-protocol";
import type { SessionIndex } from "../sessions/sessionIndex.js";
import { checkDesignConnection } from "./checkDesignConnection.js";
import { VibeLeases, vibeInstanceKey, type NativeExecutionSnapshot } from "./vibeLeases.js";

/** 设计连接检查和读桥可注入离线实现，不扩展公共执行协议。 */
export interface SessionDesignOptions {
  /** 只读平台连接检查。 */
  designCheck?: typeof checkDesignConnection;
  /** 为固定目标创建受限的本地 MCP 读桥。 */
  startVibeBridge?: typeof startVibeReadOnlyBridge;
}

/** 绑定只保留来源和稳定身份；活动资格来自原生线程，不由此模块调度。 */
export class SessionDesignBindings {
  private readonly leases: VibeLeases;
  private readonly bridges = new Map<string, Promise<VibeReadOnlyBridge>>();
  private readonly checkConnection: typeof checkDesignConnection;
  private readonly startBridge: typeof startVibeReadOnlyBridge;

  /** 使用任务索引枚举同实例绑定，并通过只读原生查询验证占用。 */
  constructor(
    private readonly index: SessionIndex,
    read: (taskId: string) => Promise<NativeExecutionSnapshot>,
    options: SessionDesignOptions,
  ) {
    this.checkConnection = options.designCheck ?? checkDesignConnection;
    this.startBridge = options.startVibeBridge ?? startVibeReadOnlyBridge;
    this.leases = new VibeLeases(
      (instance) =>
        this.entries().flatMap((entry) => {
          const binding = entry.designBinding;
          return binding && this.instance(binding.source) === instance
            ? [{ taskId: entry.taskId, bindingId: binding.bindingId }]
            : [];
        }),
      read,
    );
  }

  /** 只读检查不声明占用，也不创建任务或桥。 */
  check(source: DesignSource) {
    return this.checkConnection(designSourceSchema.parse(source));
  }

  /** 创建期间串行验证资源，随后将检查到的固定身份交给任务持久化。 */
  create<T>(source: DesignSource, action: (binding: DesignBinding) => Promise<T>): Promise<T> {
    const selected = designSourceSchema.parse(source);
    const bindingId = randomUUID();
    const prepare = async () => {
      const checked = await this.check(selected);
      const binding = designBindingSchema.parse({
        bindingId,
        source: selected,
        ...(checked.target ? { target: checked.target } : {}),
      });
      try {
        return await action(binding);
      } catch (error) {
        if (!this.entries().some((entry) => entry.designBinding?.bindingId === bindingId)) {
          const bridge = this.bridges.get(bindingId);
          this.bridges.delete(bindingId);
          if (bridge) await bridge.then((value) => value.close()).catch(() => undefined);
        }
        throw error;
      }
    };
    const instance = this.instance(selected);
    return instance ? this.leases.run(instance, bindingId, prepare) : prepare();
  }

  /** 每次显式输入重新验证绑定；设计来源不随全局默认配置改变。 */
  run<T>(binding: DesignBinding | undefined, action: () => Promise<T>): Promise<T> {
    const instance = binding && this.instance(binding.source);
    if (!binding || !instance) return action();
    return this.leases.run(instance, binding.bindingId, async () => {
      const checked = await this.check(binding.source);
      if (
        !checked.target ||
        !binding.target ||
        checked.target.documentId !== binding.target.documentId ||
        checked.target.pageId !== binding.target.pageId ||
        checked.target.nodeId !== binding.target.nodeId
      )
        throw new Error("Vibe 当前画布与任务绑定不一致，请恢复原文件和页面后继续。");
      return action();
    });
  }

  /** 同目录的本地、Magic 和每个 Vibe 绑定使用独立原生连接。旧任务保持 Magic。 */
  scope(binding: DesignBinding | undefined): string {
    if (!binding) return "magic";
    if (binding.source.kind === "local") return "local";
    return binding.source.connection.kind === "magic" ? "magic" : `vibe:${binding.bindingId}`;
  }

  /** 仅准备本机桥；画布检查延迟到读工具，查看历史和停止任务不依赖平台可达性。 */
  async runtime(
    entry: Pick<TaskHistoryEntry, "projectPath" | "designBinding">,
  ): Promise<Pick<D2CRuntimeOptions, "designAccess">> {
    const binding = entry.designBinding;
    if (!binding) return {};
    if (binding.source.kind === "local") return { designAccess: { kind: "local" } };
    const connection = binding.source.connection;
    if (connection.kind === "magic") return { designAccess: { kind: "magic" } };
    const target = binding.target;
    if (!target?.pageId) throw new Error("Vibe 任务缺少固定画布身份。");
    let bridge = this.bridges.get(binding.bindingId);
    if (!bridge) {
      bridge = this.startBridge({
        connection,
        target: { ...target, pageId: target.pageId },
        projectDirectory: entry.projectPath,
        beforeRead: async () => {
          const task = this.entries().find(
            (candidate) => candidate.designBinding?.bindingId === binding.bindingId,
          );
          if (!task) throw new Error("Vibe 任务绑定尚未保存。");
          await this.leases.assertOwner(
            vibeInstanceKey(connection.statusEndpoint),
            binding.bindingId,
            task.taskId,
          );
        },
      });
      this.bridges.set(binding.bindingId, bridge);
      const creating = bridge;
      void creating.catch(() => {
        if (this.bridges.get(binding.bindingId) === creating)
          this.bridges.delete(binding.bindingId);
      });
    }
    return { designAccess: { kind: "vibe", bridgeUrl: (await bridge).url } };
  }

  /** 宿主退出释放所有绑定桥，不修改画布或用户文件。 */
  async close(): Promise<void> {
    const bridges = [...this.bridges.values()];
    this.bridges.clear();
    await Promise.allSettled(bridges.map(async (bridge) => (await bridge).close()));
  }

  private instance(source: DesignSource): string | undefined {
    return source.kind === "mastergo" && source.connection.kind === "vibe"
      ? vibeInstanceKey(source.connection.statusEndpoint)
      : undefined;
  }

  private entries(): TaskHistoryEntry[] {
    const entries: TaskHistoryEntry[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = this.index.list(offset);
      entries.push(...page.tasks);
      offset = page.nextOffset;
    }
    return entries;
  }
}
