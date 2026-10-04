# Linux Chip Installer v0.1.0-preview.2

2026-10-04 · Chip CLI 的原生 Linux x86-64 一键安装预览版。此次从干净、已提交的源码重新构建，包含项目 Skill 发现修复和 Linux 受保护 Agent 执行入口。

## 下载与安装

```bash
wget -O install-chip-linux.sh https://github.com/Zhiman-BJ/industrial-agent-harness/releases/download/chip-linux-installer-v0.1.0-preview.2/install-chip-linux.sh && bash install-chip-linux.sh
```

以实际使用的普通用户执行。Ubuntu 22.04/24.04/26.04、Debian 12/13 可自动准备缺少的 curl、bubblewrap；自动安装 Docker Engine 另需 systemd。已有可访问的 Docker 直接复用。主机必须允许 bubblewrap 创建用户和 PID 命名空间；检查失败就停止，不改为无隔离 Agent。其他发行版自行准备上述依赖。

入口固定并校验自解压安装包 SHA-256，安装包再校验内置 Chip CLI。私有运行时包含 Node 24.12.0、uv 0.11.6、Python 3.13 和 Kimi CLI 1.51.0。默认安装目录为 `~/.local/share/industrial-harness/chip-linux-installer-v0.1.0-preview.2`，命令为 `~/.local/bin/industrial-harness-chip`。旧版本目录保留；新版完成验证后更新受管理的命令入口。重复执行复用同一版本，拒绝覆盖未管理的目录或命令。

默认构建 `eda-harness-tools:chip-linux-installer-v0.1.0-preview.2`，需能访问 GitHub、Node.js、Python 包源及上游 Docker 镜像源。工程将 `eda.yaml` 的 `runtime.image` 设置为该镜像，并配置 `require_native: true`。可传入 `--prefix /absolute/path --bin-dir /absolute/bin`；`--skip-image` 仅安装 CLI/MCP，不代表工业工具就绪。

## 从 v0.1.0-preview.1 升级

默认安装直接重新执行上面的新版命令，无需卸载旧版。安装检查通过后，`~/.local/bin/industrial-harness-chip` 指向新版目录，旧目录、工程、模型配置保留。若原来使用自定义路径，选择新的 `--prefix`，并沿用旧的 `--bin-dir`；不要把新包安装进旧版本目录。安装器不修改工程的 `eda.yaml`，需要使用新版 EDA 镜像时自行更新 `runtime.image`。

## 相比原生 Kimi Code 集成了什么

- **项目技能和指令恢复**：自动接入 `.skill/`、`.skills/`、`.kimi/skills`、`.claude/skills`、`.codex/skills`、`.agents/skills`，以及所选工程根的 `AGENTS.md` 和 `.kimi/AGENTS.md`。摘要发现、正文按需读取、同名优先级由 Kimi 原生处理。
- **项目搜索和会话存储修复**：使用 Kimi 原生 `--add-dir` 登记工程路径，固定真实 `KIMI_SHARE_DIR`，避免宿主环境导致会话重定向或启动失败。
- **Linux 工业执行边界**：bubblewrap 将宿主文件系统设为只读，只有 session/scratch 可写；隔离用户、PID 与 IPC，并用继承的 seccomp 拒绝宿主 Unix socket 和命名空间重配置。原生 Shell/WriteFile/子进程不能直接修改工程或调用宿主 Docker socket；批准的工业动作由宿主 Domain Runtime 执行。
- **持久 RTL 闭环**：`chip.rtl.verify` 以真实 DomainState、Scope 和审批进入 Runtime，收集 Verilator 日志、波形、Verification 和 Checkpoint。原生 Linux Docker 保留 UID/GID 修复，使普通用户的私有项目目录可供受控工业容器访问。
- **可核对的构建身份**：包中 `HARNESS-PACKAGE.json`、`build-identity.json`、安装收据及 `verification.json` 记录源码提交、摘要和实际验证结果；本版拒绝封装未提交工作区。

## 验证范围

发布门禁在 Ubuntu 22.04 x86-64 上使用校验摘要的 Verilator 5.026，运行真实 Kimi、Linux 写入与 Unix socket 限制、项目技能加载、原生 RTL 成功/失败/取消/恢复，以及安装态 Pack 完整性检查。生成安装器后从其他目录启动实际安装的 CLI，验证正文按需读取、环境冲突、原生 Shell 写入拒绝、真实 Verilator 验收与持久 Checkpoint，再验证重复安装。升级门禁先安装已发布的 preview.1，再用 preview.2 更新同一个启动入口，并核对旧安装、工程和配置仍然保留。确定性模型响应仅推动真实 SDK/Runtime，不属于外网模型能力评测。

受保护 Agent 还保留 macOS 原生回归；跨平台基础和 macOS/Windows 桌面首次启动由仓库 CI 检查。本发行入口只覆盖 Linux x86-64 Chip CLI，不扩大 Windows、Linux ARM64 或其他领域的工业执行支持。随附 `verification.json` 是本次安装包的实际证据。

## 尚未集成

- 用户模型密钥、工程、PDK、约束及工程专用验收规则需自行提供；安装检查不等于工程签核。
- 原生斜杠命令仍受输入包装影响；部分原生 Hook/插件/配置没有自动继承。相对 cwd 和 monorepo 祖先指令仍有兼容限制。详见 [兼容性审计](https://github.com/Zhiman-BJ/industrial-agent-harness/blob/chip-linux-installer-v0.1.0-preview.2/doc/kimi-native-compatibility-audit.md)。
- Scope 变化重建原生会话、保留聊天展示历史，是预期行为。本次升级旧会话首次运行也会开始新上下文段。
- 受保护 Agent 中的旧 MCP 修改、外部 MCP host 服务和 Computer Use 仍未接入完整 Runtime；注册 25 工具并不表示所有工业修改可直接使用。
- 活跃进程中的 Skill 热刷新、原生子 Agent 完整接入、Windows/Linux ARM64 工业执行、真实 OTA 和预构建 EDA 镜像未在此版交付。
