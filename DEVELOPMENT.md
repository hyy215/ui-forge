# ui-forge 开发说明

先按 [README](README.md) 完成环境准备。以下命令均在仓库根目录执行。

## VS Code 源码调试

在本仓库窗口的“运行和调试”中启动 `ui-forge: Server + VS Code`。在新打开的**扩展开发窗口**中打开并信任目标项目，然后通过 ui-forge 侧边栏创建任务。

修改页面后运行 `npm run build -w @ui-forge/agent-webview`，再重新打开任务页。后端连接地址通过用户设置 `ui-forge.serverUrl` 配置，修改后重新加载窗口。

## 浏览器联调

在两个终端中分别运行：

```bash
# 终端一：后端
npm run dev:server
```

```bash
# 终端二：页面
npm run dev:webview:server
```

打开 Vite 输出的 Local 地址，默认通常为 `http://localhost:5173`。后端端口不是 `4310` 时，在终端二设置 `UI_FORGE_SERVER_URL` 后启动页面，例如：`UI_FORGE_SERVER_URL=http://127.0.0.1:4321 npm run dev:webview:server`。

`npm run dev:webview` 为模拟演示入口，不连接真实后端。

## 设计接入联调

新任务区分 `local` 与 `mastergo` 来源；MasterGo 再选择 `magic` 或 `vibe`。Figma 尚未接入。修改设计来源或通信能力后，同时构建 Server、CLI 和 Extension/Webview，避免协议不一致。

Magic 使用 `MG_MCP_TOKEN` 和官方远程 MCP；Vibe 使用已启动的本机 MasterGo 服务，默认 MCP 为 `http://127.0.0.1:20678/mcp`，状态接口为 `http://127.0.0.1:30678/api/status`。Vibe 不使用个人 Token，联调不自动安装依赖、启动模型或修改用户画布。

```bash
npm run ui-forge -- design-check --design-source mastergo --mastergo-connection vibe --design-url "<MasterGo 图层链接>"
```

`design-check` 只读取状态、执行 MCP 握手和工具清单检查，不读取设计正文或声明实例占用。Vibe 图层链接必须与当前文档匹配；任务创建后绑定固定，恢复时不会根据当前画布改换来源。

真实设计读取需单独授权。只读桥只提供受宿主固定范围约束的 `read_design`，不提供画布写删、前端代码导出或截图保存；标准 MCP SDK 只负责协议通信，不替代 Codex 原有权限控制。

## 验证

交付展示读取任务专属 `report.json`；协议见 [taskDelivery.ts](packages/shared-protocol/src/delivery/taskDelivery.ts)，模型接收模板见 [deliveryContext.ts](packages/codex-client/src/deliveryContext.ts)。查询不会生成报告或触发验证；无报告就是未验证状态。交付结论和证据含义见 [任务交付与诊断](#task-delivery)。

浏览器模拟入口可用 `?scenario=delivery#/tasks` 检查交付展示；模拟报告不能替代真实模型执行或验收。

`?scenario=delivery-gaps#/tasks` 和 `?scenario=long-task#/tasks` 分别演示交付材料缺口和长任务状态；它们只使用模拟数据，不调用模型。

图片脚本回归使用合成图片，不代表真实设计或浏览器验收。CI 会强制执行这组测试；本地需要相同行为时运行：

```bash
UI_FORGE_REQUIRE_IMAGE_TESTS=1 npm test -- packages/codex-client/src/imageScripts.test.ts
```

可以用 `UI_FORGE_TEST_PYTHON` 指定 Python 可执行文件路径；不指定时使用 `python3`。完整回归和 CI 归档方式见下方章节，CI 步骤见 [.github/workflows/check.yml](.github/workflows/check.yml)。

### 跨入口与权限边界

相关回归不调用真实模型或 MasterGo 服务，重点覆盖工作区信任、任务身份、多入口访问、协议协商和 Vibe 只读权限：

- [宿主授权测试](apps/vscode-extension/src/hostRequestPolicy.test.ts)
- [面板转发测试](apps/vscode-extension/src/UiForgePanelManager.test.ts)
- [会话集成测试](apps/agent-server/src/sessions/sessionService.test.ts)
- [协议协商测试](apps/agent-webview/src/communication/createNegotiatedCommunicationClient.test.ts)
- [Vibe 租约测试](apps/agent-server/src/design/vibeLeases.test.ts)
- [Vibe 只读桥测试](packages/codex-client/src/design/vibeReadOnlyBridge.test.ts)

Extension 授权仅覆盖当前 VS Code 窗口；CLI 使用用户显式选定的目标目录。停止仍需用户显式发起，并由原生状态确认。

### 自动回归归档

项目级场景清单见 [catalog.json](scripts/regression/catalog.json)。CI 会收集 Vitest / Playwright 报告并生成摘要；本地按需运行：

```bash
npm run regression:prepare -- --output .ui-forge/regression/local-001
npm test -- packages/client-core/src/taskObservation.test.ts --reporter=default --reporter=json --outputFile.json=.ui-forge/regression/local-001/vitest.json
npm run regression:summarize -- --output .ui-forge/regression/local-001
```

上例只运行一个文件，其余场景会标为未执行或不完整；全量检查交给 CI。报告可能包含绝对路径和测试输出，分享前应检查内容。

### 长历史性能基线

需要比较任务页历史渲染性能时运行离线基线；它使用模拟数据，不调用模型：

```bash
npm run benchmark:history -- --output .ui-forge/benchmarks/history-001
```

输出目录必须不存在；重复测量使用新目录。该基线是模拟页指标，不代表真实模型、网络或 VS Code 安装性能。

### 常用检查

使用 Prettier 统一格式化和检查：

```bash
npm run format
npm run format:check
```

VS Code 安装推荐的 Prettier 扩展后会在保存时按仓库配置格式化。生成代码、构建产物和本地资料由 `.prettierignore` 排除。

按修改范围运行相关类型检查和测试，以 VS Code 扩展为例：

```bash
npm run typecheck -w @ui-forge/vscode-extension
npm run test -- apps/vscode-extension/src
```

TypeScript 检查使用 `tsc -b` 按 Project References 构建依赖；单独检查 CLI 等工作区时也不依赖已有的 `dist`。为供下游项目读取声明文件，检查会按需写入构建产物和增量缓存，不是纯 `--noEmit`。

页面交互修改运行对应 E2E，首次需准备测试浏览器：

```bash
npx --no-install playwright install chromium
npm run test:e2e -- --grep '<相关用例名称>'
```

GitHub CI 执行全量检查。安装包还应在独立 VS Code 窗口中验证页面加载、后端连接及文件预览。

## 打包与发布

首次打包需安装官方工具 `@vscode/vsce`：

```bash
npm install -g @vscode/vsce
npm run package:vsix
```

产物为 `dist/ui-forge-<版本>.vsix`，包含扩展和页面资源，后端需单独启动。安装方式见 [README](README.md#选择入口)。

只检查打包内容时运行 `npm run package:vsix -- --prepare`，暂存目录会打印到终端；该选项不生成 VSIX，也不需要 vsce。打包会检查发布文件白名单、符号链接、清单和入口导出，并在不解析仓库依赖的环境中加载 CJS；全部 JS/CSS 的静态及动态导入和资源路径由构建器检查。只允许明确的发布文件，新增资源类型时需同步调整校验与测试。

已准备 Playwright Chromium 后，可追加生产页面检查：

```bash
npm run package:vsix -- --prepare --smoke
```

此检查使用暂存包中的生产 HTML/JS/CSS 和 VS Code 消息桥替身，验证首页、新建任务、规则页及页面资源加载，不使用开发模拟入口，不连接后端或模型。未加 `--smoke` 的静态校验不确认 HTML 入口或页面可加载；生成交付包前应运行该冒烟，也可直接使用 `npm run package:vsix -- --smoke`。CI 执行相同的暂存与冒烟检查。需要截图时可单独运行 `node apps/vscode-extension/scripts/smoke-webview.mjs <暂存目录> --screenshots <包外截图目录>`。

暂存校验与浏览器冒烟不等于 VSIX 已生成或 VS Code 已安装验证。发布前仍需生成实际 `.vsix`，并在独立 VS Code 窗口中手动确认：扩展激活和侧边栏、后端离线提示、连接后历史读取、目标工作区绑定、文件预览以及关闭页面不停止任务；真实执行另行授权。不要用生产账号任务替代只读安装检查。

## Codex 接入验证与协议升级

配置检查与请求预览见 [codex-client](packages/codex-client/README.md#配置与检查)。`check` 和 `dry-run` 支持 `--codex`、`--model`、`--search`、重复 `-i`、`--design-constraints` 和 `--project-constraints`。

需要真实验证时，先构建再单独运行：

```bash
npm run build -w @ui-forge/codex-client
npm run test:live -w @ui-forge/codex-client
```

真实验证使用现有登录并调用模型，在临时目录验证编码、固定测试命令的审批同意/拒绝、中断、恢复、审查和宿主退出清理。普通测试默认跳过它。

原生类型和校验数据由官方 Codex CLI 生成。升级协议时运行：

```bash
npm run generate:protocol -w @ui-forge/codex-client
```

生成后验证兼容性，并同步 README 中的 Codex 原生协议版本。`check` 会报告运行版本与生成的 Codex 原生协议版本是否一致；版本不同需验证兼容性，不直接认定不可用。它与 ui-forge Client/Server 使用的公共通信协议 23 是两套独立版本。原生接口见 [Codex App Server 文档](https://learn.chatgpt.com/docs/app-server)。

<a id="task-delivery"></a>
## 任务交付与诊断

任务页的“交付结果”和 CLI 的 `delivery TASK_ID` 查询同一份任务专属报告；`diagnostics TASK_ID` 提供脱敏的只读诊断摘要。查询不会恢复线程、启动模型轮次或自动补跑验证。

报告由任务上下文写入项目临时目录的 `delivery/<任务 ID 的 SHA-256>/report.json`。报告可以声明构建、交互、视觉、性能和审查结论，但报告结论仍是报告作者的声明：

- `passed`、`failed`、`blocked` 和 `not-verified` 表示报告声明，不是服务端独立验收结论。
- 文件证据会核对 SHA-256；原生工具证据会核对真实状态和退出码。证据一致或命令成功退出，不等于业务验收通过。
- 源码状态只比较报告列出的文件。文件被修改或删除后会标为需重验；未列出的文件和新增文件不在比较范围。
- 报告缺失、损坏、身份不符、证据越界或无法读取时，会显示为不可核对，不会从会话结束或回复文字补造结论。

诊断报告只导出白名单字段，例如模型、推理强度、记录中的 Codex 版本、适配协议版本、轮次耗时、工具统计、错误类别和已采集的 Token。它不包含需求正文、规则全文、代码、命令输出、MCP 参数、审批凭据或工作区绝对路径。Token 是最后观测到的原生累计值，不累加重复事件，也不汇总子任务；它不是费用、剩余额度或上下文占用。

关闭页面或断开 CLI 不会停止后台任务；停止 Agent Server 会结束其 Codex 进程。`/stop` 或“停止本轮”只提交当前轮次的中断请求，提交成功不等于执行已停止，最终状态以原生通知为准。模型容量不足导致失败时，页面保留会话和文件变更，可在确认状态后使用“继续当前任务”或 `resume TASK_ID`。
