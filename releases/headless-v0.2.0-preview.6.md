# Headless v0.2.0-preview.6

2026-10-05 · 所有领域的 CLI 补齐工程初始化、受控编辑、声明任务与证据读取；外部 MCP 进入共享宿主 Runtime，支持打包后的真实 Kimi 会话。

## 下载哪个包

Chip、PCB、Godot、CAD 分别下载 `industrial-agent-harness-cli-<domain>-headless-v0.2.0-preview.6.tar.gz`；跨领域下载 `industrial-agent-harness-headless-headless-v0.2.0-preview.6.tar.gz`。每个归档附同名 `.sha256`，需保留整个解压目录。Linux Chip 一键安装见 [preview.4](https://github.com/Zhiman-BJ/industrial-agent-harness/releases/tag/chip-linux-installer-v0.1.0-preview.4)。

需要 Node.js 22.13+、Kimi CLI 1.51.0 和模型凭据；专业 Pack 的 Python、软件、镜像和资料按各 Pack 安装。归档不捆绑模型凭据、PDK 或用户工程。

## 相比原生 Kimi Code 集成了什么

- **共同工程底座**：所有领域都可从空目录开始。共享 `project.work` Skill 和五个工具创建工程、读取文件/哈希、按前提创建/修改/删除、查看并执行声明任务。专业配置创建或修复后检查事实并更新 Scope，通用工具始终保留。
- **输入与证据分离**：修改使先前验收 stale，保留历史产物和 Checkpoint。任务使用只读输入快照和全新输出目录；日志、执行身份和严格 JSON 检查报告进入 canonical Action/Artifact/Verifier。没有检查、报告无效或执行超时不会被退出码零掩盖。
- **受控宿主执行**：macOS arm64 使用 Seatbelt，Linux x86-64 使用 bubblewrap/seccomp；禁止任务联网和写原工程/证据。Docker 支持真实镜像 ID、CPU/内存/PID 限额与清理。任务参数由 `harness.tasks.json` 声明，不接受模型临时替换命令。
- **用户注册的外部 MCP**：打包 CLI 的 `mcp add/list/refresh/remove/enable/disable/inherit` 与 Desktop 共用配置。stdio/HTTP/SSE 工具经宿主 Runtime 审批和 Scope/参数/快照重查；响应脱敏、分页及图片输入可用。外部结果保持 not_run，不覆盖工程验收，不自动重试未知副作用。
- **沿用专业运行时**：保留 Chip EDA Harness 0.6.1 的宿主环境检查、RTL 和资源保护，以及 PCB/Godot/CAD Pack 声明。通用基础工具不挤占专业能力的 Broker 选择额度。

接口、任务样例和配置说明见 [共享工程底座](../doc/shared-workspace.md)、[外部 MCP](../doc/external-mcp.md) 与 [CLI 文档](../apps/cli/README.md)。

## 安装和迁移

解压到新目录，核验同名 `.sha256`，按对应 Pack 文档准备固定环境。保留现有工程与资源配置；无需将旧工程迁移为新格式。新通用任务在工程内显式创建 `harness.tasks.json`，已有专业配置继续生效。

```sh
node industrial-harness.cjs mcp add --file /absolute/path/mcp.json
node industrial-harness.cjs run --domain chip --project-dir /absolute/project --task '初始化工程并运行声明的测试' --approval approve
```

`--approval approve` 自动批准这一轮的待审批操作；默认策略是 reject。只添加可信的宿主 MCP 服务。

## 验证

本地实际固定 Kimi + Chip/PCB CLI、macOS 保护任务、Docker、stdio/HTTP/SSE 和打包消费者已验证，另覆盖文件前提/越界/批次回滚、历史、既有 RTL/恢复、架构与发布契约。新增 CI 门禁在原生 macOS/Linux、独立分包及实际 Linux 安装消费者运行通用生命周期，检查 MCP 拒绝/批准/禁用/图片/脱敏。发布工作流再次验证解压后的 Chip/PCB CLI，随附 `workspace-chip-verification.json`、`workspace-pcb-verification.json`。

## 尚未集成

- Windows 原生 Agent/任务执行；没有 Linux bubblewrap 或 macOS Seatbelt 时不降级为无保护执行。
- 自动安装任意工具、任务依赖或外部 MCP；远程 MCP OAuth 登录尚未实现。原生应用控制插件仍有独立限制。
- 领域签核规则、SRAM/MPW 平台、ISA 参考模型、模拟/物理验收流程及其离线规范库。这些由依赖、工程、领域 Pack/Skill 提供。
- 本地任务的 CPU/内存/PID 硬配额；需要这些限制时使用 Docker。
