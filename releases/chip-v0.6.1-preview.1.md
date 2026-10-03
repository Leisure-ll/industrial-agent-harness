# Chip Pack v0.6.1-preview.1

2026-10-03 · 独立无 UI 芯片领域包更新到 **EDA Harness 0.6.1**。本版修复 CTS 等价回调，增加受控计算资源、容器清理和映射 memory 等价验证。下载本 Release 的 `.tar.gz` 与 `.sha256`，无需访问私有 EDA 源仓库。

## 安装和迁移

```sh
shasum -a 256 -c industrial-agent-harness-chip-chip-v0.6.1-preview.1.tar.gz.sha256
tar -xzf industrial-agent-harness-chip-chip-v0.6.1-preview.1.tar.gz
cd chip-pack
sh ./install.sh
docker build --platform linux/amd64 -f eda-harness/Dockerfile.tools \
  -t eda-harness-tools:cli-fix-20261003 eda-harness
```

需要 uv、Python 3.13、Docker 和网络；安装脚本建立固定 EDA 环境及 Kimi CLI 1.51.0 环境。模型配置、凭据和项目输入需另行准备。Linux 可用 `sha256sum -c`。在工程 `eda.yaml` 中选择新镜像并设置实际可用的 CPU/RAM 预算，默认串行编译。更新 Python 不能代替重建镜像；复制了旧 IHP 配置的项目需修正 LEC 单元过滤。绑定项目与独立 MCP 使用见 [包内 README](https://github.com/Zhiman-BJ/industrial-agent-harness/blob/chip-v0.6.1-preview.1/domain-packs/chip/README.md)。

## 相对原生 Kimi Code 提供什么

- **25 工具 MCP 与持久化 EDA 状态**：查询工程、环境、动作、运行、诊断、产物与验收。`run_action`/`run_until` 通过受控 EDA Runtime 计算，`get_run` 与验证证据用于核对工程结论。
- **容器生命周期与资源额度**：捕获 Docker OOM/退出状态，有界清理正常退出、超时、取消及客户端崩溃的命名容器；无法确认删除时保留清理待办和共享额度。跨工程检查同一 daemon 的实际容量，默认一个受控动作及一个编译进程，限制 ORFS/OpenROAD 线程和脚本过量并行。
- **CTS 真实等价证明**：固定 ORFS 的 Kepler 在测试环境触发 SIGILL，改用有时限且要求非空完整证明的 Yosys 回调；修正 IHP 导出时误删功能标准单元的问题，保留 timing repair 和 LEC。
- **映射 memory 等价动作**：真实功能 Liberty/Verilog 模型、memory map、异步复位规范化、Yosys/EQY、有界策略和单工作线程；拒绝部分、空证明及错误设计。失败仍保留 UNKNOWN 验证，不转为工程 PASS。
- **Skill、固定依赖与适配器**：`eda-core` Skill、绑定项目的 Kimi 配置生成器及 Docker 工具配方。Kimi 仍负责 Agent Loop、上下文、审批与模型调用。

## 验证范围

本地完整 EDA 回归 198 项通过，1 项可选网表渲染跳过；真实 Docker 超时、客户端 SIGKILL、OOM 和清理已验证。正确 RAM/reset 样例证明通过，改错写入被拒绝；定时 Verilator 仿真正例通过，断言反例失败。ARM Mac 仿真执行的固定 linux/amd64 工具镜像通过有效/无效输入、产物可读性和并发隔离验收。

原始 IHP gcd 示例完成 CTS：**1,719 个等价点全部证明**；详细布线报告 **0 个违例**。验证身份和日志在 `eda-harness/tools/runtime-fixes-validation.json` 及 `runtime-fixes-evidence/`。发行流程在 Linux 验证解压包的安装、项目绑定、真实 MCP、运行时单元与故障回归；不构建或发布工业工具镜像。

## 与 Industrial Core 的边界

- 本包既可独立连接 Kimi，也已通过共享 Scope Gateway 注册到 Desktop/CLI。Core 使用 [Headless preview.5](https://github.com/Zhiman-BJ/industrial-agent-harness/releases/tag/headless-v0.2.0-preview.5) 的声明、项目绑定与范围检查，不能直接注册原始 MCP 以绕过 Gateway。
- 本版是以固定 EDA 0.6.0 提交为基础的补丁，不是上游 EDA 0.7.0。包内不含预构建 Python 环境、EDA 镜像、PDK 或用户工程。
- 未获得原始 G01 MCU 工程与 PDK，不能宣称其全量工程验收通过。`Error 247` 单独出现时原因未知；新版本增加额度与 OOM/退出证据，不能据此重写历史根因。
- 原生 memory SMT 尚未证明，不声明支持；任意设计的等价收敛无法保证。独立 shell/Docker 命令不具备 MCP 受控运行时的清理与共享额度。
- 工具退出成功、示例 PASS 和 Core 的文件观察不构成完整 Industrial Core 工业状态闭环。其他平台的工业执行仍需单独验证。

[完整迁移与限制](https://github.com/Zhiman-BJ/industrial-agent-harness/blob/chip-v0.6.1-preview.1/domain-packs/chip/eda-harness/docs/runtime-reliability.md)
