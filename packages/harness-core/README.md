# Harness core

Shared project-domain Broker resolution and resource enablement policy for Desktop and CLI. Global defaults and project overrides store only stable resource IDs; an absent project override inherits the global default. Scope and capability detail use the same effective disabled lists before Kimi materializes Skills or selects scoped MCP providers.

`ResourceSettings` reads and atomically writes `~/.industrial-agent-harness/resource-settings.json` (0600), or the directory supplied by `INDUSTRIAL_HARNESS_CONFIG_DIR`. Projects are keyed by their canonical filesystem directory. Legacy desktop disabled IDs migrate once to explicit project overrides. Corrupt settings fail explicitly rather than silently replacing policy. This package does not implement an agent loop, industrial execution, or MCP Gateway.

`ChatStore` 保存产品聊天、每轮展示事件和不透明的 Agent 运行时关联，提供 Project/Domain 隔离、分页、跨进程执行锁和中断标记。它不依赖 Kimi/Electron，也不保存或压缩模型上下文；Desktop/CLI 共用该存储。见 [聊天持久化](../../doc/chat-persistence.md)。

每次资源策略解析只枚举一次禁用 MCP Provider，按 Domain 建立工具集合，再筛选 Capability；资源和 Provider 仍在每次请求重新读取。`ChatStore` 在数据库连接内复用 prepared statements，并为运行中的轮次与聊天运行时关联建立索引；关闭连接时清理语句引用，持久化字段和接口保持兼容。

`resourceCatalog` 与 `resolveProjectTask` 接受显式注册的外部 MCP 快照，按同一资源策略把 canonical Tool ID 加入最终 Scope 并记录 Trace；不增加领域/工业 Capability。`ExternalMcpRegistry` facade 来自 domain-mcp，连接和 Gateway 留在下层包。外部结果不进入工业状态或验证，见 [外部 MCP](../../doc/external-mcp.md)。
