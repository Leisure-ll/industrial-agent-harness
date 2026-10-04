# Linux Chip Installer v0.1.0-preview.1

2026-10-04 · 原生 x86-64 Linux 的 Chip CLI 完整安装入口。通过 wget 下载后，一次执行完成依赖准备、CLI/Chip Pack 安装、原生 EDA 镜像构建和安装检查。

## 下载与安装

```bash
wget -O install-chip-linux.sh https://github.com/Zhiman-BJ/industrial-agent-harness/releases/download/chip-linux-installer-v0.1.0-preview.1/install-chip-linux.sh && bash install-chip-linux.sh
```

以实际使用的普通用户运行。缺少系统依赖时会请求 sudo；Ubuntu 22.04/24.04/26.04、Debian 12/13 的 systemd 主机可自动准备 curl 和官方 Docker Engine。已有可访问的 Docker 直接复用；不会卸载冲突的容器运行时。第一次构建需要下载大型上游镜像，须能访问 GitHub、Node.js、Python 包源与 Docker 镜像源。

入口固定并校验 `industrial-harness-chip-linux-install.run` 的 SHA-256，自解压文件另行校验内置的 CLI/Chip Pack。两个文件均提供同名 `.sha256`；安装收据与日志位于 `~/.local/share/industrial-harness/chip-linux-20261004`。

## 相比原生 Kimi Code 集成了什么

- 私有 Node 24.12.0、uv 0.11.6、Python 3.13 与 Kimi CLI 1.51.0，无需用户逐个准备运行时。
- Chip 领域 CLI、EDA Harness 0.6.1 的 25 工具 MCP、Skill、Scope Gateway 与原生 EDA 镜像配方一起安装；安装完成检查真实 MCP、CLI scope 与工具 inventory。
- 携带原生 Linux 容器 UID/GID 修复：丢弃 capabilities 后，以主机用户身份访问项目 bind mount，避免正常用户工程目录的写入权限失败。
- 可重复运行；保留未管理的目录与命令，锁定同一安装目录，下载损坏时停止。新加入 docker group 的用户通过私有命令助手在当前登录中使用 Docker，生成的 CLI 入口保留该助手。

安装完成后运行 `~/.local/bin/industrial-harness-chip --help`。可在安装命令末尾传入 `--prefix /absolute/path --bin-dir /absolute/bin`，或显式使用 `--skip-image` 仅安装 CLI/MCP。模型密钥、RTL、约束、PDK 和项目配置由使用者提供；工程应使用 `runtime.image: eda-harness-tools:chip-linux-20261004` 和 `require_native: true`。

## 构建身份与验证范围

安装器冻结已经验收的 Chip-only CLI 归档，而非重新下载旧 preview.5 的未修复归档。内置包元数据保留真实的 `sourceCommit: 7b1cb843bef0c3b05c34ccfe588e97598464fea9` 与 `sourceDirty: true`，归档 SHA-256 为 `bc3aeb901ce04bf6c420bc33b481c25873a1adfaa72b256be9259c71fc986ff4`。本安装版标签包含安装器、Linux 修复与文档源码；不把被冻结的工作区构建描述为新的清洁 CLI 发行包。

已完成 Ubuntu 22.04 / 原生 x86-64 的完整安装与重复安装，真实 25 工具 MCP、CLI scope 和原生镜像 inventory 通过；六项失败保护覆盖损坏归档、未管理目录/命令、并发安装和参数错误。入口的帮助、参数拒绝与损坏下载测试也通过。缺失 Docker 的隔离环境验收结果及下载检查见随附 `verification.json`；其余 Ubuntu/Debian 版本未逐一实测。

## 尚未集成

- 本入口只覆盖 Chip；PCB、Godot 和 Desktop 的安装另行提供。
- 不包含模型凭据、用户工程、PDK 与工程专用验收规则。安装检查不执行模型任务，也不等于工程签核。
- 这次发布不证明 Mac 架构模拟故障已修复。原生 Linux 的 IHP 参考流程虽完成布局布线/GDS，DRC/LVS 签核仍未通过。
- 未发布预构建 EDA 镜像；安装器从固定上游配方构建。缺少 systemd 的容器和其他 Linux 发行版须自行提供可访问的 Docker。
