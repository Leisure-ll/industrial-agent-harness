# Linux Chip Installer v0.1.0-preview.3

2026-10-04 · 修复 Linux Chip CLI 的 Docker helper 与受保护 Agent 环境检查路径。从干净、已提交的源码构建，沿用 preview.2 的私有运行时、项目 Skill 发现与工业执行边界。

## 下载与安装

```bash
wget -O install-chip-linux.sh https://github.com/Zhiman-BJ/industrial-agent-harness/releases/download/chip-linux-installer-v0.1.0-preview.3/install-chip-linux.sh && bash install-chip-linux.sh
```

以实际使用的普通用户运行。Ubuntu 22.04/24.04/26.04、Debian 12/13 可准备缺少的 curl、bubblewrap；自动安装 Docker Engine 需要 systemd。主机须允许 bubblewrap 用户和 PID 命名空间。入口和内置 CLI 归档均校验 SHA-256。

默认安装目录为 `~/.local/share/industrial-harness/chip-linux-installer-v0.1.0-preview.3`，启动命令为 `~/.local/bin/industrial-harness-chip`，默认构建镜像为 `eda-harness-tools:chip-linux-installer-v0.1.0-preview.3`。私有运行时仍为 Node 24.12.0、uv 0.11.6、Python 3.13 与 Kimi CLI 1.51.0。

## 修复内容

- **Docker 不再无条件调用 sg**：进程已有有效 Docker 组权限或以 root 运行时，helper 直接调用真实客户端。Docker 操作失败不会自动通过 sg 重试，避免重复执行修改。只有尚未激活的组权限需要 sg；`no_new_privs` 沙箱中明确说明应走宿主 Runtime，避免触发 `Cannot open audit interface - aborting`。
- **升级旧 helper**：重新安装会更新受管理的旧 helper；即使旧 helper 已在 PATH 中，也会找到真实 Docker 客户端，避免 helper 自我递归。
- **宿主环境检查**：已有 RTL 工程的 Scope 提供 `chip.environment.check`，用 `industrial_action_call` 和 `inputs: {}` 查询宿主 Domain Runtime 的 RTL 工具、输入与 Docker。就绪结果位于 Action diagnostics；沙箱 Shell 或旧 MCP 的 Docker 拒绝不再作为宿主故障判断依据。
- **保留工程验收**：只读检查仍核对项目、Scope 与当前 State，并保存 Action/Checkpoint。检查成功或失败均保留原工程 State、产物和验收身份；环境就绪不等于工程验证通过。

## 从 preview.2 升级

执行上面的新版安装命令。新版安装验证后切换受管理的启动入口，旧安装目录、工程和模型配置保留。自定义安装请使用新的 `--prefix /absolute/path`，沿用原来的 `--bin-dir /absolute/bin`。现有工程继续使用声明的旧镜像也可以；需要本版镜像时自行更新 `eda.yaml` 的 `runtime.image`，安装器不会修改工程配置。

## 验证范围

发布门禁覆盖 helper 参数传递、操作失败不重试、旧 helper 升级、真实 bubblewrap/seccomp 下的拒绝诊断，以及只读检查成功/失败和 Scope 拒绝时的工程证据保留。Ubuntu 22.04 x86-64 的实际安装 CLI 经固定 Kimi 运行宿主环境检查和 Verilator 5.026 RTL 验证，分别验证本地与 Docker 后端、带空格的 Docker 工程路径、沙箱直接 Docker 拒绝和持久 Checkpoint。升级检查使用已发布 preview.2，重复安装和干净构建身份也进入门禁。

随附 `verification.json`、`docker-runtime-verification.json`、`upgrade-verification.json` 和安装收据记录实际结果。Docker 回归使用 CI 构建的 Verilator 测试镜像，其身份另附；这不代表发布了预构建完整 EDA 镜像。确定性模型响应用于推动真实 SDK/Runtime，不是外网模型能力评测。

## 限制

- 宿主检查入口要求工程已有 `eda.yaml`、声明的 RTL/testbench 及 StateProvider 确认的 RTL 阶段。未新增工程初始化、源码写入或综合/布局布线的 Core Tool；旧 MCP 修改仍受 Agent 边界限制。
- Agent 的 Shell/子 MCP 仍不能直接访问宿主 Docker socket。审批参数不会解除操作系统权限限制；批准的 RTL 工业动作走宿主 Runtime。
- 模型凭据、工程、PDK、约束与签核规则由使用者提供。安装检查和 RTL testbench 验收不代表生产签核。
- 本安装入口只覆盖 Linux x86-64 Chip；未扩大其他领域或平台的工业执行支持。其他兼容性限制见 [原生机制审计](../doc/kimi-native-compatibility-audit.md)。
