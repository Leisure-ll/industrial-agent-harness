# Headless v0.2.0-preview.5

2026-10-03 · Chip Pack 更新为 **EDA Harness 0.6.1**，修复 CTS 等价回调，增加计算资源限额、容器清理和映射 memory 等价验证。发行检查同步核对 Godot 的两组能力、实际工具范围与禁用策略。此版同时包含 preview.3 之后已合并的 PCB/Godot 工具、Computer Use 插件、聊天恢复与会话资源保护。

## 下载哪个包

芯片用户下载 `industrial-agent-harness-cli-chip-headless-v0.2.0-preview.5.tar.gz`；其他领域分别下载 `industrial-agent-harness-cli-pcb-headless-v0.2.0-preview.5.tar.gz`、`industrial-agent-harness-cli-godot-headless-v0.2.0-preview.5.tar.gz`。跨领域使用 `industrial-agent-harness-headless-headless-v0.2.0-preview.5.tar.gz`。每个归档都有同名 `.sha256`，需保留整个解压目录。

需要 Node.js **22.13+**。Agent 另需 Kimi CLI **1.51.0** 和模型凭据；Chip MCP 使用 Python **3.13** 与 uv 固定环境。归档不包含 Python 环境、Kimi 可执行文件、工业工具镜像、PDK 或用户工程。独立 Chip MCP 另见 [Chip Pack 0.6.1](https://github.com/Zhiman-BJ/industrial-agent-harness/releases/tag/chip-v0.6.1-preview.1)。

## 安装和迁移

```sh
shasum -a 256 -c industrial-agent-harness-cli-chip-headless-v0.2.0-preview.5.tar.gz.sha256
tar -xzf industrial-agent-harness-cli-chip-headless-v0.2.0-preview.5.tar.gz
cd headless-chip
sh domain-packs/chip/install.sh
docker build --platform linux/amd64 \
  -f domain-packs/chip/eda-harness/Dockerfile.tools \
  -t eda-harness-tools:cli-fix-20261003 domain-packs/chip/eda-harness
export KIMI_EXECUTABLE="$PWD/domain-packs/chip/.venv-kimi/bin/kimi"
node industrial-harness.cjs run --project-dir /absolute/project --task '检查工程状态' --scope-only
```

Linux 可用 `sha256sum -c`。真实 Agent 运行还需配置模型凭据，按既有审批策略运行。将工程 `eda.yaml` 的 `runtime.image` 改为新镜像，默认使用 `cpu: 2`、`memory_gb: 4`、`build_jobs: 1`，并确认 Docker VM 有足够容量。更新 CLI 和 Python 环境后仍需重建镜像。复制了旧 IHP 配置的项目还需移除 `REMOVE_CELLS_FOR_LEC` 中误删功能单元的 `sg13g2*` 模式；见 [迁移与限制](https://github.com/Zhiman-BJ/industrial-agent-harness/blob/headless-v0.2.0-preview.5/domain-packs/chip/eda-harness/docs/runtime-reliability.md)。

## 相比原生 Kimi Code 集成了什么

- **受控 EDA 运行时**：25 工具 MCP 经共享 Scope Gateway 进入 EDA Harness。命名容器的退出、超时、取消及客户端崩溃均尝试有界清理，捕获 OOM/退出状态；未确认清理时保留资源额度并阻止重试，可用 `recover_runs` 恢复。执行失败产生诊断与 UNKNOWN 验证，不能成为成功缓存。
- **计算资源保护**：跨工程共享 Docker daemon 的额度与实际 CPU/RAM 检查；默认一个受控动作、一个编译进程。镜像限制过量 make/Verilator 并行，结构化仿真拆分生成的 C++，ORFS/OpenROAD 线程服从任务预算。`Error 247` 单独出现时不推断为 OOM。
- **CTS 与形式等价**：固定 ORFS 中触发 SIGILL 的 Kepler LEC 调用改用有时限的 Yosys 真实证明，修正 IHP 导出时误删功能单元的问题。映射 memory/异步复位等价动作支持 Yosys/EQY、真实功能模型、单工作线程和完整证明检查，拒绝部分、空证明及改错设计。
- **共享领域与通用工具**：Chip、89 工具的 PCB-bench 声明及 5 工具的 Godot Pack 均由 Broker 和 Gateway 重查范围。PCB 的固定源码、完整 Skill 和 KiCad 镜像需另行准备；Godot 原生动作需注册 Godot 4。多领域包包含 CAD Skill 声明，实际 CAD 软件按各 Skill 准备。
- **Agent 会话与插件**：沿用固定 Kimi 内核、原生压缩和模型 Provider；新增内容来自已合并的共享外部 MCP、Computer Use 插件、审批/提问恢复、聊天持久化、诊断和跨宿主会话额度。Computer Use 的软件与系统权限有独立前提，详见 [CLI 文档](https://github.com/Zhiman-BJ/industrial-agent-harness/blob/headless-v0.2.0-preview.5/apps/cli/README.md)。
- **可搬移发行包**：修正 pnpm 部署后仍指向打包机源码的依赖链接；测试检查全部依赖链接并从其他目录启动解压包。

## 验证范围

本地已通过 198 项完整 EDA Python 回归（1 项可选网表渲染跳过）、全仓单元测试、架构和格式检查、桌面构建、MCP/外部 MCP 测试。打包并重新解压后，真实 CLI/Kimi/MCP 批准、拒绝、项目绑定和资源故障测试通过；模型端为受控 fixture。Python 回归包括真实 Docker 超时、客户端 SIGKILL、OOM、Yosys RAM/reset 正例及错误写入反例。

工具镜像在 ARM Mac 的 linux/amd64 仿真环境中完成有效/无效 RTL、产物可读性和两个隔离任务验证。原始 IHP gcd 配置完成 CTS 的 **1,719 个等价点全部证明**，并完成详细布线，报告 **0 个违例**。这不是 G01 MCU 的完整验收。镜像身份与证明日志位于包内 `domain-packs/chip/eda-harness/tools/runtime-fixes-validation.json` 及 `runtime-fixes-evidence/`。

发行流程在 Linux 重跑单元/架构、Python 运行时回归与实际 MCP 协议测试，对解压的三个领域包执行检查，并验证解压 Chip 包的真实调用后上传归档。原生 EDA 镜像的处理验证在本地完成，发行 CI 不构建该镜像；无 Windows CLI 发行验收。

## 尚未集成

- 未收到原始 G01 MCU 工程和 PDK，无法宣称其全量 P&R、时序、DRC/LVS 或等价通过；历史 `Error 247` 的具体原因未确认。
- 结构化等价仅支持映射 memory。原生 memory SMT 试验未通过，不声明支持；任意设计的形式收敛不能保证。
- 独立 shell/Docker 作业不具备受控 MCP 运行时的额度、清理与运行证据。现有项目脚本、镜像与旧 Release 不会自动更新。
- 完整 Industrial Core 垂直闭环与跨平台工业验收尚未完成；外部 MCP 观察、原生进程成功及示例 PASS 不能代替工程验证。
- 未发布预构建 EDA 工具镜像；使用者从包内固定配方构建。
