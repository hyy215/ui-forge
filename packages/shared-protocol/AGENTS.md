# Shared Protocol 开发约定

本文件补充根目录 `AGENTS.md`，适用于 `packages/shared-protocol`。该包是 Client 与 Agent Server 间可序列化通信契约的唯一来源，不承载应用内部状态或传输实现。

## 功能边界

- 按功能域组织公共协议。同一功能的 Zod Schema、由 `z.infer` 推导的类型、常量和消息构造函数放在同一功能目录中；不同功能不得继续堆放到单个公共文件中。
- 所有 `index.ts` 只作为导出入口，不直接声明 Schema、类型、变量、函数或类。功能实现使用能够表达职责的文件名，例如 `sessions/sessionProtocol.ts`、`instructions/instructionProtocol.ts` 和 `communication/transportProtocol.ts`。
- 按会话、规则配置和传输拆分协议文件；原生消息保留 Codex 字段，完整原生协议校验由 codex-client 负责。不定义 D2C 执行阶段或第二套任务状态。
- 功能测试与对应协议模块放在同一功能目录，避免由根入口测试文件集中覆盖无关功能。
- 跨功能引用使用明确的模块依赖并避免循环依赖；只有真正被多个功能共享的基础契约才提升为独立公共模块。

## 协议定义

- 该包不维护仅为代码复用而共享的普通 TypeScript 类型；不参与 Client 与 Agent Server 通信的类型由所属应用或能力包维护。
- 请求、响应、通知和事件公开的任务状态与展示数据属于通信协议；Server 和客户端内部状态不得放入该包。
- 消息构造函数负责生成符合对应 Schema 的规范对象，不使用类型断言掩盖不完整数据。
- 该包不实现超时、取消、响应校验等调用端行为；客户端调用接口和传输适配由对应应用维护，需要跨多个客户端复用时再提取为独立客户端包。
