# ui-forge

ui-forge 是面向 React + TypeScript 中后台项目的设计转代码工具，提供 VS Code 插件和 CLI，首版聚焦单个页面或页面区域。输入设计链接、图片和需求，由 Codex 完成实现、审查及验证。

- 设计来源可选本地图片/文字（`local`）或 MasterGo；选择 MasterGo 后须显式选择 Magic 或 Vibe 接入，不默认切换到 Vibe。
- 支持 PNG / JPEG / WebP 图片。Figma 是后续独立平台扩展，尚未实施；当前可使用导出的参考图。
- 任务中可补充文字或图片、回答问题、处理审批和停止本轮；页面与 CLI 共用任务和历史。
- 设计要求与工程规范可在配置页编辑；可按任务启用严格像素验收。
- 查看真实的工具输出、文件变更、截图及验收结果。本轮结束不等于验收通过。
- 在“交付结果”中分开查看报告结论、证据核对和源码清单状态；缺报告、未验证与需重验不会被当成通过。
- 查看任务诊断摘要，导出不含会话正文的 JSON 报告，用于排查失败及核对运行配置。

## 准备后端

VS Code 插件通过本机 Agent Server 执行任务。安装 `.vsix` 后仍需单独启动后端；CLI 可自动启动后端。以下命令均在 **ui-forge 仓库根目录**执行，生成代码的目标项目是另一个已存在的目录。

需要 Node.js 22.12+、已安装并登录的 Codex CLI，以及用于浏览器验证的 Google Chrome。当前接入协议对应 Codex **0.153.4**；其他版本需检查兼容性。启用严格像素验收或图片切片时，另需 Python 3 和 Pillow。

```bash
npm ci
npm run build
```

首次配置时复制 `.env.example` 为 `.env`；已有 `.env` 时保留原配置。按需填写：

| 配置项                 | 用途                                         |
| ---------------------- | -------------------------------------------- |
| `UI_FORGE_CODEX_PATH`  | Codex 可执行文件的绝对路径；留空时自动查找   |
| `UI_FORGE_CODEX_MODEL` | 新任务使用的模型；留空时默认 `gpt-6-astra`   |
| `MG_MCP_TOKEN`         | Magic 接入需要的令牌；local 和 Vibe 无需填写 |
| `UI_FORGE_PORT`        | 本机后端端口，默认 `4310`                    |

默认从 `PATH` 查找 Codex；macOS 也会检查 Codex / ChatGPT 应用和常见安装目录。执行以下检查，将目标目录替换为真实路径：

```bash
npm run ui-forge -- doctor
npm run check -w @ui-forge/codex-client -- --target /absolute/path/to/target-project
```

`doctor` 检查版本和登录；未登录时运行 `codex login`。第二条命令检查 D2C 配置和 Skill，成功时显示 `packageConfig: "loaded"` 和 `skill: "ui-forge-d2c"`，同时报告 Python/Pillow 是否可用；它不验证 MCP 的网络连接或设计访问权限。首次使用 Playwright MCP 时，可能需要联网下载固定版本。

如果提示项目配置未受信任，先确认本仓库内容可信，再在 Codex 用户配置 `~/.codex/config.toml` 中为 **ui-forge 仓库的绝对路径**设置以下内容；已有同名配置时修改原条目。自定义 `CODEX_HOME` 时使用该目录下的 `config.toml`。保存后重新检查。项目配置仅在受信任后加载，详见 [Codex 项目信任配置](https://learn.chatgpt.com/docs/config-file/config-reference)。

```toml
[projects."/absolute/path/to/ui-forge"]
trust_level = "trusted"
```

## 设计来源与接入

设计平台与连接方式分开选择：`local` 不需要平台连接；`mastergo` 下再选择 `magic` 或 `vibe`。Figma 后续作为独立来源接入，不复用 MasterGo 的连接选项。

- **local**：使用图片或需求文字，不启用内置 MasterGo 接入。只提供文字时无需设计平台账号。
- **MasterGo + Magic**：通过现有官方远程 HTTP MCP 读取设计，需要 `MG_MCP_TOKEN`、对应设计的访问权限和账号的 MCP 服务权益。
- **MasterGo + Vibe**：连接用户已经启动的 MasterGo 本机服务，无需个人 Token。先在客户端打开目标文件和页面并建立 MCP 连接；使用期间不要切换画布。无需 Token 不等于账号权益或服务永久免费，具体以 MasterGo 当前规则为准。

Vibe 默认 MCP 地址为 `http://127.0.0.1:20678/mcp`，状态地址为 `http://127.0.0.1:30678/api/status`，两者用途不同；可按实际监听地址调整，仅接受无凭据的本机 HTTP 地址。ui-forge 不自动安装或启动 Vibe。

Vibe 需要包含 `layer_id` 的完整图层链接，节点标识形如 `2:3`。链接包含 `page_id` 时必须与当前页面一致；省略时使用检查到的当前页面。任务创建时固定文档、页面和节点，同一原生服务实例只允许一个活动任务使用，不支持通过切换画布并行处理多个视图。

链接缺少文件或图层标识时，检查会提示重新复制完整图层链接；画布状态读取失败与 MCP 连接失败分别提示对应地址。修改链接、接入或地址后，页面会清除上一次检查结果，需要重新检查。

ui-forge 的 Vibe 接入向 Codex 仅提供 `read_design` 只读桥，返回原始 JSON 设计数据，不开放画布写入、删除或上游前端代码导出，也不自动保存截图。需要视觉对照时可补充原始参考图。查看历史、诊断和停止任务不要求画布在线；继续执行和读取设计会重新核对绑定，需要恢复原文件和页面。

来源、接入方式和目标身份随任务保存，恢复时沿用原绑定，不因新建任务的选项变化而切换。

## 使用 VS Code 插件

需要 VS Code 1.105 或更高版本。安装包为 `.vsix`；从源码生成安装包见 [打包说明](DEVELOPMENT.md#生成-vsix-安装包)。

1. 在扩展面板的更多菜单中选择 **Install from VSIX…**，安装 `ui-forge-<版本>.vsix`。
2. 在 ui-forge 仓库终端启动后端，并保持该终端运行：

   ```bash
   npm run ui-forge -- serve
   ```

3. 打开 VS Code 用户设置，搜索 `ui-forge.serverUrl`。默认是 `http://127.0.0.1:4310`；更改后端端口时同步修改，随后重新加载 VS Code 窗口。
4. 在安装插件的窗口中打开并信任**要生成代码的目标项目**。点击活动栏的 ui-forge 图标，再点击 **+** 新建任务。
5. 选择设计来源；选择 MasterGo 时再选择 Magic 或 Vibe。Magic 可填写文件或图层链接，Vibe 须填写目标图层链接，可先检查连接。添加图片和需求；需要逐像素比较时勾选“严格像素验收”，然后点击“开始执行任务”。

后端地址只支持本机 HTTP 服务。用户设置示例：

```json
{
  "ui-forge.serverUrl": "http://127.0.0.1:4310"
}
```

插件的目标目录绑定当前窗口打开的工作区。历史任务可直接查看；继续修改时，需打开该任务对应的项目。

发送补充、停止和回复请求会核对任务身份与工作区目录。授权检查完成后、转发前再次核对当前目录和信任状态；发生变化时拒绝该请求，需要用户确认工作区后重新操作，不自动重发。

## 使用 CLI

目标目录须已存在，可使用已有 React 项目或空目录。将下列路径替换为实际路径：

```bash
npm run ui-forge -- run --target /absolute/path/to/target-project --image /absolute/path/to/design.png -- "实现这个页面，支持搜索和重置"
npm run ui-forge -- run --target /absolute/path/to/target-project --design-source mastergo --mastergo-connection magic --design-url "<MasterGo 文件或图层链接>" -- "实现这个页面"
npm run ui-forge -- run --target /absolute/path/to/target-project --design-source mastergo --mastergo-connection vibe --design-url "<MasterGo 图层链接>" -- "实现这个页面"
```

未指定平台时使用 `local`；`--design-url` 不能单独使用。Vibe 可额外指定 `--vibe-endpoint` 和 `--vibe-status-endpoint`。开始任务前可只读检查：

```bash
npm run ui-forge -- design-check --design-source mastergo --mastergo-connection vibe --design-url "<MasterGo 图层链接>"
```

`design-check` 与页面的“检查连接”只做只读预检，不创建任务、不调用模型、不占用 Vibe 实例，也不返回设计正文。Magic 检查 MCP 握手与工具清单，不验证指定设计的实际读取权限；Vibe 还核对当前文件、页面及 JSON 读取工具。成功不代表目标节点已读取或任务已通过验收，创建任务时仍会重新检查。

严格像素验收可直接写入任务需求，同时提供原始参考图：

```bash
npm run ui-forge -- run --target /absolute/path/to/target-project --image /absolute/path/to/design.png -- "实现这个页面。启用严格像素验收。"
```

`run` 自动连接或启动本机服务。任务中直接输入文字补充需求；使用 `/approve`、`/reject` 处理命令或文件审批，其他请求按提示使用 `/reply`。`/stop` 停止本轮，Ctrl-C 只断开 CLI。

```bash
npm run ui-forge -- list
npm run ui-forge -- status TASK_ID
npm run ui-forge -- diagnostics TASK_ID --json
npm run ui-forge -- delivery TASK_ID --json
npm run ui-forge -- resume TASK_ID
```

将 `TASK_ID` 替换为列表中的任务标识。`status` 只查看状态；`resume` 连接原任务，**任务空闲时会发送继续执行请求**。脚本运行需加 `--json`，详细输入输出和回复格式见 [CLI 使用说明](apps/agent-cli/README.md)。

## 配置规则与验收

点击侧边栏的“规则配置”，在独立页面编辑并保存：

| 文件         | 可配置内容                                   |
| ------------ | -------------------------------------------- |
| `design.md`  | 布局、组件、交互、视觉还原及严格像素验收要求 |
| `project.md` | 工程结构、编码规范、检查和交付要求           |

支持 `⌘ / Ctrl + S` 保存。保存后供页面与 CLI 的**新任务**共用，已有会话保留原规则；保存失败时会显示错误并保留编辑内容。

严格像素验收默认关闭。启用后比较原始设计参考图和真实浏览器截图，输出差异图和验收结果。可在 `design.md` 的“严格像素验收”章节中修改颜色通道容差、差异像素占比和最大连通差异区域占比。需要有效的原始参考图和 Python/Pillow；缺少条件或未通过时会说明原因。

页面启用严格验收但未附加图片时会提前提醒，不阻止继续功能实现。已上传图片不代表验收条件齐全，仍需确认原图、CSS 视口、像素尺寸和页面状态一致；无法取得有效参考图时，严格像素验收应标为受阻。

图片支持 PNG、JPEG、WebP，每条消息最多 4 张，每张不超过 5 MiB。开始任务后也可通过选图、粘贴或拖入图片补充需求。

## 查看结果与处理问题

在任务消息中查看文件变更、运行输出和验证结论，点击截图、报告或源码链接打开结果。最终源码写入目标项目；临时截图和报告默认保存在 ui-forge 仓库的 `.ui-forge/runtime/tmp/` 下，可通过 `UI_FORGE_RUNTIME_DIR` 调整运行目录。

任务页的“交付结果”和 CLI `delivery TASK_ID` 查询同一份任务专属报告。每轮应用上下文提示 Codex 在项目临时目录的 `delivery/<任务ID的SHA-256>/report.json` 中记录构建、交互、视觉、性能和审查结论及证据。新报告的文件证据必须带 SHA-256；旧任务若只留下路径字符串，会显示为“无法核验”，不会被当作通过。报告未写入、损坏或身份不符时明确提示，不从会话结束或回复文字补造结论，也不自动补跑验证。
哈希路径缺失时，服务端仅在同一任务临时目录中兼容读取 `delivery/report.json`，并重新校验报告 `taskId`；该直路径中的无指纹证据只展示为不可核验，不放宽文件读取范围，也不代表验收通过。

- **报告结论**：通过、失败、受阻、未验证，均是报告作者的声明。
- **证据核对**：服务端核对文件内容指纹；原生工具引用仅在本任务主线程中核对真实状态和退出码。文件一致或命令成功退出不等于业务验收通过。
- **源码状态**：仅比较报告所列文件的 SHA-256。修改或删除后标为需重验，原声明仍保留；未列入的文件和新增文件不在比较范围，清单一致不能证明全项目未变或验证执行时的版本一致。

查询只读且不恢复线程、不启动模型轮次；只有引用原生工具时才读取 Codex 历史，不需要 Vibe 画布在线。核对结果是查询时的快照，代码或报告更新后需刷新。报告和证据受文件范围、数量与大小限制；交付 JSON 可含项目路径和报告正文，与脱敏的任务诊断不同，不应未经检查就公开分享。

工作区改名或删除后，只要原运行目录中的报告仍可读取，就保留历史报告，并将源码及工作区证据标为无法核对；不自动寻找新目录或改变任务绑定。

交付页面和 CLI 会提示缺少检查类别、通过声明缺证据、证据核对异常及源码清单不可确认等材料缺口，保留报告原声明，不自动改判或补跑。没有提示也不代表验收通过。默认工程规则要求按实际需求记录操作、预期、实测和证据，覆盖相关的取消、失败恢复及边界行为；不为无关场景扩大任务。

遇到审批时，根据页面或 CLI 展示的操作范围选择允许、拒绝或取消。设计与工程规则不改变执行权限。关闭页面或断开 CLI 不会停止后台任务；停止 Agent Server 会结束其 Codex 进程。

长任务运行时，任务页展示原生轮次耗时、当前连接最近收到的活动和已观测主线程累计 Token；CLI 可输入 `/status` 查看本地已接收状态，不额外查询服务。耗时包含等待，不从打开页面开始计算，缺少原生时间时显示未知；Token 不是本轮费用、剩余额度或上下文占用，不累计重复通知或合并子任务。重连后活动与 Token 重新观测，历史累计记录仍可手动查看任务诊断。

“停止本轮”及 `/stop` 仅向当前轮次提交中断请求。请求已提交不等于执行已停止，以后续原生状态为准；未取得确认时会提示，保留草稿且不自动重发。长时间没有新消息不代表卡死，断线后不推断后台状态。本地计时和状态提示不会自动停止或继续任务；当前未提供整任务时限或 Token 硬预算。

模型容量不足导致本轮失败时，页面保留原会话中的消息与文件变更，并显示“模型暂时繁忙”。稍后可点击“继续当前任务”，或在 CLI 使用 `resume TASK_ID`；继续请求会要求先检查已有进度和工作区，只处理未完成的工作。页面不会自动重试，继续也不保证模型服务已经恢复。

失败提示分别展示原因、下一步建议和历史记录摘要，原始错误在页面中默认折叠。容量、额度、上下文、预算、限流、连接与认证问题按明确的原生错误码区分，不凭错误文字或 HTTP 503 猜测容量不足。成功退出的命令和文件变更统计只说明已记录的工作，不代表当前磁盘状态或验收通过。

原生事件明确表示仍会重试时，页面显示“Codex 正在重试”；只有本轮实际失败后才显示失败提示。连接中断表示当前状态尚未确认，不等于后台任务已经停止。继续请求未取得确认时，先核对当前状态，避免重复提交；CLI 会保留任务 ID 并给出 `status`、`diagnostics`、`delivery` 查询入口，同时明确 `resume` 在任务空闲时会继续执行。ui-forge 不额外发起自动重跑，也不扩大审批或沙箱权限。

任务页的“任务诊断”入口和 CLI `diagnostics TASK_ID` 提供同一份只读摘要：模型、推理强度、会话记录的 Codex 版本、适配协议版本、轮次耗时、工具统计、错误类别和已采集的 Token。浏览器中可下载 JSON，VS Code 页面中可复制 JSON；复制失败时提供可选中的报告文本。查询直接读取原生历史，不调用 `thread/resume` 或启动新轮次；必要时仍会启动本地服务及 Codex 通信进程。读取失败不会自动改走任务恢复。

诊断报告只导出白名单字段，不包含需求正文、规则全文、代码、命令输出、MCP 参数、审批凭据或工作区绝对路径。任务创建时记录实际注入规则的 SHA-256；缺失信息显示“未知”，不使用当前规则补填。Token 是最后观测的原生累计值，不累加重复事件，也不汇总子任务；工具项的已知耗时之和不等于轮次耗时。报告不推断验收通过。当前通信协议为 **23**，Server、CLI 与 VSIX（Extension/Webview）使用一致的协议版本。

| 问题                   | 处理方式                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| 插件无法连接后端       | 确认 `serve` 正在运行，`ui-forge.serverUrl` 的端口与 `UI_FORGE_PORT` 一致；修改后重新加载窗口 |
| 无法创建或继续任务     | 在当前 VS Code 窗口打开并信任目标项目；历史任务需与当前工作区一致                             |
| Codex 无法启动或未登录 | 检查 `UI_FORGE_CODEX_PATH`，运行 `doctor`，按提示登录；修改环境配置后重启后端                 |
| D2C 配置不可用         | 按“准备后端”完成 Codex 项目信任，并重新运行配置检查                                           |
| Magic 读取失败         | 检查 `MG_MCP_TOKEN`、设计链接、设计访问权限及账号 MCP 服务权益                                |
| Vibe 连接或读取失败    | 检查本机 MCP/状态地址、客户端连接和固定文件/页面；同实例已有活动任务时先处理原任务            |
| Vibe 启动结果未确认    | 为避免迟到启动造成并发，服务会终止该任务的独立连接；检查原任务历史和画布后再继续              |
| 客户端与服务协议不一致 | 确认后端、CLI 和 VSIX 来自同一版本的构建                                                      |
| 严格像素验收无法执行   | 检查原始参考图及 Python/Pillow；不要将任务结束视为验收通过                                    |

## 开发与技术栈

项目使用 React、TypeScript、Ant Design、Vite、Fastify、Zod 和官方 `@modelcontextprotocol/sdk`。SDK 与只读桥约束 MCP 暴露面，不替代 Codex 的沙箱、审批或已授权的 shell/network 权限。主要目录：

```text
apps/vscode-extension/  VS Code 插件与本机服务连接
apps/agent-webview/     任务页面与规则编辑器
apps/agent-cli/         命令行入口
apps/agent-server/      本机 Codex 进程托管与消息转发
packages/codex-client/  Codex 配置、规则与原生协议适配
packages/client-core/   跨入口通信流消费与会话展示归并
packages/shared-protocol/  客户端与服务通信 Schema
```

源码调试、浏览器入口、VSIX 打包和验证方式见 [开发说明](DEVELOPMENT.md)。Codex 接入细节见 [codex-client](packages/codex-client/README.md)。

`npm run dev:webview` 是模拟演示入口，不连接真实后端，也不执行模型任务。真实浏览器联调使用 `npm run dev:server` 和 `npm run dev:webview:server`，具体步骤见[浏览器联调](DEVELOPMENT.md#浏览器联调)。

### 实现详解

项目分工、任务流程和关键设计见 [ui-forge 项目架构](https://hyy215.github.io/ai/ui-forge-project-architecture)。
