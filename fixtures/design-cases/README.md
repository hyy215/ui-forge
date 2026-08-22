# Design fixtures

这里保存脱敏后的 MasterGo 标准化设计上下文、参考截图与期望 Token。

## `mastergo-table-filter.json`

- 来源：2026-08-17 通过 `@mastergo/magic-mcp@0.2.8` 抓取的表格筛选页面图层。
- 内容：完整 `getDesignSections` 目录与 23 个分段 DSL，共 177 个节点。
- 脱敏：真实短链、文件 ID 和来源地址已替换为 `fixture://mastergo-table-filter`；不包含令牌、请求头或 Cookie。
- 用途：MasterGo Adapter 离线标准化测试，以及作为 `mastergo-fixture` Provider 的 Server/Webview 固定默认联调数据；也可通过稳定引用 `table-filter` 明确选择。
