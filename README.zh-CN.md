# Industrial Agent Harness

[English](README.md) · 简体中文

[![状态：开发者预览版](https://img.shields.io/badge/status-developer%20preview-orange)](#预览版范围)
[![许可证：MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node.js：24+](https://img.shields.io/badge/Node.js-24%2B-339933)](package.json)

**面向工程项目的 AI 工作台：按范围使用专业工具，保留可核验的结果。**

Industrial Agent Harness 通过桌面工作台和无界面 CLI，将本地工程、Kimi Code、专业软件与工程证据连接起来。各领域通过 Domain Pack 提供知识、工具和验证方法。

> [!IMPORTANT]
> **开发者预览版（Developer Preview）。** 当前处于 Workbench MVP 阶段，已跑通首条持久化 RTL 验证路径。API、Pack 接口和运行时行为仍在迭代。本页描述当前源码；已发布的预览归档以各自版本说明为准。

[快速开始](#快速开始) · [领域扩展](#领域扩展) · [已接入的 Viewer](#已接入的-viewer) · [文档](#文档) · [许可证](#许可证)

## 可以做什么

- **围绕真实工程协作。** 将本地目录绑定到领域，使用多个聊天、恢复会话，并查看执行日志。
- **按任务获取知识和工具。** Capability Broker 渐进披露相关 Skill 与工具定义，并在执行时校验授权范围。
- **保留工程证据。** RTL 运行时记录输入、动作、产物、验证和检查点；输入变化使当前证据失效，中断记录在重启后仍可追踪。
- **在工作台内查看产物。** 查看波形、网表、版图、KiCad 设计、Godot 素材和通用工程文件。
- **接入自动化与扩展。** 使用 CLI 的 JSON Lines 事件、Node SDK 或 stdio JSON-RPC；独立构建 Domain Pack，保留完整 Skill 资源并检查安装完整性。

Kimi Code 负责 Agent 循环、对话历史和上下文压缩；Harness 负责工程上下文、工具范围和证据。Agent 回合结束或进程退出成功，均不能直接判定工程验收通过。

首条已实现的工业路径：

```mermaid
flowchart LR
    Project["工程与当前状态"] --> Broker["Capability Broker"]
    Broker --> Agent["Kimi Code"]
    Agent --> Runtime["受范围约束的 Domain Runtime"]
    Runtime --> Tools["Chip Pack 工具"]
    Tools --> Evidence["产物与独立验证"]
    Evidence --> State["新状态与检查点"]
```

## 快速开始

准备 **Node.js 24+** 和 **pnpm 11.1.3**。实际运行 Agent 还需 **uv**、**Python 3.13**、固定版本的 Kimi CLI 和模型 API 配置。当前受保护的 Agent 执行已在 **macOS Apple Silicon（arm64）** 验证；使用其他平台前请查看[预览版范围](#预览版范围)。

```sh
git clone https://github.com/Zhiman-BJ/industrial-agent-harness.git
cd industrial-agent-harness
npm install --global pnpm@11.1.3
pnpm install --frozen-lockfile
```

### 1. 无模型体验 CLI

```sh
pnpm cli run \
  --project-dir ./examples/chip-sobel \
  --domain chip \
  --task "Inspect netlist signals" \
  --scope-only
```

该命令输出已注册的能力范围和披露过程，无需 API Key 或原生工程工具，不执行工程动作，也不验证设计。

### 2. 启动桌面工作台

```sh
pnpm --filter @industrial-agent-harness/desktop setup:kimi
pnpm dev
```

在 **Settings → Model API** 配置模型，再添加本地工程并选择领域。打开右侧工作区即可浏览文件；查看文件不需要模型 API Key。

准备脚本安装 **Kimi CLI 1.51.0**，接入层使用 **Kimi Agent SDK 0.1.8**。版图查看另需 KLayout Python，可运行 `pnpm --filter @industrial-agent-harness/desktop setup:layout`，或设置 `KLAYOUT_PYTHON`。

### 3. 在 macOS Apple Silicon 验证真实 RTL 闭环

完成上述 Kimi 准备后，安装 Verilator，并准备 C++ 工具链与 Chip Python 环境：

```sh
brew install verilator
(cd domain-packs/chip/eda-harness && uv sync --frozen --no-dev --python 3.13)
KIMI_EXECUTABLE="$PWD/apps/desktop/.venv-kimi/bin/kimi" \
  HARNESS_REQUIRE_CORE_NATIVE=1 pnpm run test:industrial-core
```

测试运行真实 RTL 仿真，检查断言、波形、失败处理、安装态 Pack 完整性和重启恢复。模型响应来自本地受控提供方，不消耗模型 API 额度，也不用于衡量模型能力。真实任务的准备方式和证据边界见[工业运行时说明](doc/p0-industrial-runtime.md)。

需要下载包时，请查看 [GitHub Releases](https://github.com/Zhiman-BJ/industrial-agent-harness/releases)，并按对应版本说明安装。[无界面安装](apps/cli/README.md#github-release-安装)和[领域 CLI 分包](doc/domain-cli-downloads.md)提供校验与外部依赖说明。历史归档不会自动获得当前源码的新功能。

## 领域扩展

| 领域                                  | 预览版已提供                                                              | 依赖与限制                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [Chip](domain-packs/chip/README.md)   | EDA 知识与工具注册、持久化的声明式 RTL 验证路径，以及波形、网表、版图查看 | Core 路径需要 Python 与 Verilator；其他 EDA 流程另需工具、镜像或 PDK，完整执行仍需接入 Runtime。             |
| [PCB](doc/pcb-mcp-integration.md)     | KiCad 查看、受范围约束的工具注册和外部设计 Skill 加载                     | 完整工具和 Skill 需要授权的固定 PCB-bench checkout 与匹配 KiCad 环境；私有 actor 资源不包含在公开发行包内。  |
| [Godot](domain-packs/godot/README.md) | 源码与素材检查、Web Export 查看和原生场景工具注册                         | 原生工具需要 Godot 4；Web Export 需要匹配导出模板与 Viewer Bridge，原生写工具仍需接入受保护的 Runtime 路径。 |
| [CAD · FreeCAD](doc/freecad-domain-pack.md) | 参数化草图、拉伸、打孔、布尔建模；FCStd/STEP/STL 导出、独立回读验证与实体网格查看 | 原生执行需 FreeCAD 1.1.4 macOS arm64；只支持受限原生特征，不验收机械强度或可制造性。 |

按 [Pack 作者教程](doc/pack-authoring.md)独立开发扩展。领域代码留在 Pack 内，共享 Core 与 Broker 不依赖具体领域。已注册、能够显示或原生烟测成功，均不代表完整工业工作流已经验收。

## 已接入的 Viewer

从当前工程的文件树打开产物，自动选择对应 Viewer。查看器共用缩放、Fit 与全屏操作，查看不改变源码或验证结果。

| Viewer                                      | 输入                                                                           | 查看能力与限制                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [芯片版图](doc/viewer-eda-reference.md)     | GDS/GDSII、OAS/OASIS                                                           | 按视口渲染和图层选择，需要 KLayout Python。                              |
| [网表](doc/viewer-eda-reference.md)         | Yosys `write_json` 输出                                                        | 独立 worker 中生成 netlistsvg 图，普通 JSON 使用文档查看器。             |
| [波形](doc/viewer-eda-reference.md)         | VCD、FST、GHW                                                                  | 内置 Surfer WASM，查看信号与时间轴。                                     |
| [KiCad](doc/kicad-viewer.md)                | `.kicad_pcb`、`.kicad_sch` 与工程子页                                          | 本地 KiCanvas 展示图层、网络和符号，只读 2D 查看，无需安装 KiCad。       |
| [Godot Web Export](doc/godot-viewer.md)     | 配套 HTML/JS/WASM/PCK                                                          | 运行、暂停、单步与节点检查，需要含 Viewer Bridge 的单线程导出。          |
| [图片与图集](doc/godot-assets-viewers.md)   | PNG/JPEG/WebP、`.sprite.json` 与配套图片                                       | 平移、采样模式、图集选帧与裁剪预览，无需 Godot 运行时。                  |
| [动画](doc/godot-assets-viewers.md)         | 受支持的 `.tres`/`.tscn` 与图集动画                                            | 有限 SpriteFrames/Sprite2D 格式的播放与逐帧，不运行 Godot 引擎。         |
| [工程文件](doc/engineering-file-viewers.md) | Godot 场景/资源/脚本、KiCad 库/规则、Gerber/钻孔、STEP/VRML 和部分 3D/音频格式 | 结构、制造层与媒体预览，几何和语义范围有限，不提供编辑或制造验收。       |
| [CAD 实体网格](doc/freecad-domain-pack.md) | STL；Pack 生成的 FCStd/STEP 与经过哈希检查的配套 STL | 旋转、平移、缩放/Fit 和全屏；受限三角面预览，不提供原生编辑或精确测量。macOS arm64 Electron 实测。 |
| [通用文档](doc/document-viewers.md)         | CSV/TSV、JSON、JSONL/NDJSON、Markdown、TXT/LOG                                 | 表格、结构、记录与文本搜索；只读受限 UTF-8 输入，不执行公式或嵌入 HTML。 |

完整格式清单、文件上限与渲染依赖见各 Viewer 文档。新增接入需同时更新中英文 README，并遵守 [Viewer 接入契约](AGENTS.md#viewer-integration-contract)。

可先体验 [Sobel 芯片工程](examples/chip-sobel/README.md)、[LED 电路板](examples/pcb-led/README.md)、[Godot Playground](examples/godot-viewer/README.md)或[通用文档示例](examples/document-viewers/README.md)。这些用于查看演示，Godot Web Export 需单独生成，示例不作为工程验收证据。

## 文档

| 阅读入口                                                                       | 内容                                                                           |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [文档索引](doc/README.md)                                                      | 架构、产品决策与模块说明，详细文档目前以中文为主。                             |
| [CLI](apps/cli/README.md) · [Node SDK](doc/sdk.md)                             | 任务、流事件、聊天恢复、取消与 stdio JSON-RPC。                                |
| [Pack 开发](doc/pack-authoring.md) · [版本化契约](doc/contracts-versioning.md) | 独立开发、资源、兼容性与规范工业事实。                                         |
| [当前交付与验证](doc/harness-quality-three-tracks.md)                          | 已实现范围、验证记录与剩余工作；历史架构提案不代表实现承诺。                   |
| [配对评测基线](doc/benchmark-baseline.md)                                      | 原生 Kimi/Harness 对比、冻结输入与独立验收，正式模型成功率和成本结果尚待运行。 |
| [安全说明](SECURITY.md) · [第三方清单](THIRD_PARTY_NOTICES.md)                 | 执行边界、问题报告与组件来源。                                                 |

## 开发与贡献

欢迎提交 Issue 和 Pull Request。请提供源码提交、操作系统、受影响领域、最小复现和脱敏日志。修改代码前阅读 [AGENTS.md](AGENTS.md)，将领域行为留在 Pack 内，并验证相关真实执行路径。

```sh
pnpm run test
pnpm run test:architecture
pnpm run test:release
pnpm run format:check
```

[Harness CI 门禁](.github/workflows/ci.yml)在 Linux x64/arm64、macOS arm64、Windows x64 执行共享包与独立 CLI 包回归，在 macOS/Windows 验证桌面安装，在 Apple Silicon 验证工业 Core 闭环。[CI 回归说明](doc/ci-regression.md)列出依赖、保留证据与明确的覆盖缺口；跳过不代表支持。安全问题按 [SECURITY.md](SECURITY.md) 的流程报告。

## 预览版范围

- **平台：** 桌面构建与首次启动 CI 目标为 macOS Apple Silicon（arm64）和 Windows x64。Intel Mac 暂不支持，不再发布 Intel 安装包或对应 Pack 目录目标；具备 Intel 测试机并完成安装及运行时验收后再恢复。签名安装器与真实升级仍需单独验收。
- **受保护执行：** 已验证 macOS Seatbelt 的 Agent 写入边界；Linux 和 Windows 在具备等价边界前，真实 Agent 执行会在 Kimi 启动前拒绝。
- **工具兼容性：** 旧 MCP 写入被阻止，受保护会话拒绝启用外部 MCP 服务与 Computer Use，等待这些能力接入 Runtime。
- **工程验收：** 首条 Core 路径验证声明的 RTL/testbench 断言与证据；覆盖率充分性、物理签核和其他领域的完整闭环尚待实现与验收。
- **打包与评测：** 已记录本地未签名桌面检查和受控模型验证；签名发行、跨平台完整资格验证和正式付费模型比较仍需分别完成。

具体测试版本与结果见[验证记录](doc/harness-quality-three-tracks.md)。

## 许可证

项目自有贡献采用 **[MIT License](LICENSE)**，包括已获授权的 EDA Harness 与 EDA Harness demo 代码。

内置渲染器、字体、依赖和单独安装的专业工具保留各自许可证，完整发行物并非全部采用 MIT。请查阅 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和相关来源记录。本仓许可证不授予外部私有 PCB 资源的公众复用权。
