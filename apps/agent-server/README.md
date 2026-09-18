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
| [runtime/codexConnections.ts](src/runtime/codexConnections.ts)                 | 按目标目录复用连接，关闭服务时回收进程                      |
| [runtime/sessionPolicy.ts](src/runtime/sessionPolicy.ts)                       | 统一新建与恢复的沙箱、审批和工具策略                        |
| [instructions/](src/instructions/)、[files/](src/files/)                       | 规则文件编辑与任务文件访问                                  |

建议按 `buildApp → 请求分发 → create/send/load → SessionEventHub.subscribe` 阅读。

## 会话与生命周期

- 服务就绪前先取得运行目录锁，再读取任务索引；同一运行目录只保留一个活动服务。锁记录使用实例唯一文件名，接管与释放只移走对应记录并移除空目录，避免并发接管误删后来者。创建服务对象时不会启动 Codex，需要时才建立连接。
- `taskId` 直接使用 Codex `thread.id`；一次任务可以包含多个 turn。同一目标目录的多个任务共享连接。
- 新建使用 `prepareD2C` 加载当前规则并准备输入，然后依次调用 `thread/start` 和 `turn/start`。
- 恢复使用 `prepareD2CRuntime` 准备工具配置，再调用 `thread/resume`。保留原会话规则，也不会重放输入。当前规则文件不可读时仍可准备恢复，但工具配置必须有效。
- 补充输入先读取原生状态；正在执行时调用 `turn/steer`，空闲时调用 `turn/start`。发送和停止操作按任务串行。
- 停止只中断指定 turn；取消订阅只断开当前客户端。关闭服务才统一释放连接。
- `sessions.json` 只保存任务 ID、项目路径、标题和更新时间。完整历史保存在 Codex，内存中的展示缓存供订阅快照使用。

## 工具策略

Server 先只读发现继承的桌面 MCP，再通过 `CodexClient` 的 `configOverrides` 在实际进程启动时禁用这些服务、桌面功能和桌面插件；新建与恢复线程携带相同限制，保留 MasterGo 和 Playwright。策略实现见 [computerUsePolicy.ts](src/runtime/computerUsePolicy.ts)。

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
