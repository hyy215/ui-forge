# @ui-forge/agent-server

为 VS Code 页面与 CLI 提供共用的本机会话服务。通过 `codex-client` 托管 Codex 连接、转发操作和事件，执行历史与任务状态以 Codex 为准。

本包开发约束见 [AGENTS.md](AGENTS.md)，通用开发与验证要求见[根目录约定](../../AGENTS.md)。

## 阅读入口

| 模块                                                                           | 职责                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| [agentServer.ts](src/agentServer.ts)、[main.ts](src/main.ts)                   | 公共入口、监听与退出                                        |
| [http/buildApp.ts](src/http/buildApp.ts)                                       | 装配依赖、注册 HTTP 路由、管理运行目录锁                    |
| [http/communicationRequestHandler.ts](src/http/communicationRequestHandler.ts) | 校验参数，将第一方方法分发给服务                            |
| [sessions/sessionService.ts](src/sessions/sessionService.ts)                   | 创建、恢复、读取、补充输入、停止和回复                      |
| [sessions/sessionEventHub.ts](src/sessions/sessionEventHub.ts)                 | 父子线程事件路由、展示缓存与客户端订阅                      |
| [sessions/sessionViewCache.ts](src/sessions/sessionViewCache.ts)               | 复用 client-core 归并展示副本，保留重连所需的活动与审批预览 |
| [sessions/sessionIndex.ts](src/sessions/sessionIndex.ts)                       | 持久化任务身份与导航信息                                    |
| [runtime/codexConnections.ts](src/runtime/codexConnections.ts)                 | 按目标目录与设计接入范围复用连接，关闭服务时回收进程        |
| [design/](src/design/)                                                         | 只读连接检查、冻结设计来源和 Vibe 实例占用保护              |
| [runtime/sessionPolicy.ts](src/runtime/sessionPolicy.ts)                       | 统一新建与恢复的沙箱、审批和工具策略                        |
| [instructions/](src/instructions/)、[files/](src/files/)                       | 规则文件编辑与任务文件访问                                  |

建议按 `buildApp → 请求分发 → create/send/load → SessionEventHub.subscribe` 阅读。

## 会话与生命周期

- 服务就绪前先取得运行目录锁，再读取任务索引；同一运行目录只保留一个活动服务。锁记录使用实例唯一文件名，接管与释放只移走对应记录并移除空目录，避免并发接管误删后来者。创建服务对象时不会启动 Codex，需要时才建立连接。
- `taskId` 直接使用 Codex `thread.id`；一次任务可以包含多个 turn。连接按 `cwd + profile` 隔离：同一目标目录内，local 与 Magic 分别共享连接，每个 Vibe 绑定使用独立 profile，避免恢复工具配置影响其他任务；一个连接关闭不会清除其他 profile 的展示缓存或订阅。
- 新建使用 `prepareD2C` 加载当前规则并准备输入，然后依次调用 `thread/start` 和 `turn/start`。
- 恢复使用 `prepareD2CRuntime` 准备工具配置，再调用 `thread/resume`。保留原会话规则，也不会重放输入。当前规则文件不可读时仍可准备恢复，但工具配置必须有效。
- 补充输入先读取原生状态；正在执行时调用 `turn/steer`，空闲时调用 `turn/start`。发送和停止操作按任务串行。
- 停止只中断指定 turn；取消订阅只断开当前客户端。关闭服务才统一释放连接。
- `sessions.json` 只保存任务 ID、项目路径、标题、更新时间和固定设计绑定。完整历史保存在 Codex，内存中的展示缓存供订阅快照使用。

## 设计来源绑定

`ui-forge.design.check` 只检查显式选择的来源和连接，不创建任务、不声明占用，也不返回设计正文。来源为 `local` 或 `mastergo`；local 图片/文字不查询平台、不启用 MasterGo，MasterGo 必须显式选择 Magic 或 Vibe。Figma 专用适配尚未实施，后续应扩展为独立来源。

新建检查成功后在 `sessions.json` 的 `designBinding` 中保存来源、接入方式、绑定 ID 与目标身份。Vibe 必须包含文档、页面和节点；后续恢复沿用该绑定，没有绑定的历史任务继续使用 Magic。绑定是配置元数据，不取代 Codex 执行历史。

Magic 使用官方远程 MCP 和 `MG_MCP_TOKEN`，需要相应设计访问权限及账号 MCP 服务权益。Vibe 连接已有本机服务，默认 MCP 为 `http://127.0.0.1:20678/mcp`，状态地址为 `http://127.0.0.1:30678/api/status`；无需个人 Token，但不承诺账号权益永久免费。

同一个 Vibe 原生实例的创建和继续操作串行检查其他任务的原生 `thread/read` 状态；租约按状态服务身份归一化，不因多个 MCP 桥端口而分裂。原生线程活动或轮次仍在运行时拒绝占用，无法读取历史时也不抢占。客户端断开不释放资源；后续任务必须先确认原任务已不活动。启动结果不确定时先终止对应的独立 Vibe 连接，避免超时后迟到启动与新任务重叠。

受限桥由 `codex-client` 使用标准 MCP SDK 提供，只向 Codex 暴露空参数 `read_design`。目标、项目目录和格式由宿主固定；上游只读取 JsonDom（`json`、`writeToFile:false`、无 `outDir`），返回原始 JSON 并丢弃保存提示，不开放画布写删、前端代码导出或截图保存。桥在读取前后核对任务使用权和当前文档/页面，拒绝失效绑定。

继续执行时重新核对固定文件、页面和节点；查看历史、诊断与停止任务不检查画布。服务重启后从保存的绑定与原生状态重新判断占用，不持久化第二套执行状态。

## 只读诊断

`ui-forge.diagnostics.read` 先检查任务属于本地索引，再直接读取原生 `thread/read` 历史，并按根线程读取其子线程摘要，不经过 `load`、`thread/resume` 或 `turn/start`。建立通信连接仍可能启动 Codex 进程和只读配置探测；原生历史读取失败直接报告，不为生成诊断改走恢复流程。

[diagnostics/](src/diagnostics/) 将历史投影为严格白名单报告。状态、轮次和工具耗时来自原生字段，不解析自然语言推断验收结果；相同轮次/工具身份去重，工具并行耗时不能代替轮次耗时。报告不含规则全文、命令正文或输出、MCP 服务名或参数、文件补丁、工作区路径、审批 token 和原始异常正文。

只有不能从历史重建的数据独立保存到运行目录的 `diagnostics/`：新任务实际注入规则的 SHA-256、Codex 可执行文件/CODEX_HOME/service tier、并发配置与观测峰值，以及最后收到的本线程原生累计 Token 和线程运行摘要。文件名由任务身份哈希生成，原子串行写入；重复 Token 通知覆盖而非累加，不汇总子线程用量。报告仅导出线程 ID、父线程关系、模型、推理强度、状态和固定错误类别，不保存提示词、命令正文、工具输出、审批 token 或原始异常正文。服务关闭时等待待写入项完成。旧任务缺失信息保持未知；读写失败在报告中标记诊断不完整，不改变任务或审批状态。已有损坏文件不自动覆盖。

公共通信协议 22 包含 `task-diagnostics` 与 `design-source-selection` 能力，Server、CLI 和 Webview/Extension 应同步更新。

## 工具策略

Server 先只读发现继承的桌面 MCP，再通过 `CodexClient` 的 `configOverrides` 在实际进程启动时禁用这些服务、桌面功能和桌面插件；新建与恢复线程携带相同限制。内置设计工具由固定来源决定：local 禁用内置 MasterGo 接入，Magic 使用官方连接，Vibe 只使用受限读桥；保留 Playwright 验证能力。这不表示禁用了用户所有全局 MCP。策略实现见 [computerUsePolicy.ts](src/runtime/computerUsePolicy.ts)。

Vibe 显式禁用原 `mastergo` 条目，使用独立的 `ui_forge_vibe` 条目，避免深合并继承 Magic 凭据；local 显式禁用二者。MCP SDK 与只读桥不是权限沙箱，不扩大或取代 Codex 原有的 shell/network 权限、沙箱和审批策略。

新建与恢复使用相同的临时产物目录配置，每轮通过 `temporaryWorkspaceContext` 补充产物路径上下文，保留原会话的设计与工程规则。沙箱、审批和可写目录统一由 [sessionPolicy.ts](src/runtime/sessionPolicy.ts) 设置。

## 通信与验证

客户端经 `POST /api/communication` 调用 `shared-protocol` 中定义的方法。普通请求返回 JSON，订阅返回首条快照、快照边界前保留的计划/差异/子线程活动，再持续发送新事件；每个连接重新分配 `seq`。展示归并与客户端共用 `client-core`，不再维护另一套归并实现。HTTP 和监听地址使用同一套本机回环校验。

[sessionService.test.ts](src/sessions/sessionService.test.ts) 验证共享连接、恢复、指定轮次停止和审批；[sessionEventHub.test.ts](src/sessions/sessionEventHub.test.ts) 对照页面事件处理，在多个重连位置验证快照与持续接收的会话内容一致。HTTP 地址校验见 [buildApp.hostPolicy.test.ts](src/http/buildApp.hostPolicy.test.ts)。

在仓库根目录按改动范围运行类型检查和相关测试：

```bash
npm run typecheck -w @ui-forge/agent-server
npm run test -- apps/agent-server/src
```

运行与调试见根目录 [README](../../README.md) 和 [开发说明](../../DEVELOPMENT.md)。
