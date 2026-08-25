# ui-forge

集成于 VS Code、面向 React + TypeScript 中后台项目的 D2C 智能体实验项目。

当前版本跑通设计读取和仓库证据驱动的审阅型规划：用户在单一对话视图中输入 Design URL，系统读取并缓存 MasterGo 设计上下文，从官方矢量与布局数据确定性合成安全 SVG 预览。用户检查右侧预览并在对话中精确回复“确认设计”后，Graph 首先确定性检查目标项目；不支持的项目立即结束，空目录进入初始化规划，React + Ant Design 项目继续生成组件候选并受控扫描源码。主 Plan Agent 通过受控工具委派独立视觉 Subagent 读取含文本的结构摘要、高细节整体 PNG 和候选局部图，形成组件、布局层级、可见元素、静态状态和交互理解；高置信度视觉遗漏项可提升为补充组件候选，并对这些候选补做受控仓库检索。主 Agent 再结合仓库组件、样式引用和反向依赖证据，通过受控方案提交工具生成复用决策、文件影响及原子实施步骤。提交门禁检查视觉覆盖、未解决交互、组件职责和文件生命周期。反馈修订、Patch、执行验证和交付仍属于后续能力，当前方案不能触发文件写入。

## 当前工作流

```mermaid
flowchart LR
    A[输入 Design URL] --> B[读取并标准化设计上下文]
    B --> P[直接提取官方矢量并合成高还原预览]
    P --> C[缓存大型设计 Artifact]
    C --> D[右侧默认展开安全 SVG 预览]
    D --> E[用户精确回复确认设计]
    E --> G[确定性检查目标项目]
    G -->|空目录| H[记录后续初始化项目步骤]
    G -->|React + Ant Design| I[通过项目支持校验]
    G -->|其他项目| J[终止并提示不支持]
    H --> A[通过官方 Ant Design MCP 解析版本化组件目录]
    I --> A
    A --> K[生成平台无关组件候选]
    K --> R[受控扫描仓库组件与依赖]
    R --> L[主 Plan Agent 委派视觉 Subagent]
    L --> M[理解组件、布局、可见元素与静态状态]
    M --> O[提升高置信度遗漏组件候选]
    O --> S{存在视觉补充候选}
    S -->|是| T[受控增量检索补充候选]
    S -->|否| Q[查询候选组件 API、语义结构、Token 与示例]
    T --> Q
    Q --> N[受控提交并校验复用决策、文件影响与原子步骤]
```

## 包边界

- `packages/agent-core`：领域无关的 Agent、受限 Deep Agent 与 LangGraph 封装。
- `packages/d2c-agent`：D2C 任务、设计与项目检查领域端口、平台无关候选证据、视觉 Subagent、主 Plan Agent、Graph 和对外 D2C Service。
- `packages/d2c-storage`：设计 Artifact 文件存储；不保存任务状态。
- `packages/mastergo-adapter`：实时 MasterGo MCP、脱敏 Fixture，以及 MasterGo DSL 到平台无关节点结构的适配。
- `packages/design-system-adapter`：Design Token、Ant Design 主题适配，以及官方 CLI stdio MCP 的版本化组件知识 Adapter。
- `packages/component-indexer`：目标项目的受控检查，以及基于 TypeScript AST 的组件、样式引用、消费者和检索证据提取。
- `packages/shared-protocol`：Server 与客户端之间的快照、命令和有序事件流 Schema。
- `apps/agent-server`：协议分发、快照投影与依赖装配。
- `apps/agent-webview`：在单一对话视图中完成 Design URL 输入、设计读取状态、右侧 SVG 检查、确定性口令确认、项目校验和方案审阅。
- `apps/vscode-extension`：VS Code Activity Bar 入口、任务面板承载与 Agent Server 通信转发。

D2C Service 是对外业务入口，负责命令、revision 和 Artifact 生命周期；D2C Graph 只负责节点拓扑与状态转换。每个 Service 复用同一个编译 Graph，不为不同任务或命令重复创建 Graph。

`packages/d2c-agent/src/planning` 已提供独立但尚未接入当前 Graph 的可演进 Plan 领域基础：人工确认的布局、组件和交互字段可以锁定，后续代码阶段只能通过版本化 `PlanDelta` 调整未锁字段和执行细节；受影响步骤的旧 Patch 绑定会失效，锁冲突必须返回人工决定。该基础不会让当前审阅页面产生 Patch 或执行代码。

## 安全约束

- Agent Server 仅允许监听 localhost、IPv4 loopback 或 IPv6 loopback；当前版本不支持局域网或公网部署，`UI_FORGE_HOST` 配置为非回环地址时启动会直接失败。
- MasterGo 输出视为不可信输入；SVG 预览拒绝脚本、事件处理器、`foreignObject`、样式表和外部资源。
- 目标项目检查只读取根目录最小工程证据，不向模型开放任意 Shell 或文件系统访问；对客户端裁剪绝对路径和原始清单。
- 原始设计数据保存在独立 Artifact 中，Checkpoint 只持有轻量引用；未绑定、已放弃或被替代的 Artifact 会按配置回收。
- 候选提取节点只消费受限的平台无关节点证据，不向模型发送原始设计 JSON；视觉 Subagent 仅接收压缩候选、含有限文本的结构摘要、受控整体 PNG 和候选裁剪图，结构超限或图片不可用时明确降级。静态稿交互只能标记为推断或未解决，未解决交互不能进入实施步骤。
- 仓库分析只读取任务绑定目录中的有限普通文件，忽略依赖、构建目录和符号链接；模型只能引用扫描到的既有文件或安全的新建相对路径。当前不渲染仓库组件，因此不会把结构匹配宣称为像素级一致。
- 主 Plan Agent 不设固定运行时限；对话栏展示各阶段耗时、Ant Design MCP 查询和模型返回的 Token 用量，用户可随时终止当前分析，取消信号会贯穿目录查询、仓库分析、视觉证据和模型调用。Tool 提示、视觉建议、官方组件知识、最终类型和选择原因分别保留，最终语义由主 Agent 决策。
- Ant Design MCP 使用本地安装的官方 CLI 和打包元数据，不在运行时调用 `npx`；目标项目目录用于自动识别 antd 版本，更新检查和自动问题上报保持关闭。目录查询失败时显式降级，缺少官方查询证据时不得声称复用 Ant Design 组件。
- 组件语义不复用 MasterGo 的 `COMPONENT`/`INSTANCE` 节点角色。人工目录提供业务别名和子组件映射，并与官方 MCP 清单合并；目录别名只作为提示，不声明符合某种 MasterGo 标准画法。

## 本地运行

```bash
npm install
npm run check
npm run build
npm run dev:server
npm run dev:webview
```

在 VS Code 的“运行和调试”中启动 `ui-forge: Server + VS Code`，然后从 Activity Bar 打开 ui-forge；可通过视图标题栏中的“创建任务”按钮进入任务设置页面。

复制 `.env.example` 为 `.env`。实时 MasterGo 读取需要 `MG_MCP_TOKEN`；模型配置使用 `MODEL_PROVIDER`、`MODEL_NAME`、`MODEL_API_KEY` 和可选的 `MODEL_BASE_URL`。结构化响应默认采用兼容 thinking mode 的 `MODEL_STRUCTURED_OUTPUT_MODE=json-text`，明确支持强制工具选择的模型可改为 `tool`。`UI_FORGE_COMPONENT_CATALOG_PATH` 可指向由 Server 启动者管理并通过 Schema 校验的人工组件目录 JSON；运行时会将其与目标版本的官方 Ant Design MCP 清单合并。`DATABASE_URL` 用于持久化 LangGraph Checkpoint；原始设计 Artifact 默认写入 `.ui-forge/artifacts`。

无需在线 MasterGo 的本地联调可设置：

```dotenv
UI_FORGE_DESIGN_PROVIDER=mastergo-fixture
```

界面可以填写普通 MasterGo 引用，也可以使用固定引用 `table-filter`。Fixture 只读取仓库明确登记的脱敏样本，不把客户端输入解释为本地路径。

## 后续占位方向

- 更完整的 Design Token 语义匹配与仓库组件渲染比较
- 用户反馈驱动的方案修订
- 可审批 Patch 与受控写入
- 构建、页面渲染和视觉验证

这些能力在真正实现前不会以静态方案或演示数据伪装为可用结果。
