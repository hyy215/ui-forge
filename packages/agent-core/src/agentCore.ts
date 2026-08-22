/** 作为通用 Agent Core 唯一公共入口，暴露 Agent、工具与 LangGraph 运行时能力。 */

import type {
  Agent as AgentContract,
  AgentInput as AgentInputContract,
  AgentInvocationContext as AgentInvocationContextContract,
  AgentMessage as AgentMessageContract,
  AgentMessageContent as AgentMessageContentContract,
  AgentImageContent as AgentImageContentContract,
  AgentTextContent as AgentTextContentContract,
  AgentMessageRole as AgentMessageRoleContract,
  AgentResult as AgentResultContract,
  AgentSubagent as AgentSubagentContract,
  AgentSubagentFactory as AgentSubagentFactoryContract,
  AgentTool as AgentToolContract,
  AgentToolFactory as AgentToolFactoryContract,
  AgentTokenUsage as AgentTokenUsageContract,
} from "./agent/agent.js";
import {
  RestrictedDeepAgent,
  type ModelInvocationDiagnostic as ModelInvocationDiagnosticContract,
  type ModelDiagnosticReporter as ModelDiagnosticReporterContract,
  type ModelAgentOptions as ModelAgentOptionsContract,
} from "./deep-agent/restrictedDeepAgent.js";
import {
  createMemoryCheckpointer,
  type CheckpointThreadDisposer as CheckpointThreadDisposerContract,
  type Checkpointer as CheckpointerContract,
} from "./langgraph/checkpoint.js";
import {
  graphEnd,
  type Graph as GraphContract,
  type GraphEdge as GraphEdgeContract,
  type GraphInvokeOptions as GraphInvokeOptionsContract,
  type GraphNode as GraphNodeContract,
  type GraphOptions as GraphOptionsContract,
  type GraphRoute as GraphRouteContract,
  graphStart,
} from "./langgraph/graph.js";
import { createGraph } from "./langgraph/langGraph.js";

/** 提供不包含具体业务语义的通用 Agent Core Facade。 */
export class AgentCore {
  /** 禁止实例化仅提供静态能力的 Facade。 */
  private constructor() {}

  /** 创建禁用文件、Shell 与子 Agent 能力的 Deep Agent。 */
  static createRestrictedDeepAgent(options: AgentCore.ModelAgentOptions = {}): AgentCore.Agent {
    return new RestrictedDeepAgent(options);
  }

  /** 创建隐藏 LangGraph 实现细节的多节点通用状态图。 */
  static createGraph<TState extends object>(
    options: AgentCore.GraphOptions<TState>,
  ): AgentCore.Graph<TState> {
    return createGraph(options);
  }

  /** 表示通用状态图的开始边界。 */
  static readonly graphStart = graphStart;

  /** 表示通用状态图的结束边界。 */
  static readonly graphEnd = graphEnd;

  /** 创建适用于测试和无数据库运行的内存 Checkpointer。 */
  static createMemoryCheckpointer(): AgentCore.Checkpointer {
    return createMemoryCheckpointer();
  }
}

/** 为 AgentCore Facade 提供不产生额外运行时代码的公共类型命名空间。 */
export namespace AgentCore {
  /** 可供领域工作流复用的模型 Agent 端口。 */
  export type Agent = AgentContract;
  /** 单次 Agent completion 调用的消息输入。 */
  export type AgentInput = AgentInputContract;
  /** 由权威工作流绑定到单次 Agent 调用的不可自选上下文。 */
  export type AgentInvocationContext = AgentInvocationContextContract;
  /** Agent 对话中的结构化消息。 */
  export type AgentMessage = AgentMessageContract;
  /** Agent 消息允许组合的多模态内容块。 */
  export type AgentMessageContent = AgentMessageContentContract;
  /** 受控的内联图片消息块。 */
  export type AgentImageContent = AgentImageContentContract;
  /** 多模态消息中的文本块。 */
  export type AgentTextContent = AgentTextContentContract;
  /** Agent 对话支持的消息角色。 */
  export type AgentMessageRole = AgentMessageRoleContract;
  /** 单次 Agent completion 调用的结果。 */
  export type AgentResult = AgentResultContract;
  /** 模型供应商实际报告的 Token 使用量。 */
  export type AgentTokenUsage = AgentTokenUsageContract;
  /** 单次 Deep Agent 调用可委派的受限子 Agent。 */
  export type AgentSubagent = AgentSubagentContract;
  /** 根据权威上下文创建子 Agent 的工厂。 */
  export type AgentSubagentFactory = AgentSubagentFactoryContract;
  /** 单次调用中允许模型使用的受控结构化工具。 */
  export type AgentTool = AgentToolContract;
  /** 根据可信调用上下文创建任务绑定工具的工厂。 */
  export type AgentToolFactory = AgentToolFactoryContract;
  /** 创建受限 Deep Agent 所需的模型及工具配置。 */
  export type ModelAgentOptions = ModelAgentOptionsContract;
  /** 一次模型尝试允许进入安全日志的诊断字段。 */
  export type ModelInvocationDiagnostic = ModelInvocationDiagnosticContract;
  /** 模型调用诊断事件的宿主接收端口。 */
  export type ModelDiagnosticReporter = ModelDiagnosticReporterContract;
  /** 不暴露底层 LangGraph channel 的通用状态图。 */
  export type Graph<TState extends object> = GraphContract<TState>;
  /** 通用状态图中的领域节点。 */
  export type GraphNode<TState extends object> = GraphNodeContract<TState>;
  /** 连接节点或图边界的确定性有向边。 */
  export type GraphEdge = GraphEdgeContract;
  /** 根据状态选择下一节点的条件路由。 */
  export type GraphRoute<TState extends object> = GraphRouteContract<TState>;
  /** 创建通用状态图所需配置。 */
  export type GraphOptions<TState extends object> = GraphOptionsContract<TState>;
  /** 单次图调用使用的线程级配置。 */
  export type GraphInvokeOptions = GraphInvokeOptionsContract;
  /** Agent Core 接受的 LangGraph Checkpointer 端口。 */
  export type Checkpointer = CheckpointerContract;
  /** 清理工作流线程所需的最小 Checkpoint 端口。 */
  export type CheckpointThreadDisposer = CheckpointThreadDisposerContract;
}
