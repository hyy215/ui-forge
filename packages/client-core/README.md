# @ui-forge/client-core

页面、CLI 和 Extension 共用的纯通信与展示处理。只依赖 `shared-protocol` 和 Zod，不启动进程、不调用 HTTP，也不持有任务执行状态。

- `readCommunicationStream`：读取 NDJSON，校验请求身份与顺序；完成、失败、取消或消费者退出时释放 reader。
- `applySessionEvent`：按原生线程、轮次和 item 标识归并展示数据。Server 复用它生成重连快照，页面复用它处理快照和增量。
- `requestItem`：按线程、轮次和 item 定位审批预览。活动缓存保留最近 80 条及待处理审批关联的 item。

Server 的重连输出依次为原生主线程快照、缓存的计划/差异/子线程活动、建立快照后到达的新事件。审批有效性与 start、steer、interrupt 决策仍由 Server 查询 Codex 确定。

测试位于 `src/*.test.ts`；跨入口重连和审批预览测试位于 [sessionEventHub.test.ts](../../apps/agent-server/src/sessions/sessionEventHub.test.ts)。
