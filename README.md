# ui-forge

ui-forge 是面向 React + TypeScript 中后台项目的设计转代码工具，提供 VS Code 插件和 CLI，首版聚焦单个页面或页面区域。输入设计链接、图片和需求，由 Codex 完成实现、审查及验证。

- 支持 MasterGo 设计链接和 PNG / JPEG / WebP 图片；Figma 专用接入尚未配置，可先提供导出的参考图。
- 任务中可补充文字或图片、回答问题、处理审批和停止本轮；页面与 CLI 共用任务和历史。
- 设计要求与工程规范可在配置页编辑；可按任务启用严格像素验收。
- 查看真实的工具输出、文件变更、截图及验收结果。本轮结束不等于验收通过。

## 准备后端

VS Code 插件通过本机 Agent Server 执行任务。安装 `.vsix` 后仍需单独启动后端；CLI 可自动启动后端。以下命令均在 **ui-forge 仓库根目录**执行，生成代码的目标项目是另一个已存在的目录。

需要 Node.js 22+、已安装并登录的 Codex CLI，以及用于浏览器验证的 Google Chrome。当前接入协议对应 Codex **0.153.4**；其他版本需检查兼容性。启用严格像素验收或图片切片时，另需 Python 3 和 Pillow。

```bash
npm ci
npm run build
```

首次配置时复制 `.env.example` 为 `.env`；已有 `.env` 时保留原配置。按需填写：

| 配置项                 | 用途                                           |
| ---------------------- | ---------------------------------------------- |
| `UI_FORGE_CODEX_PATH`  | Codex 可执行文件的绝对路径；留空时自动查找     |
| `UI_FORGE_CODEX_MODEL` | 新任务使用的模型；留空时默认 `gpt-6-astra`     |
| `MG_MCP_TOKEN`         | 读取 MasterGo 设计需要的令牌；图片任务无需填写 |
| `UI_FORGE_PORT`        | 本机后端端口，默认 `4310`                      |

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

## 使用 VS Code 插件

需要 VS Code 1.105 或更高版本。安装包为 `.vsix`；从源码生成安装包见 [打包说明](DEVELOPMENT.md#生成-vsix-安装包)。

1. 在扩展面板的更多菜单中选择 **Install from VSIX…**，安装 `ui-forge-<版本>.vsix`。
2. 在 ui-forge 仓库终端启动后端，并保持该终端运行：

   ```bash
   npm run ui-forge -- serve
   ```

3. 打开 VS Code 用户设置，搜索 `ui-forge.serverUrl`。默认是 `http://127.0.0.1:4310`；更改后端端口时同步修改，随后重新加载 VS Code 窗口。
4. 在安装插件的窗口中打开并信任**要生成代码的目标项目**。点击活动栏的 ui-forge 图标，再点击 **+** 新建任务。
5. 添加设计链接或图片，填写需求；需要逐像素比较时勾选“严格像素验收”，然后点击“开始执行任务”。

后端地址只支持本机 HTTP 服务。用户设置示例：

```json
{
  "ui-forge.serverUrl": "http://127.0.0.1:4310"
}
```

插件的目标目录绑定当前窗口打开的工作区。历史任务可直接查看；继续修改时，需打开该任务对应的项目。

## 使用 CLI

目标目录须已存在，可使用已有 React 项目或空目录。将下列路径替换为实际路径：

```bash
npm run ui-forge -- run --target /absolute/path/to/target-project --image /absolute/path/to/design.png -- "实现这个页面，支持搜索和重置"
npm run ui-forge -- run --target /absolute/path/to/target-project --design-url "<MasterGo URL>" -- "实现这个页面"
```

严格像素验收可直接写入任务需求，同时提供原始参考图：

```bash
npm run ui-forge -- run --target /absolute/path/to/target-project --image /absolute/path/to/design.png -- "实现这个页面。启用严格像素验收。"
```

`run` 自动连接或启动本机服务。任务中直接输入文字补充需求；使用 `/approve`、`/reject` 处理命令或文件审批，其他请求按提示使用 `/reply`。`/stop` 停止本轮，Ctrl-C 只断开 CLI。

```bash
npm run ui-forge -- list
npm run ui-forge -- status TASK_ID
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

图片支持 PNG、JPEG、WebP，每条消息最多 4 张，每张不超过 5 MiB。开始任务后也可通过选图、粘贴或拖入图片补充需求。

## 查看结果与处理问题

在任务消息中查看文件变更、运行输出和验证结论，点击截图、报告或源码链接打开结果。最终源码写入目标项目；临时截图和报告默认保存在 ui-forge 仓库的 `.ui-forge/runtime/tmp/` 下，可通过 `UI_FORGE_RUNTIME_DIR` 调整运行目录。

遇到审批时，根据页面或 CLI 展示的操作范围选择允许、拒绝或取消。设计与工程规则不改变执行权限。关闭页面或断开 CLI 不会停止后台任务；停止 Agent Server 会结束其 Codex 进程。

| 问题                   | 处理方式                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| 插件无法连接后端       | 确认 `serve` 正在运行，`ui-forge.serverUrl` 的端口与 `UI_FORGE_PORT` 一致；修改后重新加载窗口 |
| 无法创建或继续任务     | 在当前 VS Code 窗口打开并信任目标项目；历史任务需与当前工作区一致                             |
| Codex 无法启动或未登录 | 检查 `UI_FORGE_CODEX_PATH`，运行 `doctor`，按提示登录；修改环境配置后重启后端                 |
| D2C 配置不可用         | 按“准备后端”完成 Codex 项目信任，并重新运行配置检查                                           |
| MasterGo 读取失败      | 检查后端 `.env` 中的 `MG_MCP_TOKEN`、设计链接和账号对该设计的访问权限                         |
| 严格像素验收无法执行   | 检查原始参考图及 Python/Pillow；不要将任务结束视为验收通过                                    |

## 开发与技术栈

项目使用 React、TypeScript、Ant Design、Vite、Fastify 和 Zod。主要目录：

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
