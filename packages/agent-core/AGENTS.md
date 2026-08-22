# Agent Core 开发约定

本文件补充根目录 `AGENTS.md`，适用于 `packages/agent-core`。Agent Core 是领域无关的 Agent、Deep Agent 与 LangGraph 基础能力包，不持有 D2C 任务状态或设计语义。

## 目录与文件职责

```text
src/
├── agent/             供应商无关的 Agent、消息、调用上下文与工具端口
├── deep-agent/        受限 Deep Agent 实现、模型配置和工具适配
├── langgraph/         封装多节点 Graph、条件路由、Checkpointer 和线程状态的适配层
└── agentCore.ts       包唯一公共 Facade 类与类型命名空间
```

- 通用能力不得出现 `DesignContext`、`DeliveryTask`、Planning、MasterGo 或其他 D2C 领域概念。
- `langgraph` 对领域包隐藏 `StateGraph`、`Annotation`、节点常量、状态 channel 和线程配置，通过统一的 `Graph` 契约提供节点、边、条件路由、循环及可选 Checkpointer；不原样转发第三方 API。
- 每个独立能力使用单独文件维护，测试与被测功能放在同一目录并使用 `*.test.ts`。
- 不创建目录 `index.ts` 聚合导出。包外消费者只通过 `AgentCore` Facade 使用静态工厂和 `AgentCore.*` 类型。

## Agent 与工具边界

- Agent 只消费结构化消息和由可信工作流绑定的调用上下文，不解析具体业务命令。
- Deep Agent 默认禁用文件、Shell、网络扩张和子 Agent 能力；领域工具通过 `AgentToolFactory` 显式注入，通用实现不得自行创建 D2C 工具。
- 模型供应商、模型名、密钥和端点由组合入口注入；Agent Core 不读取环境变量，不依赖 Server、Adapter、Storage、HTTP、VS Code 或 `shared-protocol`。
- 依赖使用静态工厂参数和构造函数显式注入，不使用 Inversify、Decorator、全局 Service Locator 或隐藏容器。

## LangGraph 与测试

- 通用 LangGraph 封装不得持有领域状态、任务 Map 或第二份事实来源；领域包不得绕过该层直接依赖 LangGraph。
- `Graph` 节点只返回状态增量，确定性步骤使用普通边，分支和循环使用声明目标集合的条件路由；需要人工确认的固定路径使用通用暂停/恢复能力，不用伪条件边模拟。持久化图调用必须显式绑定 `threadId`，不应改变权威状态的能力节点可在同一拓扑上显式跳过 Checkpoint。
- 输入边界应覆盖空值和无效配置；受限 Agent 应覆盖禁用能力及领域工具按调用上下文隔离的行为。
