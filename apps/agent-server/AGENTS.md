# Agent Server 开发约定

本文件补充根目录 `AGENTS.md`，适用于 `apps/agent-server`。Server 是 HTTP/通信适配与运行时组合边界，不是 D2C 工作流状态所有者。

## 目录与文件职责

```text
src/
├── http/    Fastify 应用组装、健康检查和 shared-protocol 通信路由
├── d2c/     D2C 方法分发、流运行、事件投影、查询服务和运行时依赖装配
├── logging/ Workspace 身份解析和按任务归档的结构化通信日志
├── runtime/ 进程所有权、单实例锁和其他宿主生命周期能力
├── agentServer.ts 包唯一公共 Facade 类
└── main.ts        进程配置加载、监听启动和顶层失败处理
```

- 按稳定业务能力建立目录，不创建跨边界的 `utils`、`common` 或万能 Service。
- 每个独立子功能使用单独文件维护；应用组装、路由注册、通信请求执行、协议分发、流运行、事件投影、Artifact 查询和依赖工厂不得合并到同一文件。
- 测试文件与被测功能同目录并使用 `*.test.ts`。
- 不创建根目录或功能目录 `index.ts` 聚合导出。包外只公开 `AgentServer` Facade，内部模块通过明确文件路径引用实际功能；`main.ts` 只负责可执行启动，不作为公共 API。

## HTTP 与协议边界

- `http` 只负责 Fastify 生命周期、请求运行时校验、响应封装和状态码，不实现 D2C 状态迁移或直接调用外部 Adapter。
- 通信路由只注册端点、校验传输 Schema 和区分 notification/request；服务调用、计时、审计记录及响应构造由不依赖 Fastify 的 `CommunicationRequestHandler` 负责。
- Client 与 Server 之间的请求、响应和公开快照必须使用 `packages/shared-protocol`；不得在路由内重复声明通信结构。
- 路由通过注入的领域服务分发合法请求。通信错误保留 `requestId`，不把令牌、原始外部载荷或内部异常对象直接返回客户端。

## D2C 与依赖装配

- `D2CWorkflowService` 是协议到 D2C Agent 的薄门面，只做资源入口、Schema 校验和方法分发；长流运行、取消、领域进度投影和 Artifact 查询分别由独立应用对象承担。
- 快照 Presenter 只把 `D2CTask` 裁剪为 `D2CWorkflowSnapshot`，不执行状态迁移、外部读取或持久化。
- 环境变量、具体 Adapter、Provider 注册、Checkpointer、Artifact Store、Artifact Cleanup Worker 和 D2C Service 创建集中在 D2C 依赖工厂；其他 Server 文件不直接创建 MasterGo、Figma、Fixture、MCP 或 Agent 工具实现。
- 依赖通过 `AgentServer` 构造参数和显式工厂装配；当前依赖图较小且生命周期清晰，不引入 Inversify、Decorator 或全局容器隐藏依赖关系。
- D2C Agent 是任务生命周期和内部状态的唯一事实来源；Agent Core 提供通用 Agent 与 LangGraph 封装。除组合入口创建并管理公开 Checkpointer 实现外，Server 不依赖 LangGraph 内部 State 或节点，只依赖公开 Service 端口。
- 当前运行模式明确为同一 `UI_FORGE_RUNTIME_DIR` 内单活动 Server。Fastify 资源启动前必须取得原子进程锁，正常关闭时释放；崩溃遗留锁只在记录的本机 PID 已失效后接管。支持多活动实例前，不能仅依赖进程内 task Map，必须引入数据库级 revision CAS 或分布式租约。
- Fixture Provider 必须显式配置；可以使用引用白名单，也可以在本地联调组合入口绑定一个固定默认样本，使任意界面引用返回同一份模拟数据。客户端引用不得被解释为文件路径，默认生产运行时不得因测试便利自动切换到 Fixture。

## 日志与敏感信息

- Workspace 日志默认写入 `.ui-forge/logs`，可由组合入口通过 `UI_FORGE_LOG_DIR` 或显式构造参数调整；日志位置配置本身不进入记录。
- Git Workspace 使用移除认证信息、query 和 fragment 后的 `remote.origin.url` 作为身份；无 Git remote 时使用规范化绝对路径。目录名采用可读仓库名加身份摘要，避免 URL 或绝对路径造成目录逃逸和文件名长度问题。
- 同一任务的通信记录按月追加到 `<YYYY-MM>/<taskId>.jsonl`，超过文件上限后使用编号分段；`requestId` 保留在每条记录中用于单次调用追踪。只有尚未产生 `taskId` 的失败请求才使用 `<requestId>.jsonl`。日志按配置保留期定时清理，清理失败不得影响业务请求。
- 日志使用字段白名单，不序列化通信 `params`、环境变量、请求头、Adapter 配置、原始外部载荷或异常消息。API Key、Token、Cookie、Authorization 和带认证信息的 remote 不得落盘。
- 设计 Artifact 浏览请求只记录方法、任务与调用结果，不记录索引或原始 Section 响应内容。
