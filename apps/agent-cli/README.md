# ui-forge CLI

CLI 和页面访问同一本地 Agent Server，执行与历史由 Codex 管理。`doctor` 检查版本和登录，`serve` 前台运行服务，`run` 创建并连接任务，`list` 列出最近任务，`status` 读取原生快照，`diagnostics` 读取白名单诊断摘要，`delivery` 只读查看交付声明与证据核对，`resume` 重连原任务；空闲时 `resume` 会明确发送继续请求。

```bash
npm run ui-forge -- doctor
npm run ui-forge -- run --target /absolute/app --image ./design.png -- "支持搜索与重置"
npm run ui-forge -- run --target /absolute/app --design-source mastergo --mastergo-connection magic --design-url "https://mastergo.com/file/<file>?layer_id=<node>" -- "实现页面"
npm run ui-forge -- design-check --design-source mastergo --mastergo-connection vibe --design-url "https://mastergo.com/file/<file>?layer_id=<node>&page_id=<page>" --json
npm run ui-forge -- status <task-id>
npm run ui-forge -- diagnostics <task-id>
npm run ui-forge -- diagnostics <task-id> --json
npm run ui-forge -- delivery <task-id>
npm run ui-forge -- delivery <task-id> --json
npm run ui-forge -- resume <task-id>
```

使用 `npm run ui-forge -- --help` 查看全部命令，使用 `npm run ui-forge -- run --help` 或 `npm run ui-forge -- help run` 查看某个命令的参数与示例。`--json` 可放在命令前后；来源与接入参数适用于 `run` 和只读 `design-check`，`--image` 仅适用于 `run`。未知参数和多余的位置参数会报错。`--` 之后的文字按需求文本处理。

图片或文字任务默认 `--design-source local`，不接入设计平台。MasterGo 链接必须显式选择 `--design-source mastergo` 及 `--mastergo-connection magic|vibe`；链接按结构化来源保存，不混入需求文字。Magic 不能搭配 Vibe 地址参数。Vibe 默认 MCP 地址为 `http://127.0.0.1:20678/mcp`，状态地址为 `http://127.0.0.1:30678/api/status`，可分别用 `--vibe-endpoint` 和 `--vibe-status-endpoint` 修改为无凭据的本机 HTTP 地址。`design-check` 只检查连接与目标，不创建、读取或恢复任务，也不会发起模型执行。

输入文字补充需求，运行中使用 Codex `turn/steer`，空闲时创建下一轮。`/approve`、`/reject` 只处理唯一待确认的命令或文件审批；多个请求或其他类型使用 `/reply <token> <JSON>`。例如回答问题：

```text
/reply <token> {"answers":{"<question-id>":{"answers":["20 条"]}}}
```

交互终端中的 `/status` 只查看本地已收到的记录，不发送网络查询或模型请求，也不会定时输出；即使上一条操作仍在等待响应，也可查看。它显示当前运行、等待请求或终态，以及原生轮次耗时、本连接最近主线程事件的接收时间和最后观测的主线程累计 Token；未知数据保持未知。首个订阅快照到达前和连接中断后只显示最近记录，不推算运行中轮次的实时耗时。最近事件不等于有效进展，累计 Token 不等于本轮用量、费用或预算，也不累加重复通知或子线程用量。断线重连后的 Token 须等待本连接重新观测。它不同于上方会访问服务的 `ui-forge status <task-id>`。

`/stop` 请求中断当前轮次；“停止请求已提交，等待原生状态确认”仅表示请求已被接受，实际状态仍以原生通知为准。失败时显示操作未确认，不自动重发。Ctrl-C 只断开 CLI，其他页面和任务继续运行。服务关闭时其 Codex 进程也关闭；重启后装载原生历史，不重放此前输入或决议。

交互终端在失败后分别显示原因、处理建议和已有错误详情，并给出当前任务的 `status`、`diagnostics`、`delivery` 查询命令；没有具体错误时不会猜测原因。中断与失败分开提示。快照摘要只统计历史中有记录的成功退出命令和已完成文件变更，不代表验收通过或文件现在仍保持该状态。

连接中断不会自动重试，先查看原任务再决定后续操作。`resume` 不是只读重连：任务仍运行时连接原任务，空闲时发送继续请求。与当前主线程、当前轮次匹配的原生重试通知仅显示“Codex 正在重试”，不会触发额外请求或提前结束 CLI。审批回执“决议已提交”不代表任务停止或操作已经执行；回复失败时保留未确认状态，不自动重发。

人类可读的会话、错误和交付输出会过滤 ANSI/OSC 及终端控制字符；JSON 中的原始字段仍按现有协议保留，供脚本自行处理。这是终端显示防护，不是敏感内容脱敏。

## 脚本接口

非 TTY 运行 `run` / `resume` 必须使用 `--json`。stdout 为 NDJSON，输出 `task`、`event`、`result`、`input-error` 或 `detached`；`event` 包含原生通知、待处理请求和连接消息。错误输出到 stderr。`status --json` 返回一个原生会话快照。

NDJSON 输入不支持 `/status` 简写；直接输入该文本仍返回 `input-error`，不会发送任务输入或新增状态事件。

`diagnostics --json` 向 stdout 输出一个版本化诊断报告，适用于保存或脚本处理；失败时只向 stderr 输出错误，不导出部分报告。它不发送继续请求、不恢复线程或重放输入，必要时可启动本地服务和通信进程。与 `status --json` 不同，诊断报告不会包含完整会话、提示词、路径、工具输入输出和原始错误正文。

诊断中的运行信息包含实际 Codex 可执行文件、`CODEX_HOME`、service tier、并发配置及当前/峰值观测；无法从历史恢复的字段为 `null`。`agents` 提供主线程和子线程的 ID、父子关系、模型、推理强度、状态和固定错误类别，不包含正文。规则指纹只对应任务创建时实际注入的规则，旧任务可能未知。Token 仅包含最后采集的本线程原生累计值，缺失时为 `null`，不等于零；不将子任务用量另行相加。时间字段 `startedAt` / `completedAt` 保留原生值，耗时字段明确以 `Ms` 为单位。工具已知耗时可以重叠，不能当作任务总耗时。报告中的执行状态和错误类别不是验收结论。

`delivery --json` 向 stdout 输出一个版本化交付查询结果；普通输出逐项显示报告声明、源码和证据核对结果。查询不启动模型、不恢复轮次、不运行构建或浏览器检查；必要时可启动本地服务及通信进程。读取错误只写入 stderr，不导出部分结果，也不自动重试任务。

- `availability` 区分报告可用（`available`）、尚未生成（`missing`）和无效（`invalid`）；无报告不能推断验收通过。
- 每项 `declaredStatus` 是报告作者声明的 `passed`、`failed`、`blocked` 或 `not-verified`，不是服务端独立验收结论。`report.generatedAt` 是报告声明的生成时间；`checkedAt` 是本次服务核对时间。
- `source.state: matches` 仅表示报告中所列源码文件指纹一致，不代表完整项目未变化；`stale` 表示需重新验证；`unverifiable` 表示不能确认一致。
- 文件证据 `matched` 只证明 SHA-256 一致；原生工具证据 `succeeded` 只证明相应工具执行完成。缺失、读取失败、未完成和历史不可用等状态会保留，不能据此推导业务或视觉验收通过。

交付 JSON 不等同于诊断白名单导出：它包含报告摘要、检查说明及相关文件路径，分享前请检查其中的项目内容。

stdin 每行一个对象，token 和 turn ID 来自当前会话：

```json
{"type":"input","text":"增加状态筛选"}
{"type":"reply","token":"<token>","result":{"decision":"decline"}}
{"type":"reply","token":"<token>","result":{"answers":{"<question-id>":{"answers":["回答"]}}}}
{"type":"stop","turnId":"<turn-id>"}
```

回复体由 `codex-client` 按对应的原生 Schema 校验。失效或其他任务的 token 会被拒绝；没有自动批准开关。stdin 关闭不等于停止任务，审批也可由页面处理。

退出码 0 表示查询成功、本轮正常结束或正常断开，1 表示错误、失败或中断。交付查询返回缺失或无效报告时也可能正常结束；退出码不代表验收通过，应检查交付字段及实际证据。

## 配置与数据

使用已登录的 Codex CLI，当前协议对应 0.153.4。`UI_FORGE_CODEX_PATH` 指定可执行文件，`UI_FORGE_CODEX_MODEL` 配置新任务模型。规则与页面共用 [design.md](../../packages/codex-client/instructions/design.md)、[project.md](../../packages/codex-client/instructions/project.md)。

本地服务默认监听 `127.0.0.1:4310`，可配置 `UI_FORGE_PORT`。任务索引与上传图片保存在 `UI_FORGE_RUNTIME_DIR`（默认 `.ui-forge/runtime`），相对路径以安装根解析；后台服务日志写入 `.ui-forge/server.log`。正文与执行历史由 Codex 保存。

诊断元数据在同一运行目录独立保存，只记录规则指纹、运行时定位、并发观测、线程摘要和 Token 数值等无法从历史补回的信息，不参与任务执行或审批。读写失败会在报告中标记缺口，不触发任务重试。当前通信协议 23 支持诊断、显式设计来源和独立交付查询；Server、CLI 与 VSIX 使用一致的协议版本。

## 开发

命令由 Commander 管理，每个业务命令的参数、帮助和处理逻辑放在 `src/commands/` 下的独立文件中，并在 `src/cli.ts` 注册。新增或修改命令时，同步更新使用说明和对应测试。
