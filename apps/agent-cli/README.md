# ui-forge CLI

CLI 和页面访问同一本地 Agent Server，执行与历史由 Codex 管理。`doctor` 检查版本和登录，`serve` 前台运行服务，`run` 创建并连接任务，`list` 列出最近任务，`status` 读取原生快照，`diagnostics` 读取白名单诊断摘要，`resume` 重连原任务；空闲时 `resume` 会明确发送继续请求。

```bash
npm run ui-forge -- doctor
npm run ui-forge -- run --target /absolute/app --image ./design.png -- "支持搜索与重置"
npm run ui-forge -- run --target /absolute/app --design-source mastergo --mastergo-connection magic --design-url "https://mastergo.com/file/<file>?layer_id=<node>" -- "实现页面"
npm run ui-forge -- design-check --design-source mastergo --mastergo-connection vibe --design-url "https://mastergo.com/file/<file>?layer_id=<node>&page_id=<page>" --json
npm run ui-forge -- status <task-id>
npm run ui-forge -- diagnostics <task-id>
npm run ui-forge -- diagnostics <task-id> --json
npm run ui-forge -- resume <task-id>
```

使用 `npm run ui-forge -- --help` 查看全部命令，使用 `npm run ui-forge -- run --help` 或 `npm run ui-forge -- help run` 查看某个命令的参数与示例。`--json` 可放在命令前后；来源与接入参数适用于 `run` 和只读 `design-check`，`--image` 仅适用于 `run`。未知参数和多余的位置参数会报错。`--` 之后的文字按需求文本处理。

图片或文字任务默认 `--design-source local`，不接入设计平台。MasterGo 链接必须显式选择 `--design-source mastergo` 及 `--mastergo-connection magic|vibe`；链接按结构化来源保存，不混入需求文字。Magic 不能搭配 Vibe 地址参数。Vibe 默认 MCP 地址为 `http://127.0.0.1:20678/mcp`，状态地址为 `http://127.0.0.1:30678/api/status`，可分别用 `--vibe-endpoint` 和 `--vibe-status-endpoint` 修改为无凭据的本机 HTTP 地址。`design-check` 只检查连接与目标，不创建、读取或恢复任务，也不会发起模型执行。

输入文字补充需求，运行中使用 Codex `turn/steer`，空闲时创建下一轮。`/approve`、`/reject` 只处理唯一待确认的命令或文件审批；多个请求或其他类型使用 `/reply <token> <JSON>`。例如回答问题：

```text
/reply <token> {"answers":{"<question-id>":{"answers":["20 条"]}}}
```

`/stop` 中断当前轮次。Ctrl-C 只断开 CLI，其他页面和任务继续运行。服务关闭时其 Codex 进程也关闭；重启后装载原生历史，不重放此前输入或决议。

## 脚本接口

非 TTY 运行 `run` / `resume` 必须使用 `--json`。stdout 为 NDJSON，输出 `task`、`event`、`result`、`input-error` 或 `detached`；`event` 包含原生通知、待处理请求和连接消息。错误输出到 stderr。`status --json` 返回一个原生会话快照。

`diagnostics --json` 向 stdout 输出一个版本化诊断报告，适用于保存或脚本处理；失败时只向 stderr 输出错误，不导出部分报告。它不发送继续请求、不恢复线程或重放输入，必要时可启动本地服务和通信进程。与 `status --json` 不同，诊断报告不会包含完整会话、提示词、路径、工具输入输出和原始错误正文。

诊断中的运行信息包含实际 Codex 可执行文件、`CODEX_HOME`、service tier、并发配置及当前/峰值观测；无法从历史恢复的字段为 `null`。`agents` 提供主线程和子线程的 ID、父子关系、模型、推理强度、状态和固定错误类别，不包含正文。规则指纹只对应任务创建时实际注入的规则，旧任务可能未知。Token 仅包含最后采集的本线程原生累计值，缺失时为 `null`，不等于零；不将子任务用量另行相加。时间字段 `startedAt` / `completedAt` 保留原生值，耗时字段明确以 `Ms` 为单位。工具已知耗时可以重叠，不能当作任务总耗时。报告中的执行状态和错误类别不是验收结论。

stdin 每行一个对象，token 和 turn ID 来自当前会话：

```json
{"type":"input","text":"增加状态筛选"}
{"type":"reply","token":"<token>","result":{"decision":"decline"}}
{"type":"reply","token":"<token>","result":{"answers":{"<question-id>":{"answers":["回答"]}}}}
{"type":"stop","turnId":"<turn-id>"}
```

回复体由 `codex-client` 按对应的原生 Schema 校验。失效或其他任务的 token 会被拒绝；没有自动批准开关。stdin 关闭不等于停止任务，审批也可由页面处理。

退出码 0 表示本轮正常结束或正常断开，1 表示错误、失败或中断。退出码不代表验收通过，应读取 Codex 的实际工具输出。

## 配置与数据

使用已登录的 Codex CLI，当前协议对应 0.153.4。`UI_FORGE_CODEX_PATH` 指定可执行文件，`UI_FORGE_CODEX_MODEL` 配置新任务模型。规则与页面共用 [design.md](../../packages/codex-client/instructions/design.md)、[project.md](../../packages/codex-client/instructions/project.md)。

本地服务默认监听 `127.0.0.1:4310`，可配置 `UI_FORGE_PORT`。任务索引与上传图片保存在 `UI_FORGE_RUNTIME_DIR`（默认 `.ui-forge/runtime`），相对路径以安装根解析；后台服务日志写入 `.ui-forge/server.log`。正文与执行历史由 Codex 保存。

诊断元数据在同一运行目录独立保存，只记录规则指纹、运行时定位、并发观测、线程摘要和 Token 数值等无法从历史补回的信息，不参与任务执行或审批。读写失败会在报告中标记缺口，不触发任务重试。当前通信协议 22 同时支持诊断与显式设计来源，旧后端需要与 CLI、VSIX 一起更新。

## 开发

命令由 Commander 管理，每个业务命令的参数、帮助和处理逻辑放在 `src/commands/` 下的独立文件中，并在 `src/cli.ts` 注册。新增或修改命令时，同步更新使用说明和对应测试。
