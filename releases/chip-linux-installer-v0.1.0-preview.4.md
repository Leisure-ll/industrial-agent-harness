# Linux Chip Installer v0.1.0-preview.4

2026-10-05 · 补齐所有领域共用的工程初始化、受控文件修改、声明任务执行与检查证据读取；打包 CLI 接入用户注册的外部 MCP。沿用 preview.3 的宿主 Docker helper 修复与私有运行时。

## 下载与安装

```bash
wget -O install-chip-linux.sh https://github.com/Zhiman-BJ/industrial-agent-harness/releases/download/chip-linux-installer-v0.1.0-preview.4/install-chip-linux.sh && bash install-chip-linux.sh
```

以实际使用的普通用户运行。入口与内置归档校验 SHA-256；默认安装目录为 `~/.local/share/industrial-harness/chip-linux-installer-v0.1.0-preview.4`，启动命令为 `~/.local/bin/industrial-harness-chip`。私有运行时为 Node 24.12.0、uv 0.11.6、Python 3.13 与 Kimi CLI 1.51.0。宿主需要允许 bubblewrap 用户/PID 命名空间；Docker 后端需要有效的宿主 Docker 权限。

## 本版内容

- **从空工程开始**：不再要求先存在 `eda.yaml`。共享 `project.work` Skill 与五个工具提供初始化、文件及哈希读取、创建/修改/删除、任务查看与执行。创建领域配置后重新检查事实并更新 Scope；配置损坏时仍可通过通用入口修复。
- **可靠修改和历史**：修改/删除必须匹配读取时的 SHA-256，批次先检查所有前提，失败回滚。拒绝工程外路径、链接、依赖和 Runtime 证据目录；源码修改使之前验收变为 stale，历史产物与 Checkpoint 保留。
- **执行已声明的 CLI 任务**：工程的 `harness.tasks.json` 定义命令参数、精确输入、输出与检查报告。宿主 Runtime 在只读输入快照和独立输出目录执行，本地任务禁止网络与宿主 socket；Docker 使用真实镜像 ID、资源限制和容器清理。退出码零不等于检查通过，缺报告、超时和取消保留诊断与未充分验证状态。
- **外部 MCP 可用于真实会话**：`industrial-harness-chip mcp add --file /absolute/path/mcp.json` 注册 stdio、Streamable HTTP 或 SSE；支持列表、刷新、移除及全局/工程开关。模型按需发现工具，经宿主 Runtime 审批、参数/Scope/快照重查调用，保存脱敏响应；图片可传给启用视觉输入的模型。外部观察不覆盖工程验收，未知副作用不自动重试。
- **所有领域共用底座**：相同能力由共享 Core/Runtime 提供，Desktop 与 CLI 使用同一条执行路径。专业软件、规则、模型与流程通过安装依赖、工程配置和领域 Skill 提供，无需为每种软件新增 Core 工具。

详见 [共享工程底座](../doc/shared-workspace.md) 与 [外部 MCP 配置](../doc/external-mcp.md)。CLI 默认拒绝待审批操作，需明确配置审批策略后执行。

## 从 preview.3 升级

执行新版安装命令。安装验证后切换受管理启动入口，保留旧安装目录、工程与模型配置。自定义安装使用新的 `--prefix` 和原来的 `--bin-dir`。安装器不修改现有工程的 `eda.yaml` 或 `harness.tasks.json`；已有镜像可继续由工程显式指定。

## 验证范围

本地验证覆盖真实固定 Kimi 与 Chip/PCB CLI 的空工程→创建→通过→修改失效→失败→修复→通过、实际 macOS 受保护任务、实际 Docker 任务、文件边界与批次失败回滚、stdio/HTTP/SSE、MCP 审批/禁用/图片/脱敏，以及既有 RTL、恢复和发布契约。

新增 CI 门禁要求原生 macOS/Linux、独立分包和实际 Linux 安装消费者重复该链路；Linux 另运行实际 Docker 任务、preview.3 升级保留和既有本地/Docker RTL。发布工作流仅在安装资格检查通过后公开附件。`workspace-verification.json` 与原有安装、Docker、升级验证附件记录安装消费者结果。受控模型推动真实 SDK/Runtime，不作为模型设计能力的评测。

## 限制

- 本安装入口覆盖 Linux x86-64 Chip；其他领域的独立 CLI 见 headless-v0.2.0-preview.8。Windows 的原生 Agent/任务执行尚未资格验证。
- 任务依赖和 Docker 镜像必须事先准备。通用 JSON 检查只验收所声明断言；生产签核、ISA 参考模型、PDK、SRAM/pad 与专业规则仍由工程提供。本地任务仅限制时间和日志，CPU/内存/PID 配额使用 Docker。
- 外部 MCP 是用户信任的宿主服务，MCP roots 提供上下文，不限制服务访问工程之外的系统；服务所需软件、认证和操作系统权限由用户配置。
- 模型原生 Shell/WriteFile 保持原有隔离边界，工业执行与项目修改使用共享 Runtime 入口。
