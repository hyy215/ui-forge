# D2C Storage 开发约定

本文件补充根目录 `AGENTS.md`，适用于 `packages/d2c-storage`。该包实现 `d2c-agent` 定义的设计 Artifact 持久化端口，不保存 D2C 任务或工作流状态。

## 目录与文件职责

```text
src/
├── fileDesignArtifactStore.ts  设计 Artifact 的安全文件存储 Adapter
└── d2cStorage.ts               包公共入口
```

- 文件实现负责规范化路径、符号链接防护、运行时 Schema 校验、原子写入和固定权限。
- 领域数据结构与生命周期端口来自 `d2c-agent`，不得重复定义业务状态。
- 本包不创建 Graph、D2C Service、设计来源 Adapter、定时器或 Server 生命周期对象。
- Artifact Store 只提供写入、读取、绑定、废弃和按截止时间清理能力；任务保留策略不属于本包。
- 测试覆盖损坏数据、路径逃逸、生命周期约束和只清理非当前 Artifact 等边界。
