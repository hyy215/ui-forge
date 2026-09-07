# 百炼模型与性能配置

本轮实现优化现有设计读取和审阅型规划链路。保持 MasterGo Magic MCP 的 URL 集成方式，不需要打开 MasterGo 或选中桌面视图。

## 推荐配置

复制根目录 `.env.example`，配置 `MODEL_API_KEY`。`MODEL_BASE_URL` 可填写当前百炼业务空间的兼容 API 地址；留空使用 DashScope 兼容端点。不要把密钥写入版本控制。

| 阶段 | 均衡预设 | 思考策略 |
| --- | --- | --- |
| 视觉理解 | qwen3.7-plus | 关闭 |
| 规划 | qwen3.7-plus | 开启，4096 tokens |
| JSON 校正 | qwen3.8-flash | 关闭，仅在格式失败时调用 |
| 规划业务校验后的升级 | qwen3.8-max | 开启，8192 tokens |

预设开关为 `MODEL_PROFILE=bailian-balanced`。不配置该变量或设置 `legacy` 时保留原配置行为。显式的 `MODEL_NAME` 会作为所有阶段的继承值；`MODEL_PLAN_NAME`、`MODEL_VISION_NAME`、`MODEL_REPAIR_NAME`、`MODEL_ESCALATION_NAME` 优先级更高。升级模型与主模型相同时不另建升级实例。

每个阶段均支持 `MODEL_<阶段>_PROVIDER`、`NAME`、`API_KEY`、`BASE_URL`、`THINKING`、`THINKING_BUDGET`、`REASONING_EFFORT`、`MAXIMUM_OUTPUT_TOKENS`、`STRUCTURED_OUTPUT_MODE`。凭据和端点默认继承通用配置。推理预算与强度二选一；关闭思考时不能设置这两项。输出上限可选，过小会截断 JSON，运行时会停止并报告预算耗尽。

百炼官方文档列明支持的 Qwen3.7 Plus/Max/Flash 和 Qwen3.8 Max/Flash 使用原生 `json-schema`；DeepSeek V4 使用 `json-text` 后进行本地 Schema 校验。预设在两种情况下都使用无工具模型调用。`tool` 保留旧的工具规划方式，只供已确认兼容强制工具选择的模型使用。

DeepSeek 通过百炼调用时仍使用 `MODEL_PROVIDER=bailian`。`MODEL_PROVIDER=deepseek` 代表 DeepSeek 官方端点，不可混用。对照规划模型可配置：

```dotenv
MODEL_PROFILE=bailian-balanced
MODEL_PROVIDER=bailian
MODEL_PLAN_NAME=deepseek-v4-pro-0813
MODEL_PLAN_THINKING=true
MODEL_PLAN_THINKING_BUDGET=
MODEL_PLAN_REASONING_EFFORT=low
```

选定生产型号后，使用所在地域已开通的快照版本并保存配置。这里只验证请求适配和固定样本行为，尚未使用真实百炼凭据测量各型号的 D2C 质量或端到端速度。

参数依据：[模型选型](https://help.aliyun.com/zh/model-studio/text-generation-model/)、[结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)、[思考参数](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、[DeepSeek 接入](https://help.aliyun.com/zh/model-studio/deepseek-api)。型号和地域能力以实际开通服务为准。

## 已接入的优化

- 一次 MasterGo 检查复用一个 MCP 进程，已知 DSL 分段最多四路并发，SVG 页按 hasMore 顺序读取，结束时释放连接。
- 安全 SVG 只栅格化一次，整体图和局部图复用像素缓冲区；拒绝超过 1600 万像素的输入。局部图优先分配给没有目录提示的候选，重复区域只发送一次。
- 视觉模型接收任务目标、候选来源节点和结构摘要；摘要优先保留候选及其祖先，再保留文本节点，明确标记截断。
- 仓库扫描生成本轮不可变组件摘要；不超过 2 MB 时，视觉补充候选查询同一快照。超过上限时不缓存索引，补充候选回退到受控扫描并给出警告。再次规划应重新扫描，未来文件写入仍必须单独检查文件版本。
- 官方组件知识按项目、antd 版本、根组件和知识类别缓存一分钟，总量最多 4 MB / 128 项；失败结果不缓存。
- 规划前按最多三路并发准备候选知识。精简模型输出，程序生成文件和组件汇总；失败时只携带上一份提交及错误重试。业务修正总共最多三次提交，相同错误连续出现且没有新增知识时停止。取消和输出预算耗尽不会触发模型升级。
- SDK 隐式重试关闭；原有安全传输重试最多一次，格式校正最多一次。正常流程一次视觉推理加一次规划推理，不能把修复路径也计为两次请求。

原始设计预览来自 DSL 和官方矢量合成，字体和布局还原仍存在局限。模型判断不能作为原始设计截图或真实运行页面的视觉验收结果。

## 评测

模型安全日志记录 stage、model、provider、请求次数、首包耗时、完成耗时及供应商实际报告的输入、输出、思考和缓存 Token；不记录提示词或思考正文。缺失用量保持缺失，本地 tokenizer 估算不作为百炼真实计费数据。

构建后可生成离线报告：

```bash
node packages/eval-runner/dist/modelRunReportCli.js <任务日志.jsonl> > <报告.json>
```

报告保留白名单原始事件，按模型和阶段计算请求数、失败数、p50/p95 和已报告 Token。它只统计模型推理，不代表页面总耗时、质量评分或费用；费用应使用实际地域和日期的计费单价计算。分段日志需先按原顺序汇总后输入，单次输入上限 16 MB。

在线对照使用同一组设计、目标仓库快照与依赖，比较 Plus 主力、Qwen 视觉 + DeepSeek 规划、Max 主力三组配置，每组重复运行并保存原始报告。人工复核组件遗漏、错误复用、布局理解及文件影响，同时记录 MCP、仓库分析和模型耗时。用户提供的 9 分 15 秒是待复测的参考值，不能作为本轮优化收益。

## 后续实施边界

本轮没有接入用户反馈后的 PlanDelta、Patch 生成及批准后写入，也没有实现生成页面的构建、截图与视觉修复。这些仍按完整方案的后续阶段交付，现有 UI 不宣称这些能力可用。规划升级只处理可确定的方案校验错误；视觉质量升级阈值需要真实页面评测后确定。
