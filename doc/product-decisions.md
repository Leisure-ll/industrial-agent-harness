# 产品决策记录

这里记录已经由产品讨论确认、会影响用户操作方式的决定。每条记录保留编号、日期、状态和具体行为；若以后改变决定，新增记录说明替代关系，不直接抹去原决定。技术边界和待验证接口另见[架构决策记录](decisions.md)。

## PD-001：Project、目录与 Domain 的关系

- 日期：2026-09-23
- 状态：已确定
- 来源：Project Domain 与新 Session 交互讨论

### 背景

早期 MVP 虽将 Domain 保存到每个 Project，却把编辑入口放在全局 Settings，容易让用户误认为 Domain 是整个应用的配置。新 Session 的领域选择也与 Project 的领域归属关系不清。

### 决定

1. 一个本地文件目录对应一个 Project；同一目录不能重复创建 Project。
2. 一个 Project 只归属一个 Domain。创建 Project 时必须选择 Domain；此后可在该 Project 的详情页修改。
3. 点击左侧项目进入项目详情页，显示项目名称、本地目录和 Domain。全局 Settings 不提供 Project Domain 编辑入口。
4. 新 Session 在输入框中用只读小按钮显示所属 Project 的 Domain，不能在 Session 内改选。
5. 修改 Project Domain 后，清空当前会话的 Broker Scope。Broker 在主进程拒绝与 Project Domain 不符的解析请求。

### 旧数据

已有的 Sobel 示例归属 Chip。旧版本创建但没有 Domain 的 Project 保留目录绑定，进入详情页补选并保存 Domain 后才能开始新 Session。

### 实施范围

桌面端的项目创建流程、项目详情页和只读 Domain 按钮遵循本决定。Domain 选项来自已注册的领域能力，不在通用 UI 中写死 Chip、PCB 列表。

## PD-002：项目创建入口与 Domain 标识

- 日期：2026-09-23
- 状态：已确定
- 来源：Projects 侧栏与 Codex 风格对齐的反馈

### 背景

把“Add local project…”作为项目列表的一整行，会让创建动作看起来像一个已有项目；先弹系统目录选择器，也使用户在看到项目名称和 Domain 前就进入文件选择。Domain 在项目列表中缺少可见标识。

### 决定

1. Projects 标题旁提供「＋」创建入口。点击后先打开新项目界面，在其中填写名称、选择本地目录及 Domain，最后明确创建。
2. Domain 使用带专属 emoji 的小圆角按钮：创建项目时并排展示所有可用 Domain，直接点击选择，不设二级菜单；项目列表与聊天输入框中只读。列表与按钮的名称、emoji 均来自领域注册信息。
3. 项目名称不再重复写入 Domain；已有 Sobel 示例显示为“Sobel example”，旁边单独显示 Chip 标识。

这条决定补充 PD-001 的创建流程和视觉呈现，不改变一个目录对应一个 Project、一个 Project 对应一个 Domain 的关系。

## PD-003：项目文件触发 Viewer

- 日期：2026-09-23
- 状态：已确定
- 来源：对工作区文件树中「VIEWER EXAMPLES」入口的反馈

### 决定

文件树只展示当前 Project 目录中的文件，不提供「VIEWER EXAMPLES」或独立的演示产物列表。用户点击项目文件时，普通文件显示源码；受支持的版图、网表和波形格式自动进入对应 Viewer。Viewer 的小型 fixture 只供开发和测试，不作为产品交互入口。Sobel 示例项目包含从同一设计记录中提取的三种产物，用于验证这一流程。

## PD-004：Agent 过程信息保持紧凑

- 日期：2026-09-23
- 状态：已确定
- 来源：对实时 Thinking 与 Tool Use 展示密度的反馈

### 决定

一次 Prompt 后，思考进行时只显示最近两三行；思考结束后默认收起为一行标题，可按需展开全文。每次 Tool Use 默认折叠，调用参数和返回结果合并在同一条记录中，展开后查看。审批请求仍直接显示操作按钮，以便用户处理。

## PD-005：Broker 在消息流中按工具调用呈现

- 日期：2026-09-23
- 状态：已确定
- 来源：Capability Broker 卡片与 Tool Use 视觉不一致的反馈

### 决定

一次任务的 Broker 解析在消息流中使用与 Tool Use 相同的默认折叠条目。摘要显示领域、阶段和能力数量；展开后查看上下文选项、选中的能力、Skill/Tool 数量和按需披露详情。Debug 模式的 L0–L3 Trace 留在该条目的展开内容中，不在消息流额外铺开一整块日志。

## PD-006：默认 Skill 与 MCP 按 Project 管理

- 日期：2026-09-23
- 状态：已确定
- 来源：默认 MCP/Skill 由仓库接入，并能在每个 Project 中手动禁用
- 原因：不同项目对同一默认资源的适用性不同，禁用状态不能污染其他项目或仓库默认配置。

### 决定

仓库声明默认 Skill 和 Domain MCP；每个 Project 独立保存禁用项，而不是修改仓库默认声明或全局 Settings。项目详情页显示该 Domain 的资源及开关。变更资源后清空当前会话 Scope，下一次任务重新解析。CLI 以显式禁用参数表达同一策略，便于 Bench 固定实验条件。

## PD-007：无 UI Harness 通过 GitHub Release 分发

- 日期：2026-09-24
- 状态：已确定
- 来源：场景测试需要其他人可下载的无 UI 包，而非开发者机器上的目录

### 决定

通过公开 GitHub Release 提供无 UI Harness 下载包、SHA-256 校验文件与安装步骤。Release 包含 Broker、Skill、Domain MCP 接入和 Kimi SDK 集成；清楚标明尚未实现的 Domain Runtime 与默认 MCP 服务器。先作为预发布版本供场景测试，不以 Scope 烟测代替工业闭环验收。

## PD-008：Core 与领域包分别发布

- 日期：2026-09-24
- 状态：已确定
- 来源：Broker 完成前需先测试完整芯片 MCP 场景

### 决定

无 UI Core 与 Chip Pack 使用不同 GitHub Release 标签。Chip Pack 独立提供固定版本的 EDA Harness MCP、Skill、Kimi 适配和工具镜像构建说明；它可以先用于芯片场景测试。Core Release 不宣称已装入 Chip Pack，也不把独立 MCP 的执行结果计作 Core Broker/Domain Runtime 垂直闭环验收。未来完成 Broker Gateway 后再增加两包的兼容性与 Scope 集成测试。

## PD-009：保留完整 Agent 诊断日志

- 日期：2026-09-25
- 状态：已确定
- 来源：27B 小模型状态调试需求
- 原因：折叠的聊天界面和截断的工具结果无法还原模型当时看到的输入、工具返回与压缩过程。

### 决定

每次 Agent 运行保存一份可按 Trace ID 关联的 JSONL 文件，记录 Broker 决策、实际提示词、SDK 暴露的原始事件、完整工具返回、审批、压缩及结果。CLI 输出日志路径，桌面 Debug 模式显示路径。日志写在受限权限的用户数据目录，脱敏已知模型凭据；界面仍采用紧凑呈现。诊断日志是调试证据，不自动构成工程 Verification。

## PD-010：Godot Web Export Viewer V1

- 日期：2026-09-24
- 状态：已确定，V1 已在 macOS Electron 真实导出实测
- 来源：用户确认的 Godot Viewer 接入方案
- 原因：在工作区内直接查看并控制 Godot 场景，同时让 Viewer Bridge 与 MCP 保持分离。

### 决定

Godot 作为 Viewer-only Domain 注册。项目文件树识别完整的 Godot Web Export；Viewer 顶部提供 Scene 与运行控制，左侧提供 Scene Tree 和 Inspect，中间运行 Web Export，底部保留 Runtime State 开关位置。Web iframe 通过 JavaScriptBridge autoload 和版本化消息桥与 React Viewer 通信。复杂场景编辑仍使用 Godot。2026-09-28 使用仓库 Playground 源项目和 Godot 4.7.2 完成 macOS Electron 实测；其他平台与发行包仍待验证。

## PD-011：Viewer 全屏查看

- 日期：2026-09-28
- 状态：已确定
- 来源：用户要求右侧 Viewer 支持全屏显示
- 原因：游戏与大型产物需要更大的查看面积。

### 决定

工作区标题栏提供全屏与退出按钮。全屏使用浏览器 Fullscreen API，隐藏周围面板、项目文件树、路径与产物页脚；Viewer 自己的工具栏、Scene Tree 和状态栏保持可用。点击退出恢复原布局；macOS 原生 Esc 退出后的 HTML 全屏状态同步尚未验证。切换时保留已挂载的 Viewer 与 Godot 运行会话。

## PD-012：图片、Sprite 图集与动画预览

- 日期：2026-09-28
- 状态：已确定
- 来源：用户要求补充三个素材 Viewer
- 原因：在文件工作区查看游戏素材与动作，避免每次启动游戏。

### 决定

PNG/JPEG/WebP 打开图片 Viewer，顶部切换图片、图集和动画模式；图集手动设置网格、选帧；动画支持动作选择、播放、逐帧、倍率和循环。受支持的 Godot 动画文本资源及可选 `.sprite.json` 通过独立插件注册，读取真实帧与时序；不猜测动作、不运行脚本、不修改项目。支持范围与限制见 [素材 Viewer](godot-assets-viewers.md)。


## PD-013：PCB domain 的 KiCad Viewer V1

- 日期：2026-09-28
- 状态：已确定，V1 接入
- 来源：用户要求参考 Godot Viewer 为 PCB domain 接入 KiCad
- 原因：在项目文件树内直接查看 KiCad 设计，并沿用通用 Viewer Registry 与隔离画布。

### 决定

保留已有 PCB domain，打开 `.kicad_pcb` 或 `.kicad_sch` 自动选择 KiCad Viewer。本地固定版本 KiCanvas 提供板图的图层、网络、封装和属性查看，以及原理图与多页浏览。所有源文件只读，主文件及引用的子页经过哈希和项目边界校验。无需安装原生 KiCad 或联网；编辑、DRC/ERC、3D 与原生编辑器连接不属于此次 Viewer 接入。已验证范围和格式限制记录在 [KiCad Viewer V1](kicad-viewer.md)。

## PD-014：可直接绑定的 Viewer 示例项目

- 日期：2026-09-28
- 状态：已确定
- 来源：用户要求合并全部 Viewer 工作、启动本地应用并提供 example 项目
- 原因：让用户能立即通过普通项目文件树体验新增查看能力。

### 决定

仓库提供 `examples/pcb-led` 与 `examples/godot-viewer` 两个独立源项目，分别绑定 PCB 与 Godot Domain。板图、原理图、原创图集和场景源文件随仓库提交；Godot 导出脚本复制当前 Viewer Bridge，生成本地单线程 Web 导出，导出二进制不进入版本库。示例沿用普通 Project 创建和文件查看流程，不增加产品内 fixture 菜单。查看与交互演示不构成工程 Verification。
