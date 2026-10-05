# Desktop

当前开发者预览版的桌面构建与首次启动 CI 目标为 **macOS Apple Silicon（arm64）和 Windows x64**。Intel Mac 暂不支持，已退出 CI 与安装包发行矩阵；恢复前需有对应测试机并完成安装、运行与升级验收。签名安装器和真实 OTA 尚待验证，Windows 的真实工业 Agent 执行也仍受[执行边界](../../SECURITY.md)限制。

当前桌面支持同一项目或跨项目的多个聊天同时执行，切换聊天不会中断后台任务。项目行显示运行数，聊天行用状态点标记执行中或等待审批；Approve/Reject 与 Stop 只作用于当前聊天。全局模型/资源修改需要相关会话空闲，项目配置仅限制该项目。实现与验证见 [并行会话](../../doc/parallel-sessions.md)。

Electron MVP 工作台采用项目树、Agent 对话、Viewer 三列布局。左右栏可收起，左下角 Settings 可切换明暗主题与 Debug 日志。文件树只列出当前项目的文件；点击 GDS/OAS、Yosys JSON、VCD/FST/GHW 文件会自动打开对应 Viewer，并显示内容哈希。对话区输入任务并解析 Capability；Debug 开关展示候选、筛选、Scope 替换和详细信息加载日志。

通用文件无需领域工具：CSV/TSV 打开表格、普通 JSON 打开折叠结构、JSONL/NDJSON 按记录查看、Markdown 显示排版、TXT/LOG 支持行号与筛选分页。全部复用缩放、Fit 和全屏，结构化文件保留原文入口；Yosys JSON 与图集描述文件优先进入原专用 Viewer。支持格式与上限见 [通用文件 Viewer](../../doc/document-viewers.md)。运行 `pnpm --filter @industrial-agent-harness/desktop test:documents` 验证生产查看链路。

Kimi Code 会话需要本机 `kimi` CLI。界面会检测其可用性；选择工程目录、解析能力后即可运行任务，并查看文本、工具事件和审批请求。工具包括按 Scope 提供的只读产物元数据、共享 Chip MCP 和显式注册的外部 MCP；完整 Core 工业执行与验证闭环尚未完成。

运行 `pnpm dev` 或从仓库根目录运行 `pnpm build && pnpm start`。版图渲染可先运行 `pnpm setup:layout`，或设置 `KLAYOUT_PYTHON`。

## Agent 行为日志

Desktop 与同一配置目录的 CLI 默认共用 4 个执行额度、6 个常驻会话额度。超额执行明确拒绝，常驻位置优先让最久未使用的空闲会话释放；空闲 5 分钟回收并在下次执行恢复 Kimi 原生上下文。运行中、等待审批/回答的会话不自动回收。关闭应用等待进程与额度清理。配置和压测见[多会话资源保护](../../doc/session-resource-guards.md)。

渲染器将普通流式展示事件按约 16 ms 合批；审批、提问、结束和错误立即刷新，主进程仍逐个持久化原始事件。合批时再次检查当前聊天，旧轮次保持引用，避免高频文字更新重渲染全部历史。项目文件访问集中在 `electron/project-files.cjs`，展示事件合并集中在 `src/agent-events.ts`；完整评审与基准见[全仓分析与优化](../../doc/repository-optimization.md)。

聊天标题栏的 **Logs** 和每轮 **View agent log** 打开当前项目日志。默认 **时间线** 按模型步骤合并完整回复，工具调用与结果配对，不重复 SDK/UI 文字。**工具调用** 展示调用名、参数、完整返回、结果说明、状态和耗时；未返回或缺失请求单独标注。**上下文** 展示送入 SDK 的完整提示、Broker 范围、项目观察及 Kimi 原生会话快照中的系统指令、历史消息和工具结果。原生快照的路径、大小及 SHA-256 经校验；没有压缩且提示与全部 Checkpoint 边界完整时，可按模型步骤查看保存的上下文。快照不包含完整 HTTP 请求及全部工具定义，缺失边界不会重建猜测。步骤和工具可跳转到对应上下文、工具视图和时间线。

**原始事件** 保留事件类型与摘要过滤、JSON 及关联事件入口。较大的正文和原始记录使用 Previous/Next part 按 UTF-8 分段阅读；运行中自动刷新，结束时补齐尾部记录，Esc 关闭。
日志来自 `~/.industrial-agent-harness/logs/<project-hash>/`，沿用生产日志的凭据脱敏；仅有当前 Project 的日志可通过受限主进程 API 读取，API 不接受任意路径。查看不发起 Agent 运行或修改项目/模型配置。最多列出 50 次运行，每页 100 条记录，文件/记录查看上限分别为 64/16 MiB；原文件不被截断，超限明确报错。

`pnpm --filter @industrial-agent-harness/desktop test:logs` 在隔离用户目录和正常项目绑定下检查历史、筛选、完整长返回、原始 JSON、项目边界、Esc、实时追加及结束刷新。测试使用确定性 SDK 会话注入，运行经过生产 `KimiSession` 与日志写入/读取/IPC/UI 链路，不发起模型网络请求。

## MCP 与 Skill 配置

左下角 **Settings → MCP & Skills → Configure** 管理全局默认值。点击项目进入详情页，在 **MCP & Skills** 为该 Domain 的资源选择 **Inherit / Enabled / Disabled**；项目覆盖优先于全局，并显示生效状态。已有五个内置 Skill 和 Chip Pack Domain MCP；同一全局页面的 **External MCP services** 可通过本地命令、远程 URL 或 JSON 导入添加外部服务。

配置保存到 `~/.industrial-agent-harness/resource-settings.json`（权限 0600、原子替换），与 CLI 共用；`INDUSTRIAL_HARNESS_CONFIG_DIR` 可指定隔离配置目录。项目按真实目录绑定，原项目禁用列表首次启动时迁移为显式禁用，之后恢复继承不会再次迁移。资源变更关闭旧 Kimi session、清空 Broker Scope，下一任务重新解析；正在执行或准备任务时拒绝更改。该配置只管理资源启用，不修改项目源码或用户 Kimi 配置。

**Settings → Approval mode** 可选 Request approval（默认）与 Auto approve。后者启用 Kimi 原生自动审批，对文件、Shell 与 MCP 操作不再逐次询问；运行中的轮次保持其启动时模式，下轮生效。Agent 的结构化提问显示在当前聊天，支持单选、多选、自定义答案和跳过，回答后原轮次继续；提交失败可重试。

审批提交期间禁用按钮，提交成功或 SDK `ApprovalResponse` 到达后折叠为 Approved/Rejected 记录，移除行动按钮；失败保留请求供重试，任务结束的未决请求标为过期。后端拒绝重复、过期和非法审批。`test:logs` 同时覆盖配置继承、项目隔离、正在运行时禁止改配置、审批失败重试/批准/拒绝/过期及现有日志读取。

左侧选中项目下缩进显示 **New chat** 和持久历史聊天，项目行打开项目详情。聊天重启后可继续，历史每页加载 10 轮；New chat 优先复用同项目、Domain 的空白聊天，当前聊天为空时禁用入口。已有提交轮次的聊天保留为历史，重新打开同一个空白聊天保留未发送的文字和图片。实现与验证见 [聊天持久化](../../doc/chat-persistence.md)。

## 图片输入

输入框的 **Attach images** 支持文件选择，也可直接粘贴截图或拖入图片。发送前显示缩略图、文件名与移除按钮，发送后保留在用户消息中；仅图片发送使用默认描述任务。支持 PNG / JPEG / WebP，最多四张，每张 5 MiB、总计 10 MiB，最长边 8192、合计 32 MiPixels。切换项目或切换到另一个聊天清除草稿；重新打开当前空白聊天保留草稿。模型拒绝、网络失败或取消后恢复图片，可带图重试。

**Settings → Model API → Image input** 提供 Auto / Enabled / Disabled。Auto 仅对官方 MiniMax 兼容 API 的 M3 / M3.1 Flash preview 开启；其他视觉模型需手动选择 Enabled，纯文本模型保持 Disabled。更换模型、Provider 或 URL 会回到 Auto；模型缺少图片能力时禁用带图发送并提供配置入口。SDK / CLI 的 Provider 负责协议转换，Harness 不把图片变成路径或悄悄丢弃图片。

`pnpm --filter @industrial-agent-harness/desktop test:images` 使用隔离配置验证文件选择、粘贴、拖入、三种格式、图片专属任务、模型禁用、错误带图重试、项目隔离与草稿重置。macOS 当前 MiniMax M3 的实际识图也已验证；其他模型仅支持显式能力配置，并不表示已经逐一验证。

## Chip Pack MCP

外部服务注册与 CLI 共用，详情见 [外部 MCP](../../doc/external-mcp.md)。`test:external-mcp` 在隔离用户目录运行真实 UI 添加/刷新/移除、项目禁用、运行中拒绝修改及固定 Kimi 审批/截图路径。需要服务自行安装并获得系统授权，GUI 不自动申请这些权限。

Chip 项目默认注册 `chip-pack.eda`，在全局 MCP & Skills 与项目详情页可查看和禁用。准备固定 Python 依赖后，工程任务通过共用 Broker 和项目绑定网关调用 EDA Runtime；沿用聊天审批、工具结果和日志。macOS 真实 Kimi/Electron 路径由 `test:mcp` 验证。见 [共享 MCP 接入](../../doc/domain-mcp-integration.md)。

`INDUSTRIAL_HARNESS_SESSION_IDLE_MS=100 pnpm --filter @industrial-agent-harness/desktop test:parallel` 还覆盖 200 次聊天/项目切换、160 次同帧双击、4 个后台任务与第 5 个拒绝、重载后问题恢复、重复 Stop、延迟历史与实时结束交错，以及带活动审批退出。SDK 会话可控，Renderer、IPC、持久化和资源管理使用生产路径；真实 Kimi 强杀/停止/恢复另由 `pnpm test:session-chaos` 检查。行为与边界见[验证报告](../../doc/session-resource-guards.md)。

对话与右侧工作区之间的分隔条支持拖动与方向键调整，Agent 对话区可缩窄至 280 px，双击恢复默认比例。窗口缩小自动限制分栏宽度，全屏退出保留原分栏。CAD 使用当前视图区宽高比，拖动与全屏不拉伸模型；`test:cad` 包含实际渲染像素比例、分栏限位和恢复检查。


## 原生子任务显示

主 agent 派发的 coder/explore/plan 在对话内以折叠任务卡显示；展开看思考、工具输入/结果及摘要，审批按钮保持可见。后台任务在主回合结束后继续更新，聊天状态点仍保留；Scope/模型/资源设置等待相关任务结束。控制沿用 Kimi 原生工具，首版子 agent 不接入独立工业 Runtime 调用。运行 `KIMI_EXECUTABLE=/absolute/path/to/kimi pnpm --filter @industrial-agent-harness/desktop test:subagents` 验证真实 CLI → IPC/Store → GUI、后台审批和历史刷新；详见[边界与证据](../../doc/kimi-subagent-integration.md)。
