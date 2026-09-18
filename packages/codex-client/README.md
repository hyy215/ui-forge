# @ui-forge/codex-client

为 ui-forge 提供 Codex 接入：加载 MCP、D2C skill 和规则，准备输入，转发原生请求、事件与审批。设计理解、编码、审查、验证和子 Agent 调度由 Codex 完成。

Agent Server 通过本包为页面和 CLI 提供执行能力。需要 Node.js 22+、已登录的 Codex CLI；当前协议对应 **Codex 0.153.4**。环境准备见[根 README](../../README.md#准备后端)。

## 最小接入

`cwd` 指向已存在的目标项目。图片相对路径以该项目为基准，设计链接直接写入 `prompt`。

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

`prepareD2C` 返回原生 `thread`、`input`；直接调用 `request` 不会自动加载 D2C 配置。沙箱、审批和额外可写目录由调用方设置。

## 关键行为

- **规则**：`readInstructions` / `saveInstructions` 默认读写共享的 [design.md](instructions/design.md)、[project.md](instructions/project.md)；自定义路径须为绝对路径，失败直接报错。保存只影响新任务，同一线程保持原规则；规则不扩大权限。
- **恢复**：将 `prepareD2CRuntime({ temporaryDirectory })` 返回的运行配置用于 `thread/resume`，保留原会话规则，不启动新一轮。历史通过 `thread/read` 获取。
- **交互**：订阅 `request` 事件展示审批或提问，用 `respond(token, result)` 回传决议，`pendingRequests()` 获取待回复项。未知服务端请求明确拒绝。
- **停止与关闭**：`turn/interrupt` 停止指定轮次；取消订阅不停止任务。`close()`、宿主退出或 `signal` 取消会结束 Codex 进程。服务关闭时需同步清理连接。
- **超时**：`CodexTimeoutError` 表示等待超时，不会取消或重试任务。可通过 `requestId` 关联 `lateResponse`；没有迟到结果时，用原生线程查询确认执行状态。
- **临时产物**：默认使用安装根 `.ui-forge/runtime/tmp/<项目标识>/`。自定义 `temporaryDirectory` 须为已存在的绝对路径，可用 `prepareTemporaryWorkspace` 提前创建。

完整 API 见 [CodexClient](src/codexClient.ts) 和 [D2C 输入](src/d2c.ts)。

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

真实验证与协议升级见[开发说明](../../DEVELOPMENT.md#codex-接入验证与协议升级)。
