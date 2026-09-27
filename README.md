# ui-forge

ui-forge 将图片、需求文字或 MasterGo 设计转换为 React + TypeScript 页面，支持 VS Code 插件和 CLI。当前聚焦单个页面或页面区域，由 Codex 负责实现、审查和验证。

## 快速开始

需要 Node.js 22.12+、已登录的 Codex CLI（当前生成的 Codex 原生协议对应 0.153.4）和 Google Chrome。严格像素验收还需要 Python 3 与 Pillow；开发 E2E 和 VSIX 冒烟另需 Playwright Chromium。

在 ui-forge 仓库根目录执行：

```bash
npm ci
npm run build
[ -f .env ] || cp .env.example .env
npm run ui-forge -- doctor
```

首次使用某个目标项目时，建议额外运行只读 D2C 配置检查：

```bash
npm run check -w @ui-forge/codex-client -- --target /absolute/path/to/target-project
```

它不创建任务、不连接 MCP，也不调用模型。

目标项目必须是已存在的目录，可以是已有的 React 项目或空目录。使用 CLI 创建一个图片任务：

```bash
npm run ui-forge -- run \
  --target /absolute/path/to/target-project \
  --image /absolute/path/to/design.png \
  -- "实现这个页面"
```

CLI 会自动连接或启动本机服务。更多参数见 [CLI 使用说明](apps/agent-cli/README.md)。

## 选择入口

### CLI

CLI 支持图片、需求文字和 MasterGo。MasterGo 任务需要显式选择 `magic` 或 `vibe`；创建任务前可使用 `design-check` 只读检查连接。任务管理命令、交互指令和脚本接口见 [CLI 使用说明](apps/agent-cli/README.md)。

### VS Code 插件

1. 按 [打包说明](DEVELOPMENT.md#打包与发布) 生成并安装 `.vsix`。
2. 在 ui-forge 仓库根目录启动后端：

   ```bash
   npm run ui-forge -- serve
   ```

3. 在 VS Code 中打开并信任目标项目，打开 ui-forge 侧边栏并创建任务。
4. 添加图片或设计链接和需求，然后开始执行。

插件默认连接 `http://127.0.0.1:4310`。修改端口时，同时修改 VS Code 设置 `ui-forge.serverUrl`。插件和 CLI 访问同一本机服务，共用任务和历史。详见 [VS Code 使用说明](apps/vscode-extension/README.md)。

## 设计来源

| 来源 | 说明 | 需要 |
| --- | --- | --- |
| `local` | 图片或需求文字 | 无设计平台账号 |
| MasterGo + Magic | 读取 MasterGo 文件或图层 | `MG_MCP_TOKEN`、设计访问权限和 MCP 服务权益 |
| MasterGo + Vibe | 读取已打开的 MasterGo 本机画布 | 本机 MCP 连接和完整图层链接 |

支持 PNG、JPEG 和 WebP 图片，每条消息最多 4 张、每张不超过 5 MiB。Figma 尚未作为独立来源接入，但可以使用导出的参考图。Vibe 不自动安装或启动，使用期间需要保持目标文件和页面不变。

## 配置与验收

复制 `.env.example` 为 `.env`，按需填写 Codex 路径、模型、`MG_MCP_TOKEN` 和服务端口。Codex 提示配置不受信任时，按 [Codex 接入说明的信任配置](packages/codex-client/README.md#配置与检查) 信任 ui-forge 仓库的包项目；目标项目不需要复制包内 `.codex` 文件。Codex 配置参考见 [官方文档](https://learn.chatgpt.com/docs/config-file/config-reference)。

规则配置页中的 `design.md` 用于设计还原和严格像素验收，`project.md` 用于工程规范、检查和交付要求。保存后的规则供新任务使用，已有会话保留创建时的规则。

严格像素验收默认关闭，在新建任务页勾选“严格像素验收”后启用。启用后需要原始参考图、浏览器截图环境和 Python/Pillow；缺少条件时仍可继续功能实现，但对应检查应记录为受阻或未验证。任务结束、命令成功或文件变更记录都不等于验收通过，应查看交付结果中的报告和证据。

## 高级配置

<details>
<summary>将后台切换为阿里云 Token Plan</summary>

本配置只影响当前 ui-forge 项目的 Agent Server，不修改用户级 Codex 配置。以下命令在仓库根目录执行。

本配置使用阿里云 Token Plan 的专属 API Key 和 Responses API。Coding Plan 是另一种套餐，使用 `https://coding.dashscope.aliyuncs.com/v1`，仅支持 Chat/Completions API，不能直接用于当前 Codex 接入。按量付费也需使用对应的端点和凭证。套餐与协议区别见 [阿里云 Codex 接入说明](https://help.aliyun.com/zh/model-studio/codex)。

在本地 `.env` 中填写项目专用的 `CODEX_HOME`、模型和 Token Plan 专属 API Key。将本节示例中的 `/absolute/path/to/ui-forge` 替换为 ui-forge 仓库的实际绝对路径：

```dotenv
CODEX_HOME=/absolute/path/to/ui-forge/.ui-forge/codex-aliyun
UI_FORGE_CODEX_MODEL=qwen3.8-max
ALI_TOKEN_PLAN_API_KEY=<从阿里云 Token Plan 获取的 API Key>
```

先创建独立配置目录：

```bash
mkdir -p .ui-forge/codex-aliyun
```

创建 `.ui-forge/codex-aliyun/config.toml`，其中 `model_catalog_json` 使用绝对路径：

```toml
model = "qwen3.8-max"
model_provider = "ALI_TOKEN_PLAN"
model_catalog_json = "/absolute/path/to/ui-forge/.ui-forge/codex-aliyun/models.json"

[model_providers.ALI_TOKEN_PLAN]
name = "Alibaba Cloud Token Plan"
base_url = "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
env_key = "ALI_TOKEN_PLAN_API_KEY"
wire_api = "responses"
requires_openai_auth = false
```

接着创建 `.ui-forge/codex-aliyun/models.json`，写入以下模型目录。内容取自上方阿里云文档的 Token Plan Responses API 模板，仅保留本示例使用的模型：

```json
{
  "models": [
    {
      "slug": "qwen3.8-max",
      "display_name": "qwen3.8-max",
      "description": "Qwen 3.8 Max",
      "default_reasoning_level": "xhigh",
      "supported_reasoning_levels": [
        { "effort": "low", "description": "low" },
        { "effort": "medium", "description": "medium" },
        { "effort": "xhigh", "description": "xhigh" }
      ],
      "context_window": 983616,
      "effective_context_window_percent": 95,
      "supports_parallel_tool_calls": false,
      "supports_image_detail_original": true,
      "input_modalities": ["text", "image"],
      "shell_type": "default",
      "visibility": "list",
      "supported_in_api": true,
      "priority": 1,
      "base_instructions": "",
      "support_verbosity": false,
      "supports_reasoning_summaries": false,
      "experimental_supported_tools": [],
      "truncation_policy": { "mode": "bytes", "limit": 10000 }
    }
  ]
}
```

切换模型时，需同步修改 `UI_FORGE_CODEX_MODEL`、`model` 和目录中的模型条目；模型能力与元数据以阿里云对应套餐的最新文档为准。

请勿将 `.env` 或包含凭证的本地配置提交到 Git；相关文件保存在 `.ui-forge/` 和本机环境中。

确认仓库可信后，按 [项目信任说明](packages/codex-client/README.md#配置与检查) 在这个独立的 `config.toml` 中加入 ui-forge 仓库的信任条目；默认 `~/.codex` 下的信任设置不会自动复制过来。

先检查模型目录，输出应包含 `qwen3.8-max`；这个检查不验证 API Key 或远程模型可用性：

```bash
CODEX_HOME="$PWD/.ui-forge/codex-aliyun" codex debug models
```

然后启动服务并保持终端运行：

```bash
npm run ui-forge -- serve
```

在另一个终端检查服务：

```bash
curl http://127.0.0.1:4310/health
```

修改 `.env` 或 Codex 配置后，需要重启 `serve`。本示例的 Token Plan API Key 与 `token-plan.cn-beijing.maas.aliyuncs.com` 端点配套使用。出现 `401 InvalidApiKey` 时检查套餐、API Key 和端点是否匹配；出现模型目录读取或 `Model metadata ... not found` 错误时，检查 `models.json` 是否存在，以及 `CODEX_HOME`、`model_catalog_json` 和模型名称是否一致。

如果 API Key 曾出现在参考文件或日志中，应先在阿里云控制台轮换，再写入本地 `.env`。Codex 自定义 provider 的更多说明见 [Codex 配置参考](https://developers.openai.com/codex/config-reference)。

</details>

## 详细文档

- [VS Code 使用说明](apps/vscode-extension/README.md)：安装、连接、设计接入和常见问题
- [CLI 使用说明](apps/agent-cli/README.md)：命令、交互、脚本接口、诊断和交付查询
- [开发说明](DEVELOPMENT.md)：源码调试、浏览器联调、VSIX 打包和协议验证
- [Codex 接入说明](packages/codex-client/README.md)：Codex 配置、规则和请求检查
- [D2C 模型生成结果对比](D2C_MODEL_COMPARISON.md)：本轮产物质量、Token、耗时及统计限制

项目使用 React、TypeScript、Ant Design、Vite、Fastify、Zod 和 `@modelcontextprotocol/sdk`。项目分工、任务流程和关键设计见 [ui-forge 项目架构](https://hyy215.github.io/ai/ui-forge-project-architecture)。
