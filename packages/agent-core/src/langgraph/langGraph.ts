/** 使用 LangGraph 实现多节点、条件路由与 Checkpoint 统一状态图。 */

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type {
  Graph,
  GraphOptions,
  GraphRoute,
} from "./graph.js";
import { graphEnd, graphStart } from "./graph.js";
import { createThreadConfig } from "./threadConfig.js";

interface InternalGraphState<TState extends object> {
  value: TState;
}

/** 创建封装多节点、分支、循环和可选 Checkpointer 的通用状态图。 */
export function createGraph<TState extends object>(
  options: GraphOptions<TState>,
): Graph<TState> {
  const topology = validateTopology(options);
  const StateAnnotation = Annotation.Root({
    value: Annotation<TState>(),
  });
  const nodeActions: Record<
    string,
    (state: InternalGraphState<TState>) => Promise<InternalGraphState<TState>>
  > = {};

  for (const node of topology.nodes) {
    nodeActions[node.id] = async (state) => {
      const current = structuredClone(state.value);
      return { value: Object.assign(current, await node.execute(current)) };
    };
  }

  const builder = new StateGraph(StateAnnotation).addNode(nodeActions);
  for (const edge of topology.edges) {
    builder.addEdge(resolveSource(edge.from), resolveTarget(edge.to));
  }
  for (const route of topology.routes) {
    builder.addConditionalEdges(
      route.from,
      async (state) => resolveRouteDecision(route, structuredClone(state.value)),
      route.targets.map(resolveTarget),
    );
  }

  const transientGraph = builder.compile();
  const checkpointGraph = builder.compile(
    options.checkpointer
      ? {
          checkpointer: options.checkpointer,
          ...(topology.pauseAfter.length > 0
            ? { interruptAfter: topology.pauseAfter }
            : {}),
        }
      : {},
  );

  return {
    /** 隔离输入状态并执行完整图；持久化调用要求 threadId，瞬时调用跳过 Checkpoint。 */
    async invoke(state, invokeOptions = {}) {
      const checkpointed = options.checkpointer !== undefined && invokeOptions.checkpoint !== false;
      const config = createInvokeConfig(checkpointed, invokeOptions.threadId);
      const graph = checkpointed ? checkpointGraph : transientGraph;
      const input = { value: structuredClone(state) };
      const result = checkpointed
        ? await invokeCheckpointedRun(checkpointGraph, input, config)
        : await graph.invoke(input, config);
      return structuredClone(result.value);
    },

    /** 从静态暂停点继续同一线程，不接受新的业务输入。 */
    async resume(threadId) {
      if (!options.checkpointer) throw new Error("未配置 Checkpointer 的 Graph 不能恢复执行。");
      const result = await checkpointGraph.invoke(null, createThreadConfig(threadId));
      return structuredClone(result.value);
    },

    /** 读取指定线程的最新状态；未配置 Checkpointer 时没有可恢复状态。 */
    async getState(threadId) {
      if (!options.checkpointer) return undefined;
      const snapshot = await checkpointGraph.getState(createThreadConfig(threadId));
      return snapshot.values.value === undefined
        ? undefined
        : structuredClone(snapshot.values.value);
    },

    /** 替换完整 value；首次写入以一个终点前节点建立没有待执行步骤的状态。 */
    async setState(threadId, state) {
      if (!options.checkpointer) throw new Error("未配置 Checkpointer 的 Graph 不能保存状态。");
      const config = createThreadConfig(threadId);
      const snapshot = await checkpointGraph.getState(config);
      const asNode = snapshot.values.value === undefined ? topology.stateAnchorNode : undefined;
      await checkpointGraph.updateState(
        config,
        { value: structuredClone(state) },
        asNode,
      );
    },
  };
}

/** 校验公共拓扑并返回规范化后的节点、边和路由。 */
function validateTopology<TState extends object>(options: GraphOptions<TState>): {
  nodes: Array<{ id: string; execute: GraphOptions<TState>["nodes"][number]["execute"] }>;
  edges: Array<{ from: string; to: string }>;
  routes: Array<GraphRoute<TState>>;
  pauseAfter: string[];
  stateAnchorNode: string;
} {
  if (options.nodes.length === 0) throw new Error("Graph 至少需要一个节点。");
  const ids = new Set<string>();
  const nodes = options.nodes.map((node) => {
    const id = node.id.trim();
    if (!id) throw new Error("Graph 节点 id 不能为空。");
    if (id === graphStart || id === graphEnd) {
      throw new Error(`Graph 节点 id 不能使用保留值：${id}`);
    }
    if (ids.has(id)) throw new Error(`Graph 节点 id 不能重复：${id}`);
    ids.add(id);
    return { id, execute: node.execute };
  });
  const isTarget = (value: string) => ids.has(value) || value === graphEnd;
  const edges = options.edges.map((edge) => ({
    from: edge.from.trim(),
    to: edge.to.trim(),
  }));
  for (const edge of edges) {
    if (edge.from !== graphStart && !ids.has(edge.from)) {
      throw new Error(`Graph 边引用了未知起点：${edge.from}`);
    }
    if (!isTarget(edge.to)) throw new Error(`Graph 边引用了未知终点：${edge.to}`);
  }
  const startEdges = edges.filter((edge) => edge.from === graphStart);
  if (startEdges.length !== 1) {
    throw new Error("Graph 必须且只能包含一条从 graphStart 出发的边。");
  }
  const ordinarySources = new Set<string>();
  for (const edge of edges) {
    if (ordinarySources.has(edge.from)) {
      throw new Error(`Graph 确定性节点只能配置一条普通出边：${edge.from}`);
    }
    ordinarySources.add(edge.from);
  }

  const routes = [...(options.routes ?? [])];
  const routeSources = new Set<string>();
  for (const route of routes) {
    if (!ids.has(route.from)) throw new Error(`Graph 路由引用了未知节点：${route.from}`);
    if (routeSources.has(route.from)) throw new Error(`Graph 节点只能配置一个条件路由：${route.from}`);
    if (edges.some((edge) => edge.from === route.from)) {
      throw new Error(`Graph 节点不能同时配置普通出边和条件路由：${route.from}`);
    }
    if (route.targets.length === 0) throw new Error(`Graph 路由至少需要一个目标：${route.from}`);
    for (const target of route.targets) {
      if (!isTarget(target)) throw new Error(`Graph 路由引用了未知目标：${target}`);
    }
    routeSources.add(route.from);
  }
  const pauseAfter = [...(options.pauseAfter ?? [])];
  if (pauseAfter.length > 0 && !options.checkpointer) {
    throw new Error("Graph 配置暂停节点时必须提供 Checkpointer。");
  }
  for (const nodeId of pauseAfter) {
    if (!ids.has(nodeId)) throw new Error(`Graph 暂停配置引用了未知节点：${nodeId}`);
  }
  const stateAnchorNode = edges.find(
    (edge) => edge.to === graphEnd && edge.from !== graphStart,
  )?.from ?? nodes.at(-1)!.id;
  return { nodes, edges, routes, pauseAfter, stateAnchorNode };
}

/** 在已有线程上显式从 START 开始新一轮，避免误续跑暂停中的旧步骤。 */
async function invokeCheckpointedRun<TState extends object>(
  graph: {
    invoke(input: { value: TState } | null, config: ReturnType<typeof createThreadConfig>): Promise<InternalGraphState<TState>>;
    getState(config: ReturnType<typeof createThreadConfig>): Promise<{ values: Partial<InternalGraphState<TState>> }>;
    updateState(
      config: ReturnType<typeof createThreadConfig>,
      values: InternalGraphState<TState>,
      asNode?: string,
    ): Promise<unknown>;
  },
  input: InternalGraphState<TState>,
  config: ReturnType<typeof createThreadConfig> | undefined,
): Promise<InternalGraphState<TState>> {
  if (!config) throw new Error("Checkpoint Graph 调用缺少线程配置。");
  const snapshot = await graph.getState(config);
  if (snapshot.values.value === undefined) return graph.invoke(input, config);
  await graph.updateState(config, input, START);
  return graph.invoke(null, config);
}

/** 将公共开始边界转换为 LangGraph 内部节点常量。 */
function resolveSource(source: string): string {
  return source === graphStart ? START : source;
}

/** 将公共结束边界转换为 LangGraph 内部节点常量。 */
function resolveTarget(target: string): string {
  return target === graphEnd ? END : target;
}

/** 执行路由并拒绝未在声明目标集合中的动态跳转。 */
async function resolveRouteDecision<TState extends object>(
  route: GraphRoute<TState>,
  state: TState,
): Promise<string> {
  const target = await route.decide(state);
  if (!route.targets.includes(target)) {
    throw new Error(`Graph 路由 ${route.from} 返回了未声明目标：${target}`);
  }
  return resolveTarget(target);
}

/** 根据 Checkpointer 配置创建调用参数并校验 threadId。 */
function createInvokeConfig(checkpointed: boolean, threadId: string | undefined) {
  if (!checkpointed) return undefined;
  if (threadId === undefined) {
    throw new Error("启用 Checkpointer 的 Graph 调用必须提供 threadId。");
  }
  return createThreadConfig(threadId);
}
