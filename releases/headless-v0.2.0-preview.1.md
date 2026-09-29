# Headless v0.2.0-preview.1

2026-09-29 · 面向场景测试的 CLI 预发布版本。这版首次提供 Chip / PCB / Godot 分包，无需克隆仓库或安装 pnpm。三个包默认绑定所选领域，保留原有多领域包。

## 下载哪个包

| 归档 | 当前可用能力 | 额外依赖与限制 |
| --- | --- | --- |
| `industrial-agent-harness-cli-chip-headless-v0.2.0-preview.1.tar.gz` | Broker、四份 Chip Skill、共享 MCP Gateway、EDA Harness 0.6.0 固定源码与 25 工具映射 | MCP 需要 Python 3.13 和锁定依赖；实际工业计算另需 Docker、EDA 工具镜像及工程输入/适用 PDK。包内没有镜像 |
| `industrial-agent-harness-cli-pcb-headless-v0.2.0-preview.1.tar.gz` | PCB 检查 Skill、Broker、普通 Kimi 项目任务 | 没有 PCB 工业 MCP、KiCad 镜像或 kicad-cli，不能据此运行 DRC/ERC |
| `industrial-agent-harness-cli-godot-headless-v0.2.0-preview.1.tar.gz` | Godot 领域绑定、普通 Kimi 项目任务 | 没有 Godot MCP、引擎或领域 Skill；不包含 Viewer |
| `industrial-agent-harness-headless-headless-v0.2.0-preview.1.tar.gz` | 上述共享能力的多领域版本 | 每次运行需要明确 `--domain`，适合跨领域 Bench |

每个归档都提供同名 `.sha256` 校验文件。所有包仅包含 CLI，不含 Electron 或桌面 Viewer。每包的 `PACKAGE.json` 记录固定源码提交与 provider 版本。

## 安装和首次运行

先安装 Node.js **22.13+**。下载对应归档和校验文件，在同一目录校验、解压。下面以 Chip 为例：

```sh
shasum -a 256 -c industrial-agent-harness-cli-chip-headless-v0.2.0-preview.1.tar.gz.sha256
tar -xzf industrial-agent-harness-cli-chip-headless-v0.2.0-preview.1.tar.gz
cd headless-chip
node industrial-harness.cjs run --project-dir /absolute/existing/project --task '检查工程状态' --scope-only
```

Linux 可用 `sha256sum -c`。PCB/Godot 分别解压到 `headless-pcb` / `headless-godot`。`--scope-only` 不需要模型凭据、Kimi CLI 或 Python，不创建聊天，也不执行工程检查；它验证注册与能力选择。

真实 Agent 运行需要另外安装 uv、Python **3.13** 和 Kimi CLI **1.51.0**。在包外建立独立环境，不修改全局 Kimi 配置：

```sh
uv venv --python 3.13 /absolute/path/harness-kimi
uv pip install --python /absolute/path/harness-kimi/bin/python 'kimi-cli==1.51.0'
export KIMI_EXECUTABLE=/absolute/path/harness-kimi/bin/kimi
```

配置 `KIMI_API_KEY` 后，在所选包目录运行：

```sh
node industrial-harness.cjs run --project-dir /absolute/existing/project --task '检查项目文件' --approval reject
```

默认拒绝需要审批的调用。只有显式选择自动批准时才使用 `--approval approve`。模型密钥通过环境变量设置，勿写入任务文本或命令参数。其他模型 provider 可用 CLI 的 `--provider` / `--endpoint` / `--model` 配置。

Chip MCP 另需在解压包内准备固定环境：

```sh
cd domain-packs/chip/eda-harness
uv sync --frozen --no-dev --python 3.13
cd ../../..
node industrial-harness.cjs run --project-dir /absolute/existing/project --task '检查工程状态' --approval approve
```

可检查服务和环境；已有工程需 `eda.yaml`，初始化与计算需另外准备工具镜像。不会自动下载镜像或 PDK。移动包以后，保留整个目录结构，并重新设置指向外部 Kimi 环境的路径。

## 相比原生 Kimi Code 集成了什么

- **按领域分包**：每包只注册所属领域的 Skill、Capability 和 MCP；显式切换到其他领域会拒绝。PCB/Godot 包不携带 Chip 源码。
- **Chip Pack MCP**：Desktop 与 CLI 共用项目绑定、资源启用策略和 Broker Scope。Gateway 提供工具发现、单项 schema、调用、结果分页；执行时再次校验范围和参数，再进入现有 EDA Runtime。
- **审批和持久上下文**：沿用 Kimi 审批与会话运行机制；CLI 保留聊天、原始日志及上下文快照。EDA 上下文通过 MCP 读取，Core 的文件观察状态明确保持 `not_run`。
- **逐步披露**：只加载当前 Scope 的 Skill 与工具；大结果分页读取。MCP 可按全局、项目或单次运行策略禁用。

Agent 会话、模型调用、工具循环、原生压缩仍由 Kimi Code 提供，Harness 没有重写这些功能。

## 验证范围

发布前已在 macOS 验证全部单元测试与架构检查，三个解压包的领域绑定、资源筛选和跨领域拒绝，以及 Chip 的真实 MCP / 固定 Kimi CLI 调用、批准后持久化和拒绝后无修改。模型响应由本地受控 fixture 提供，不构成真实模型或工业 signoff 验收。

发布流水线在 Linux 重新运行测试，验证实际 MCP、三个解压包，以及解压后 Chip 的审批和上下文读取；这些检查通过后才发布归档。没有 Windows 包验收或完整芯片计算验收。

## 尚未集成

- PCB MCP、KiCad 镜像、DRC/ERC 执行，以及 Godot MCP/引擎能力未接入。
- 包内不含 Kimi CLI、Python 虚拟环境、模型凭据、工业软件镜像或桌面 Viewer。
- Chip 的注册与上下文接通不等于 Core 的 Project → DomainState → Action → Artifact → Verifier → Checkpoint 工业闭环完成。
- 文件观察、Scope 烟测、进程成功、报告导出均不能单独证明工程目标满足。

[分包文档](https://github.com/Zhiman-BJ/industrial-agent-harness/blob/headless-v0.2.0-preview.1/doc/domain-cli-downloads.md) · [MCP 接入](https://github.com/Zhiman-BJ/industrial-agent-harness/blob/headless-v0.2.0-preview.1/doc/domain-mcp-integration.md) · [Chip 镜像准备](https://github.com/Zhiman-BJ/industrial-agent-harness/blob/headless-v0.2.0-preview.1/domain-packs/chip/README.md)
