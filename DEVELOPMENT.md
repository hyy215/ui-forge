# ui-forge 开发说明

先按 [README](README.md) 完成环境准备。以下命令均在仓库根目录执行。

## 生成 VSIX 安装包

首次打包需安装官方工具 `@vscode/vsce`：

```bash
npm install -g @vscode/vsce
npm run package:vsix
```

产物为 `dist/ui-forge-<版本>.vsix`，包含扩展和页面资源，后端需单独启动。安装方式见 [README](README.md#使用-vs-code-插件)。

只检查打包内容时运行 `npm run package:vsix -- --prepare`，暂存目录会打印到终端；该选项不生成 VSIX，也不需要 vsce。打包会检查发布文件白名单、符号链接、清单和入口导出，并在不解析仓库依赖的环境中加载 CJS；全部 JS/CSS 的静态及动态导入和资源路径由构建器检查。只允许明确的发布文件，新增资源类型时需同步调整校验与测试。

已准备 Playwright Chromium 后，可追加生产页面检查：

```bash
npm run package:vsix -- --prepare --smoke
```

此检查使用暂存包中的生产 HTML/JS/CSS 和 VS Code 消息桥替身，验证首页、新建任务、规则页及页面资源加载，不使用开发模拟入口，不连接后端或模型。未加 `--smoke` 的静态校验不确认 HTML 入口或页面可加载；生成交付包前应运行该冒烟，也可直接使用 `npm run package:vsix -- --smoke`。CI 执行相同的暂存与冒烟检查。需要截图时可单独运行 `node apps/vscode-extension/scripts/smoke-webview.mjs <暂存目录> --screenshots <包外截图目录>`。

暂存校验与浏览器冒烟不等于 VSIX 已生成或 VS Code 已安装验证。发布前仍需生成实际 `.vsix`，并在独立 VS Code 窗口中手动确认：扩展激活和侧边栏、后端离线提示、连接后历史读取、目标工作区绑定、文件预览以及关闭页面不停止任务；真实执行另行授权。不要用生产账号任务替代只读安装检查。

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

打开 Vite 输出的 Local 地址，默认通常为 `http://localhost:5173`。后端端口不是 `4310` 时，在终端二设置 `UI_FORGE_SERVER_URL` 后启动页面。

`npm run dev:webview` 为模拟演示入口，不连接真实后端。

## 设计接入联调

新任务区分 `local` 与 `mastergo` 来源；只有 MasterGo 再选择 `magic` 或 `vibe`。Figma 接入尚未实施，不作为 MasterGo 的连接选项。页面与 CLI 使用通信协议 23 的 `design-source-selection` 与 `task-delivery` 等能力；修改后同步构建 Server、CLI、Extension/Webview，避免客户端与服务协议不一致。

Magic 使用已有 `MG_MCP_TOKEN` 与官方远程 MCP，账号还需具备设计访问权限和服务权益。Vibe 使用已启动的本机 MasterGo 服务，默认 MCP 为 `http://127.0.0.1:20678/mcp`，状态接口为 `http://127.0.0.1:30678/api/status`；它们不是同一个端点。Vibe 不使用个人 Token，账号权益仍以平台规则为准。不要为联调自动安装依赖、启动模型或修改用户画布。

```bash
npm run ui-forge -- design-check --design-source mastergo --mastergo-connection vibe --design-url "<MasterGo 图层链接>"
```

连接检查只读取状态、执行 MCP 握手和工具清单检查，不读取设计正文、不声明实例占用。Vibe 的图层链接必须与当前文档匹配；页面会在创建时固定。同一原生实例的执行准入串行化，不能用多个 MCP 桥端口模拟多个独立画布。恢复任务沿用已保存的绑定，不能因当前画布或默认配置变化而改换来源。

真实设计读取需单独授权。受限桥仅提供空参数的 `read_design`：宿主固定文档/页面/节点、项目目录和 JSON 格式，强制 `writeToFile:false` 且不传 `outDir`；返回时只保留 JSON，丢弃上游的保存目录提示。它不提供画布写删、前端代码导出或截图保存。标准 MCP SDK 承担协议通信，不替代 Codex 原有权限控制。

## 验证

交付展示使用任务专属 `report.json`，协议见 [taskDelivery.ts](packages/shared-protocol/src/delivery/taskDelivery.ts)。模型接收的模板与写入边界见 [deliveryContext.ts](packages/codex-client/src/deliveryContext.ts)。查询不会生成报告或触发验证；无报告是有效的未验证状态。源码列表仅是作者声明的范围，不能作为完整项目快照。服务核对报告最多 256 KiB、单文件最多 16 MiB、源码及文件证据合计最多 64 MiB；超限或越界显示不可核对，不扩大读取范围。旧报告中的裸路径证据只保留展示并标记为不可核验，不视为指纹匹配。

浏览器模拟入口可用 `?scenario=delivery#/tasks` 检查交付展示，实际证据可信度由服务端定向测试覆盖。模拟报告不能作为真实模型执行或生成项目通过验收的证明。

`?scenario=delivery-gaps#/tasks` 演示缺检查类别和通过声明缺证据的提示。`client-core` 的缺口检查只读取已有交付数据，不解析测试断言、不更改声明、不触发执行；材料无缺口也不意味着业务通过。报告模板由启动链路测试按现有 Schema 校验，保持默认未验证状态。

`?scenario=long-task#/tasks` 提供长任务展示样本。`long-task.spec.ts` 使用模拟时钟和原生事件覆盖耗时、主线程累计 Token、等待、断线、停止回执与迟到响应，不调用模型。观测只消费现有事件，不轮询任务、不累计子线程 Token，也不触发自动停止或继续；停止请求被接受仍需等待原生状态确认。

图片脚本回归使用小型合成图片，覆盖阈值边界、八邻域、输入输出碰撞及读写失败，不涉及真实设计。运行 `npm test -- packages/codex-client/src/imageScripts.test.ts`；本地缺少 Python/Pillow 时该组会提示并跳过，必须在验证结论中注明，不能将跳过记为图片工具通过。脚本保护输入证据，但不证明截图来源或浏览器状态一致。

CI 固定使用 Python 3.14.2 和 Pillow 12.2.0，并通过 `UI_FORGE_REQUIRE_IMAGE_TESTS=1` 强制执行图片脚本测试；解释器缺失或 Pillow 导入失败会使检查失败，不允许整组跳过。安装与测试使用同一解释器，版本信息输出在 CI 日志中；此配置不在本机自动安装依赖。本地需要相同的强制行为时运行：

```bash
UI_FORGE_REQUIRE_IMAGE_TESTS=1 npm test -- packages/codex-client/src/imageScripts.test.ts
```

可以用 `UI_FORGE_TEST_PYTHON` 指定已有 Python 可执行文件路径（不包含命令参数），不指定时使用 `python3`。门禁回归 `imageScriptsEnvironment.test.ts` 验证依赖探测失败在强制模式下报错、本地可选模式下跳过，不调用模型。

### 跨入口与权限边界

以下回归不调用真实模型或 MasterGo 服务。它们验证客户端与宿主实现，不能替代安装后的 VS Code 联调，也不能证明模型会遵从所有不可信设计内容边界。

| 检查范围              | 测试与验证方式                                                                                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务身份、目录和信任  | [宿主授权测试](apps/vscode-extension/src/hostRequestPolicy.test.ts)：身份不符、未信任、缺工作区与跨目录拒绝，符号链接按真实路径比较。                                                                                                    |
| 异步授权窗口          | [面板转发测试](apps/vscode-extension/src/UiForgePanelManager.test.ts)：延迟历史读取或路径解析期间改变目录/信任，原操作不得转发；只读查询与取消订阅不隐式执行任务。                                                                       |
| 同一任务的多入口访问  | [会话集成测试](apps/agent-server/src/sessions/sessionService.test.ts) 中的 `cross-entry` 用例：CLI 与页面 HTTP 客户端连接同一随机 loopback 端口，原生 Codex 连接由测试替身提供；核对审批、断开、停止与只读报告。                         |
| 协议能力不兼容        | [协商测试](apps/agent-webview/src/communication/createNegotiatedCommunicationClient.test.ts)：版本不同或缺少必需能力时，业务请求、流和通知均不转发。                                                                                     |
| Vibe 读取权与只读工具 | [租约测试](apps/agent-server/src/design/vibeLeases.test.ts) 与 [只读桥测试](packages/codex-client/src/design/vibeReadOnlyBridge.test.ts)：迟到结果不能恢复旧读取权，失权后丢弃正文；额外参数、导出工具与非法 HTTP 来源在上游调用前拒绝。 |

Extension 授权仅覆盖当前 VS Code 窗口；CLI 使用用户显式选定的目标目录，不继承 VS Code 的信任状态。请求已转发后不因页面导航或关闭而自动撤销；停止仍需用户显式发起，并由原生状态确认。

### 自动回归归档

项目级清单见 [catalog.json](scripts/regression/catalog.json)，按设计输入、审批、恢复、失败、停止、Vibe 隔离、交付和诊断关联已有测试文件。映射粒度为文件，不代表文件内每个断言都对应该场景；同一文件可以关联多个场景，不能把场景计数相加作为独立测试总数。清单不是全仓测试目录，未映射文件仍保留在完整报告中。

CI 初始化独立批次后，自动收集 Vitest / Playwright JSON，生成 Actions 页面摘要，并将原始报告、`run.json`、`summary.json` 和 `summary.md` 保存为 `regression-evidence-<run>-<attempt>` 附件，保留 14 天。初始化成功后，后续步骤即使失败也会尝试汇总；汇总不覆盖原步骤失败。缺失、损坏、过期、跳过及未执行不会被当作通过，重试不重复计数。Playwright 的不稳定重试结果保守记录为失败。

批次记录 Git commit、dirty 状态、锁文件及规则/Skill/图片脚本的 SHA-256；环境版本在汇总时读取，缺失显示未知。dirty 不是源码快照，不归档补丁、环境变量或私有输入，因此不能仅凭 commit 重建未提交工作区。这些自动化使用测试替身、合成数据及本地服务，不调用真实模型或设计平台，不能计算 Agent 任务完成率，也不能替代账号联调或 VSIX 安装验证。原始报告可能包含绝对路径及测试失败输出，公开分享前需检查。

通常只需查看 CI 摘要和附件，不用逐条手工测试。本地按需验证时可给定一个尚不存在的独立目录：

```bash
npm run regression:prepare -- --output .ui-forge/regression/local-001
npm test -- packages/client-core/src/taskObservation.test.ts --reporter=default --reporter=json --outputFile.json=.ui-forge/regression/local-001/vitest.json
npm run regression:summarize -- --output .ui-forge/regression/local-001
```

上例只运行一个文件，其余场景会显示未执行或不完整；不复用旧批次结果，也不自动补跑测试。报告无法判断 `--grep` 等过滤器省略的用例，因此本地汇总只统计已观察结果，场景保守标为不完整；CI 使用已配置的未筛选命令及步骤结果确认执行范围。浏览器报告通过 `PLAYWRIGHT_JSON_OUTPUT_FILE` 指定同一批次中的 `playwright.json`，并使用 `--reporter=list,html,json`。批次初始化和汇总都拒绝覆盖已有产物；新验证使用新目录。全量检查仍交给 CI。

### 长历史性能基线

已有依赖和 Playwright Chromium 时可运行离线基线，不需手工逐项操作，也不调用模型：

```bash
npm run benchmark:history -- --output .ui-forge/benchmarks/history-001
```

输出目录必须不存在；重复测量换新目录，可用 `--repeats 1` 快速检查脚本，默认每组 3 次，最多 5 次。脚本先定向构建 `shared-protocol` 和 `client-core`，再独立构建 `fixtures/benchmark.html`，不修改生产入口或 Webview 的普通 `dist`；临时服务只监听随机本机端口，结束时关闭浏览器和服务，不影响已有开发服务。浏览器拒绝其他来源请求和 WebSocket。缺少依赖或浏览器时明确失败，不自动安装。

基线复用真实任务页，注入 100 / 500 / 1000 条固定短消息、命令及补丁，另加 1 条活动消息。在桌面 1440×900、窄屏 390×844 下串行检查打开、上翻与返回最新、100 次流增量期间打字、模拟审批拒绝。每个视口先预热一次，再在新上下文中重复，报告中保存就绪耗时、流中帧间隔、输入到下一帧、审批响应、DOM 数和 JS 堆占用，并保留原始样本、环境、源码 SHA-256、截图及说明。失败保留 `failure.json` 与已完成样本，不生成完整报告，也不覆盖旧结果。

`report.md` 展示中位数 / 最大值，`report.json` 保留原始记录；未设置性能通过阈值，不加入普通 CI 门禁。它是生产模式构建的模拟页测量，不是生产任务或 VS Code 安装性能，不覆盖模型延迟、真实网络、图片、大补丁和超长 Markdown；JS 堆快照未经强制 GC，不证明内存泄漏。页面就绪及返回最新包含自动化等待，下一帧仅是呈现代理指标，不等同屏幕像素已绘制。测量过程中不要编辑相关源码或并行运行重负载；结合稳定复测后再决定是否优化。

历史消息按不可变 `item` 引用复用渲染，任务的文件打开上下文只在任务或文件来源变化时更新；不按“已完成”状态冻结内容，也不截断历史。`sessionPresentation.test.ts` 覆盖未变化项的引用保留、迟到历史更新及完整快照替换；`history-rendering.spec.ts` 检查持续输出期间工具展开、草稿、审批及停止展示。性能改动使用上述相同样本前后对比，不能用缩短历史或隐藏内容换取更好的测量结果。

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

生成后验证兼容性，并同步 README 中的协议版本。`check` 会报告运行版本与协议版本是否一致；版本不同需验证兼容性，不直接认定不可用。原生接口见 [Codex App Server 文档](https://learn.chatgpt.com/docs/app-server)。
