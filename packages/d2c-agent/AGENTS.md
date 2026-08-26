# D2C Agent 开发约定

本文件补充根目录 `AGENTS.md`，适用于 `packages/d2c-agent`。该包组合 `agent-core` 的通用 Graph 能力，持有 D2C 领域任务和设计读取工作流。

## 目录与文件职责

```text
src/
├── design-context/    平台无关设计模型、Artifact 端口和 Provider 路由
├── graph/             D2C Graph、状态以及按节点职责组织的实现
│   └── nodes/
│       ├── inspect-design/
│       ├── inspect-project/
│       ├── resolve-design-system-catalog/
│       ├── recognize-design-components/
│       ├── analyze-project-context/
│       └── plan/
├── planning/          审阅方案、可演进 Plan、人工锁、Delta 合并与 Review 契约
├── code-generation/   受控源码快照端口、受限 Code Agent 与结构化候选 Patch
├── d2cTask.ts         两阶段权威任务状态
├── d2cCommand.ts      修改任务的领域命令
├── d2cService.ts      包对外的 D2C Service
└── d2cAgent.ts        公共 Facade 与类型命名空间
```

- 一个简单节点使用单文件；节点包含提示词、解析器或工具等多个职责时使用同名目录。
- 不建立 `task`、`service`、`tools` 等只按技术角色分组的万能目录。领域工具与使用它的节点放在一起。
- 暂未实现的反馈传输、Patch 受控应用、执行验证和交付阶段只允许保留明确边界，不接入 Graph、协议或 UI；候选 Patch 生成必须绑定当前 Plan 与文件哈希，并明确保持未应用状态。
- 测试与被测功能同目录。包外消费者只使用 `D2CAgent.createService` 和 `D2CAgent.*` 领域类型。

## 状态与依赖边界

- `D2CService` 是业务入口，负责命令校验、乐观并发和 Artifact 生命周期协调；它不等同于 Graph。
- `D2CAgent` 公共 Facade 只暴露 `createService`；Provider Resolver 由 Service 内部装配，不向宿主泄漏实现零件。
- D2C Graph 只负责节点拓扑与状态转换。每个 Service 只创建一个共享 Graph，不为不同命令或任务重复编译 Graph；任务 UUID 作为 `thread_id` 隔离 Checkpoint。
- 当前 Graph 在设计确认暂停点后按固定顺序执行项目检查、版本化设计系统目录解析、组件候选提取、受控仓库上下文分析和 Plan DeepAgent；在 Plan 暂停点等待用户明确确认后，恢复受控文件读取和 Code Agent 候选 Patch 生成。仅对不支持的项目使用声明目标集合的条件路由提前结束，不使用 action 分发节点或伪条件路由。反馈修订、Patch 应用和验证尚未接入 Graph。
- 本包只依赖 `agent-core` 的公开 Agent、Graph 与 Checkpointer 契约，不直接导入 LangGraph 第三方内部 API。
- 本包不依赖 MasterGo/Figma/Ant Design 的具体实现、MCP、环境变量、HTTP、VS Code、Webview、Storage 实现或 `shared-protocol`；版本化设计系统知识通过领域端口注入。
- 依赖通过工厂参数显式注入；当前不引入 Inversify 等 DI 容器。

## D2C 领域与测试

- 设计来源使用稳定的 `provider + reference`，由 `DesignContextResolver` 路由到注册的 Adapter。
- 原始设计载荷通过 `DesignArtifactWriter` 保存，任务状态只持有轻量引用。
- 同一 taskId 的 Graph 执行与任务提交必须串行，避免 reset 或其他命令与节点完成结果互相覆盖。
- 至少覆盖设计读取、revision 冲突、重置、Artifact 生命周期和不安全 SVG 拒绝。
