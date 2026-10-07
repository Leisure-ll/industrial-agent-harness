# Linux Chip Installer v0.1.0-preview.5

2026-10-07 · 候选版本，尚未发布。修复会话输出、外部 MCP 连续性与共享工程执行边界；增加无模型环境预检和实际升级验收。

## 本版变化

- Kimi Code 固定为 2.1.1，沿用原生 Agent Loop、Skill、持久化和自动压缩。多步文本/思考流保留完整内容；子 Agent 审批显示拥有者并支持批准、拒绝和取消。
- 外部 MCP 在同一聊天/服务内复用连接和 stdio 进程；其他聊天独立。关闭聊天清理服务，空闲五分钟回收；断连/过期后明确失败，不重建并自动重发操作。调用超时可由注册配置 requestTimeoutMs 指定。
- 审批展示文件差异、实际任务命令/依赖以及 MCP 参数，长预览标记截断。审批请求固定，等待期间的输入变化不能替换实际请求；执行仍重查状态、哈希和 Scope。
- 工作区支持 workspace.inputs/ignore，略过无关超大文件、链接或不可读目录并返回诊断；声明任务的输入始终检查。增量哈希减少重复读取，改动文件用有界流式读取。
- 本地任务仅读取系统/工具安装目录、输入快照和显式 readOnlyDirs；保留虚拟环境入口。取消按调用聊天隔离，关闭 Runtime 等待外部服务清理。
- `industrial-harness-chip doctor --project-dir /absolute/project` 无需模型密钥，实际探测受保护执行，并检查声明工具、依赖和离线镜像；环境未就绪退出 2，不将预检当作工程通过。

## 从 preview.4 升级

发布后运行该版本附件中的 install-chip-linux.sh。自定义安装使用新 --prefix 与原 --bin-dir。
旧工程、模型配置、MCP 注册、资源开关、聊天和原生文件保留。Python Kimi 1.51.0 的旧聊天历史可读；首次继续时开启 Kimi Code 新上下文段，旧原生上下文不静默导入。新段继续由原生内核持久化。

## 验证与发布门禁

源码回归覆盖分步流、真实子审批、MCP 状态/隔离/过期/清理、审批输入冻结、工作区筛选/哈希/边界与无模型诊断。macOS 实际受保护任务和 Chip/PCB 创建→通过→失效→失败→修复链路由本地及原生 CI 验证。

候选 CI 新增实际 Desktop UI/语言切换；Linux 从公开 preview.4 安装，创建真实聊天、模型配置、MCP 注册与项目开关，再升级候选包续聊。upgrade-verification.json 记录旧历史保留、原生上下文分段、新段继续与配置保留；其余安装、共享任务、Docker 和 RTL 证据沿用既有门禁。未完成或失败的 CI 不允许发布。

## 限制

Linux 安装入口覆盖 x86-64 Chip；Windows 和 Linux ARM64 工业执行仍未资格验证。共享契约/桌面启动通过不等于这些平台的工业执行可用。

专业工具、模型、PDK 和签核配方仍由环境/工程/Skill 提供。MCP roots 不限制可信宿主服务的系统权限；CLI 退出结束连接，不承诺服务状态跨进程恢复。子问题仅验证协议转发，固定 coder Profile 未开放 AskUserQuestion。受控模型测试真实软件边界，不代表模型设计能力或工业签核。

配置和边界见[共享工程底座](../doc/shared-workspace.md)、[外部 MCP](../doc/external-mcp.md)与[迁移记录](../doc/kimi-code-migration.md)。
