# Domain MCP

Exposes compact discovery, selected tool schemas, and scoped calls backed by a declared domain Runtime.

默认已注册 Chip Pack EDA Harness 0.6.0：25 个 canonical Tool ID，固定源码与 Python MCP 依赖。Desktop 与 CLI 共用此注册和策略，按当前 Scope 生成独立 Kimi 会话 mcp.json。
PCB 同时注册 `pcb-bench.tools`：89 个工具来自固定的外部 PCB-bench 后端，设计 Skill 加载完整资源树。配置与实际协议已验证，原生镜像执行仍待实测；安装与约束见 [PCB MCP 接入](../../doc/pcb-mcp-integration.md)。
受控 Gateway 只披露 discovery/describe/call/result-read 四个工具，在真正调用时校验范围、项目路径和参数。普通直连 provider 仍要求全部声明工具在 Scope 内。

注册数据来自仓库校验过的 Domain Pack 清单；项目只能保存稳定资源 ID 的启用策略，不能添加任意启动命令。配置 UI 提供全局默认与项目三态覆盖。缺少依赖时返回安装路径指引，不自动安装软件，不修改用户全局 Kimi 设置。

共享网关、安装、分页与真实验证见 [Chip Pack MCP 接入](../../doc/domain-mcp-integration.md)。

`ExternalMcpRegistry` 是显式用户注册的独立入口，保存在用户私有配置目录；项目不能自行提供启动命令。支持 stdio、Streamable HTTP、SSE 和凭据环境引用。Desktop / CLI 共用注册快照、策略和 `harness.external` Gateway；外部 canonical Tool ID 加入有效 Scope 后，四个入口按需发现/schema/调用/分页，执行前重查 Scope、参数和 live 工具快照。实际调用标为 mutating，沿用 Kimi 审批；图片保持 ImageContent，文字有界、分页并脱敏。外部 host 服务不产生工业验收事实，roots 不是 OS 沙箱。行为、限制与测试见 [外部 MCP](../../doc/external-mcp.md)。
