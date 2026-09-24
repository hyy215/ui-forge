# @ui-forge/codex-client

为 ui-forge 提供 Codex 接入：加载 MCP、D2C skill 和规则，准备输入，转发原生请求、事件与审批。设计理解、编码、审查、验证和子 Agent 调度由 Codex 完成。

Agent Server 通过本包为页面和 CLI 提供执行能力。需要 Node.js 22+、已登录的 Codex CLI；当前协议对应 **Codex 0.153.4**。环境准备见[根 README](../../README.md#准备后端)。

## 最小接入

`cwd` 指向已存在的目标项目。图片相对路径以该项目为基准；直接调用本包时，需要由宿主明确准备设计接入与目标上下文。

```ts
import { CodexClient, prepareTemporaryWorkspace } from "@ui-forge/codex-client";

const client = new CodexClient({ cwd: "/absolute/target-project" });
const temporaryDirectory = await prepareTemporaryWorkspace("/absolute/target-project");
const unsubscribe = client.subscribe((event) => {
  // notification：展示原生进度；request：展示审批或提问；close：连接结束。
});
const prepared = await client.prepareD2C({
  prompt: "根据设计图实现页面，并审查代码、验证交互",
  images: ["design.png"],
  designAccess: { kind: "local" },
  temporaryDirectory,
});
const { thread } = await client.request("thread/start", {
  ...prepared.thread,
  config: {
    ...prepared.thread.config,
    "sandbox_workspace_write.writable_roots": [temporaryDirectory],
  },
  sandbox: "workspace-write",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
});
await client.request("turn/start", { threadId: thread.id, input: prepared.input });
// 请求返回表示已受理；实际完成看 turn/completed 等原生事件。
```

`prepareD2C` 返回原生 `thread`、`input`，以及从本次实际读取并注入的规则内容计算的 `ruleFingerprints`（SHA-256）。指纹供宿主记录诊断元数据，不改变原生请求；直接调用 `request` 不会自动加载 D2C 配置。沙箱、审批和额外可写目录由调用方设置。

## 关键行为

- **规则**：`readInstructions` / `saveInstructions` 默认读写共享的 [design.md](instructions/design.md)、[project.md](instructions/project.md)；自定义路径须为绝对路径，失败直接报错。保存只影响新任务，同一线程保持原规则；规则不扩大权限。
- **恢复**：将 `prepareD2CRuntime({ temporaryDirectory })` 返回的运行配置用于 `thread/resume`，保留原会话规则，不启动新一轮。历史通过 `thread/read` 获取。
- **交互**：订阅 `request` 事件展示审批或提问，用 `respond(token, result)` 回传决议，`pendingRequests()` 获取待回复项。未知服务端请求明确拒绝。
- **停止与关闭**：`turn/interrupt` 停止指定轮次；取消订阅不停止任务。`close()`、宿主退出或 `signal` 取消会结束 Codex 进程。服务关闭时需同步清理连接。
- **超时**：`CodexTimeoutError` 表示等待超时，不会取消或重试任务。可通过 `requestId` 关联 `lateResponse`；没有迟到结果时，用原生线程查询确认执行状态。
- **临时产物**：默认使用安装根 `.ui-forge/runtime/tmp/<项目标识>/`。自定义 `temporaryDirectory` 须为已存在的绝对路径，可用 `prepareTemporaryWorkspace` 提前创建。
- **交付声明**：`deliveryContext(temporaryDirectory, taskId)` 提供任务隔离的报告位置、格式与证据边界，供宿主合并到每轮 `additionalContext`。它不写入文件、不运行验收、不扩大权限；`deliveryReportPath` 为宿主读取使用同一路径。新报告的文件证据必须包含实际 SHA-256；读取旧任务留下的裸路径证据时只标记为不可核验。报告声明与实际证据核对分开，接口不生成整体通过结论。

完整 API 见 [CodexClient](src/codexClient.ts) 和 [D2C 输入](src/d2c.ts)。

## 设计接入边界

产品层的来源是 `local` 或 `mastergo`，MasterGo 的连接方式再显式选择 `magic` 或 `vibe`。Figma 专用适配尚未实施，未来应作为独立来源扩展。本包不处理页面选择或持久化任务绑定；这些由 Agent Server 负责。

`prepareD2C` 与 `prepareD2CRuntime` 共用内部 `designAccess` 选项：

| 配置                          | 工具行为                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `{ kind: "local" }`           | 显式禁用 MasterGo 与 Vibe MCP，只使用图片或文字材料                                   |
| `{ kind: "magic" }`           | 使用包内官方远程 MCP 与既有凭据 helper，保留只读工具清单                              |
| `{ kind: "vibe", bridgeUrl }` | 禁用原 `mastergo`，另配置仅含 `read_design` 的 `ui_forge_vibe`，避免继承 Magic 请求头 |

省略 `designAccess` 保持旧版 Magic 行为，供没有设计绑定的历史任务和直接库调用兼容；产品的新建 local 任务会显式传入 local，不采用这个兼容默认。恢复时必须传回原绑定对应的接入，不能根据当前全局偏好重新选择。

[design/](src/design/) 使用标准 `@modelcontextprotocol/sdk`，提供：

- `parseMasterGoTarget(url)`：解析官方链接中的文件、节点及可选页面，不读取设计。
- `checkMagicConnection()`：使用既有 `MG_MCP_TOKEN` helper，连接固定官方 SSE 地址并读取工具清单；需要对应账号权益，不返回凭据。
- `checkVibeConnection({ endpoint, statusEndpoint })`：检查 MCP 握手、JSON 读取能力和当前文档/页面，返回白名单元数据；丢弃原生状态中的 Token 等其他字段。
- `startVibeReadOnlyBridge({ connection, target, projectDirectory, beforeRead })`：只监听本机，启动时不查询画布。宿主固定文档/页面/节点，通过 `beforeRead` 检查任务租约，并在读取前后核对画布身份；关闭时释放桥和上游连接。

Vibe 默认 MCP 地址为 `http://127.0.0.1:20678/mcp`，状态地址为 `http://127.0.0.1:30678/api/status`。仅接受无凭据的本机 HTTP 地址，拒绝重定向；无需个人 Token 不代表账号权益永久免费，也不自动安装或启动原生服务。

只读桥仅暴露空参数 `read_design`。它固定调用上游 `get_frontend_code` 的 `json` 格式、`writeToFile:false` 且不传 `outDir`，提取原始 JSON 后丢弃保存提示和 Markdown 标题；模型不能通过该工具选择其他目标、项目目录或导出格式。画布写入、删除、前端代码导出与截图保存工具均不转发。这个约束仅覆盖 MCP 工具暴露面，不替代 Codex 的沙箱、审批及已授权的 shell/network 权限。

## 配置与检查

本包的 [.codex/config.toml](.codex/config.toml) 配置 MasterGo、Playwright 和 Agent 角色，[D2C skill](.agents/skills/ui-forge-d2c/SKILL.md) 提供执行规则。包所在项目须被 Codex 信任，配置不可用时明确报错；目标项目无需复制这些文件。

`prepareD2C` 的新任务默认模型为 `gpt-6-astra`，可通过 `model` 覆盖；Agent Server 的 `UI_FORGE_CODEX_MODEL` 同样覆盖这一默认值，恢复旧任务不会重新选择模型。`prepareD2C` 还支持覆盖 `search` 和两份规则路径（`designInstructions`、`projectInstructions`），相对路径以目标项目为基准。`CodexClient` 用 `executable` 指定程序，用 `configOverrides` 传入 Codex `-c` 的点分键与标量值，不修改全局配置。Server 的限制见[工具策略](../../apps/agent-server/README.md#工具策略)。

在仓库根目录构建后检查配置或预览请求：

```sh
npm run build -w @ui-forge/codex-client
npm run check -w @ui-forge/codex-client -- --target /absolute/target-project
npm run dry-run -w @ui-forge/codex-client -- --target /absolute/target-project -i design.png "实现页面"
```

检查和预览只准备临时目录、启动通信进程，不创建任务、连接 MCP 或调用模型。`check` 报告配置与版本，`dry-run` 省略规则正文和 MCP 配置值。

平台连接检查使用 CLI `design-check`，不要与上述包配置 `check` 混淆；用法见[根 README](../../README.md#使用-cli)。第一方协议 23 的来源选择和交付查询由 Server/CLI/Extension 共同消费，本包仍只适配原生 Codex 与 MCP 协议。

真实验证与协议升级见[开发说明](../../DEVELOPMENT.md#codex-接入验证与协议升级)。
