/** 定义不泄漏 LangGraph 第三方类型的通用状态图契约。 */

import type { Checkpointer } from "./checkpoint.js";

/** 表示图执行开始边界的稳定标识。 */
export const graphStart = "__start__";

/** 表示图执行结束边界的稳定标识。 */
export const graphEnd = "__end__";

/** 通用状态图中的一个可复用执行节点。 */
export interface GraphNode<TState extends object> {
  id: string;
  /** 读取隔离状态并返回本节点负责的状态增量。 */
  execute(state: TState): Partial<TState> | Promise<Partial<TState>>;
}

/** 连接节点或图边界的确定性有向边。 */
export interface GraphEdge {
  from: string;
  to: string;
}

/** 根据当前状态选择下一节点的条件路由。 */
export interface GraphRoute<TState extends object> {
  from: string;
  targets: readonly string[];
  /** 从声明的目标集合中选择下一节点或结束边界。 */
  decide(state: TState): string | Promise<string>;
}

/** 创建通用状态图所需的拓扑与可选持久化配置。 */
export interface GraphOptions<TState extends object> {
  nodes: readonly GraphNode<TState>[];
  edges: readonly GraphEdge[];
  routes?: readonly GraphRoute<TState>[];
  checkpointer?: Checkpointer;
  /** 在指定节点完成后保存状态并暂停，等待同一线程显式恢复。 */
  pauseAfter?: readonly string[];
}

/** 单次图调用使用的线程级运行配置。 */
export interface GraphInvokeOptions {
  threadId?: string;
  /** 设置为 false 时使用同一拓扑执行但不读取或写入 Checkpoint。 */
  checkpoint?: boolean;
}

/** 一个由 Checkpointer 发现的线程及其最新完整状态。 */
export interface GraphThreadState<TState extends object> {
  threadId: string;
  state: TState;
}

/** 对领域包隐藏 channel、编译器和 Checkpoint 快照的状态图。 */
export interface Graph<TState extends object> {
  /** 执行完整图；默认写入已配置的 Checkpointer，也可显式瞬时执行。 */
  invoke(state: TState, options?: GraphInvokeOptions): Promise<TState>;
  /** 从配置的暂停点继续执行同一线程。 */
  resume(threadId: string): Promise<TState>;
  /** 读取指定线程的最新完整状态，未启用或尚无 Checkpoint 时返回 undefined。 */
  getState(threadId: string): Promise<TState | undefined>;
  /** 替换线程的完整状态，同时保留已有暂停位置。 */
  setState(threadId: string, state: TState): Promise<void>;
  /** 永久删除指定线程的全部 Checkpoint 和待处理写入。 */
  deleteState(threadId: string): Promise<void>;
  /** 枚举 Checkpointer 中每个线程的最新完整状态。 */
  listStates(): Promise<GraphThreadState<TState>[]>;
}
