# ui-forge 开发说明

先按 [README](README.md) 完成环境准备。以下命令均在仓库根目录执行。

## 生成 VSIX 安装包

首次打包需安装官方工具 `@vscode/vsce`：

```bash
npm install -g @vscode/vsce
npm run package:vsix
```

产物为 `dist/ui-forge-<版本>.vsix`，包含扩展和页面资源，后端需单独启动。安装方式见 [README](README.md#使用-vs-code-插件)。

只检查打包内容时运行 `npm run package:vsix -- --prepare`，暂存目录会打印到终端；该选项不生成 VSIX，也不需要 vsce。

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

## 验证

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
