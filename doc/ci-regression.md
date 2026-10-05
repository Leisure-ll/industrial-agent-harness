# CI 回归与托管环境

入口是 [Harness CI](../.github/workflows/ci.yml)：每个 PR、`main` 推送和手动运行都会执行完整门禁。环境由 GitHub 托管 runner 提供，每个 job 获得独立的干净机器，不需要维护自有虚拟机池。

| 回归层 | 托管环境 | 必需验证 |
| --- | --- | --- |
| 仓库与协议 | Ubuntu 24.04 x64 | 格式、架构边界、Pack/类型兼容、桌面构建、Python Runtime、实际 MCP transport、Icarus 独立 RTL 验证 |
| 跨平台基础 | Ubuntu 24.04 x64 / ARM64、macOS 15 ARM64、Windows 2025 x64 | 共享包、CLI、SDK、Viewer 边界、资源与持久化，以及 Chip/PCB/Godot/CAD 四种独立 CLI 包的实际消费 |
| 桌面安装 | macOS 15 ARM64、Windows 2025 x64 | 打包应用首次启动、内置资源与 Domain 安装流程 |
| Linux 安装与工业闭环 | Ubuntu 22.04 x86-64 | bubblewrap/seccomp、真实 Kimi/Verilator、成功/失败/取消/恢复、干净 Chip 安装包、实际安装消费与重复安装 |
| 原生工业闭环 | macOS 15 / 26 ARM64 | 实际 Seatbelt、Verilator、FreeCAD、固定 Kimi CLI、持久化事实、审批拒绝、失败恢复、图像/并行会话、聊天恢复、空闲回收与强制中断，以及真实 CAD 产物的桌面查看 |

`ubuntu-24.04`、`ubuntu-24.04-arm`、`macos-15`、`windows-2025` 直接对应原生 OS/架构机器。基础测试还会检查 Node 实际报告的 OS 与架构，避免把交叉编译当作目标平台运行。Node 固定为 24，pnpm 固定为 11.1.3，Python 为 3.13，uv 为 0.11.6，Kimi CLI 为 1.51.0；安装遵循已有锁文件。CI 使用本地 HTTP 模型 fixture，不需要模型 API 密钥。

## 门禁与证据

`All checks passed` 汇总全部必需回归层；任何一层失败、取消或整个 job 被跳过，汇总都失败。它可以作为分支保护的必需检查；新增 workflow 不会自动修改仓库分支保护设置。所有层都必需，不把 Windows 失败降为观察项。桌面回归每个 PR 都执行，避免路径过滤导致必需检查缺席。

`scripts/ci-tests.cjs` 记录执行文件、平台、Node 版本、计数与跳过项；零测试、失败、取消、TODO 或未登记跳过都失败。原生闭环和独立 RTL benchmark 不允许跳过，缺少对应门禁要求的 Kimi、Python Runtime、FreeCAD、Verilator 或 Icarus 会失败。回归 JSON 与桌面/原生/CLI 日志通过 Actions artifacts 保留 14 天；失败和取消时也尝试上传已产生的证据。更新 PR 会取消同一 PR 的旧运行。

有三类明确的覆盖缺口，保留在报告中：

- 基础层允许跳过可选的 KLayout 原生渲染测试；未安装 KLayout 的机器仍执行其余 Viewer 测试。该门禁不证明 GDS 渲染可用。
- Windows 基础层保留两项已有的 POSIX 子进程树清理测试跳过；其余 SDK transport、协议、背压与实际 CLI 消费仍必须执行。这两项需要后续补 Windows 专用验收。
- 协议层允许跳过依赖独立 PCB-bench 源码的那一项测试；仍强制执行官方 MCP transport、参数/范围拒绝、完整大响应和 schema 变化拒绝。私有/外部 PCB 后端与原生工程工具需另行验收。

POSIX 文件权限位断言只在 macOS/Linux 执行，Windows 的 ACL 需单独验收；其他断言保留。Windows archive fixture 使用系统 tar 生成 ZIP，解包使用 runner 自带 Git for Windows 的 unzip。Git attributes 固定源码 LF 并禁止转换按哈希校验的上游 Viewer 资源，避免 Windows checkout 改写发行字节。SQLite fixture 先关闭数据库再删除目录；Linux 子进程清理断言区分已死亡、等待 PID 1 回收的 zombie 与仍然运行的进程。

Linux/Windows 基础回归与 Windows 桌面启动不等于工业 Agent 验收。新增 `native-linux` 门禁和安装消费验证单独覆盖 Linux x86-64；Linux ARM64 与 Windows 工业 Agent 仍未支持。Intel Mac 按 [PD-036](product-decisions.md#pd-036暂停-intel-mac-支持) 暂停支持。签名发行、真实 OTA、真实模型 API 和完整工程任务评测仍属于独立发布验收。

## 本地复现

先执行 `pnpm install --frozen-lockfile`，再按需要运行：

```sh
pnpm run test:ci -- portable
pnpm run smoke:ci-packages
pnpm run test:ci -- benchmark
pnpm run test:ci -- transport
KIMI_EXECUTABLE="$PWD/apps/desktop/.venv-kimi/bin/kimi" pnpm run test:ci -- native
```

`benchmark` 需要 `iverilog` 和 `vvp`；`transport` 需要 Chip/PCB 锁定 Python 环境；`native` 需要 Apple Silicon、Verilator、FreeCAD 1.1.4、Chip Python 环境与固定 Kimi，准备步骤见 [Industrial Core workflow](../.github/workflows/industrial-core.yml)。CLI 冒烟只清理自身的 `dist/ci-headless` 临时目录，之后从独立临时工作目录运行四个领域包，检查领域绑定、资源、共享配置与禁用策略。

## 参考来源

参考 DeepSeek Harness 的分层 job、实际目标平台消费、必需检查汇总和禁止必需测试静默跳过的做法；上游实现截至 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`：

- [CI 与 all-checks-passed](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/.github/workflows/ci.yml)
- [原生 SDK 包消费测试](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/.github/workflows/build-exe-for-python-sdk.yml)
- [Sandbox 测试门禁](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/.github/workflows/sandbox.yml)
- [GitHub 托管 runner 的 OS/架构](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

本仓库使用自己的 Node 测试与现有工业契约，未复制上游的特定服务、密钥、Windows 观察项或自托管环境。

FreeCAD 首批 native suite 和实际 Electron CAD Viewer 加入 macOS arm64 原生门禁。CI 下载并校验官方 FreeCAD 1.1.4 DMG 的固定 SHA，只读挂载提供 `freecadcmd`；缺少依赖会失败。配方/STL/文件边界及 CAD CLI 包的 Scope 检查加入四平台 Portable 层。详见 [FreeCAD 接入与回归](freecad-domain-pack.md)。

FreeCAD 1.1.4 的原生 CAD/RTL/Kimi 综合门禁覆盖 `macos-15` 和 `macos-26` arm64；四平台 Portable 与 Desktop macOS 打包仍固定 `macos-15`。FreeCAD 的配置、数据与缓存目录在每次 Action 内独立创建和验证，确保全新托管环境无需预先启动桌面 FreeCAD。

CAD 桌面分栏回归覆盖初始窗口和显式 1000 px 窄窗口。托管 macOS 可能按屏幕尺寸限制初始窗口，因此拖动断言根据实际剩余空间检查位移与最小宽度限位；记录拖动前后宽度，不假定初始窗口一定为 1440 px。分栏和相机截图共用渲染等待：等待布局帧和连续稳定的 WebGL 像素，超时仍失败；每次分栏截图的视图区、完整窗口及尺寸信息保存在 CI artifacts 的 `cad-resize/`。两种窗口都比较真实 OCCT 渲染的模型像素比例，保留全屏往返、键盘限位和双击恢复检查。旋转前基线在导航与缩放检查完成后采集，只比较 CAD 视图区的实际像素，旋转前后截图保存在 `cad-camera/`，避免其他界面变化掩盖模型未重绘。本地可用 `HARNESS_CAD_SELFTEST_WINDOW_SIZE=1024x656` 重现托管窗口尺寸。

原生 RTL 测试工程为首次 Verilator 编译预留 90 秒，实际仿真握手也使用同一等待预算；测试本身仍有 120 秒上限。托管机器的首次编译可能超过原先的 30 秒，尤其是并行运行 FreeCAD 的时候。专门的超时用例明确将工程期限改为 1 秒，仍要求真实 TIMEOUT 记录、诊断和无工程验收；生产 Runtime 的默认期限未改动。
