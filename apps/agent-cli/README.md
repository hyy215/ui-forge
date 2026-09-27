# ui-forge CLI

CLI 和 VS Code 页面访问同一本地 Agent Server。它负责创建任务、连接已有任务和查询任务结果；执行与历史由 Codex 管理。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `doctor` | 检查 Codex 版本和登录状态 |
| `serve` | 前台启动本机 Agent Server |
| `run` | 创建并连接任务 |
| `design-check` | 只读检查设计连接 |
| `list` / `status` | 查看任务列表或状态 |
| `diagnostics` / `delivery` | 查询诊断摘要或交付结果 |
| `resume` | 连接任务；任务空闲时继续执行 |

使用 `npm run ui-forge -- --help` 查看全部命令，使用 `npm run ui-forge -- run --help` 查看创建任务的参数。

## 创建任务

图片或文字任务默认使用 `local`，MasterGo 任务必须显式选择 `magic` 或 `vibe`：

```bash
npm run ui-forge -- run \
  --target /absolute/path/to/target-project \
  --image ./design.png \
  -- "实现这个页面，支持搜索和重置"

npm run ui-forge -- run \
  --target /absolute/path/to/target-project \
  --design-source mastergo \
  --mastergo-connection magic \
  --design-url "<MasterGo 文件或图层链接>" \
  -- "实现这个页面"
```

Vibe 可用 `--vibe-endpoint` 和 `--vibe-status-endpoint` 指定本机地址。创建任务前可以运行：

```bash
npm run ui-forge -- design-check \
  --design-source mastergo \
  --mastergo-connection vibe \
  --design-url "<MasterGo 图层链接>"
```

`design-check` 只检查连接和目标，不创建任务、不读取设计正文，也不调用模型。设计来源和图片限制见根目录 [README](../../README.md#设计来源)。

CLI 的 `run` 当前接受一个 `--image`；VS Code 页面和后续消息最多可添加 4 张图片。Vibe 的两个地址必须是无凭据、无查询参数的本机 HTTP 地址。

## 交互与任务管理

运行任务时直接输入补充需求；使用 `/approve`、`/reject` 处理审批，使用 `/reply <token> <JSON>` 回答问题，使用 `/stop` 请求停止当前轮次。Ctrl-C 只断开 CLI，后台任务继续运行。

```bash
npm run ui-forge -- list
npm run ui-forge -- status TASK_ID
npm run ui-forge -- diagnostics TASK_ID --json
npm run ui-forge -- delivery TASK_ID --json
npm run ui-forge -- resume TASK_ID
```

`status` 读取任务快照，首次读取时可能按需装载或恢复 Codex 通信连接，但不会启动新的模型轮次；`diagnostics` 和 `delivery` 是只读查询，不会恢复线程或启动模型轮次。`resume` 在任务仍运行时连接任务，空闲时发送继续请求。交付结论和证据含义见 [任务交付与诊断](../../DEVELOPMENT.md#task-delivery)。

## 脚本模式

非 TTY 运行 `run` 或 `resume` 时必须使用 `--json`。stdout 输出 NDJSON 消息，类型为 `task`、`event`、`result`、`input-error` 或 `detached`。命令级错误写入 stderr 并以退出码 1 结束；会话内的无效 JSON、失效 token 或输入、审批、停止操作失败则通过 stdout 的 `input-error` 报告，连接继续，不自动重试。脚本需同时处理这两类错误。

`--` 后的文字作为需求文本。stdin 可发送 `input`、`reply` 和 `stop` 对象：

```json
{"type":"input","text":"增加状态筛选"}
{"type":"reply","token":"<token>","result":{"decision":"decline"}}
{"type":"stop","turnId":"<turn-id>"}
```

退出码表示命令或连接是否成功，不代表任务验收通过；脚本应检查 `delivery` 查询结果。

## 配置与开发

使用已登录的 Codex CLI。`UI_FORGE_CODEX_PATH` 指定可执行文件，`UI_FORGE_CODEX_MODEL` 指定新任务模型，`UI_FORGE_PORT` 指定本机服务端口；规则文件见 [design.md](../../packages/codex-client/instructions/design.md) 和 [project.md](../../packages/codex-client/instructions/project.md)。

源码调试、协议验证和完整测试方式见 [开发说明](../../DEVELOPMENT.md)。
