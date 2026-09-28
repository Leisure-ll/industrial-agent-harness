# Desktop

Electron MVP 工作台采用项目树、Agent 对话、Viewer 三列布局。左右栏可收起，左下角 Settings 可切换明暗主题与 Debug 日志。文件树只列出当前项目的文件；点击 GDS/OAS、Yosys JSON、VCD/FST/GHW 文件会自动打开对应 Viewer，并显示内容哈希。对话区输入任务并解析 Capability；Debug 开关展示候选、筛选、Scope 替换和详细信息加载日志。

Kimi Code 会话需要本机 `kimi` CLI。界面会检测其可用性；选择工程目录、解析能力后即可运行任务，并查看文本、工具事件和审批请求。当前 Agent 工具是按 Scope 提供的只读产物元数据工具；完整工业执行与验证链路尚未接入。

运行 `pnpm dev` 或从仓库根目录运行 `pnpm build && pnpm start`。版图渲染可先运行 `pnpm setup:layout`，或设置 `KLAYOUT_PYTHON`。

## Agent 行为日志

聊天标题栏的 **Logs** 可查看当前项目的详细 Agent 行为日志，Debug 无需开启；每轮对话中的 **View agent log** 直达该轮记录。左侧选择历史运行，中间按事件类型或名称/摘要查找，右侧查看工具输入、完整返回或原始事件 JSON。上下文分类包括 `StatusUpdate`、`CompactionBegin/End`、观察锚点及 Kimi 快照元数据；审批选择和会话重建/复用也保留原始记录。较大的记录使用 Previous/Next part 分段阅读。运行中自动刷新，结束时补齐尾部记录；Esc 关闭。

日志来自 `~/.industrial-agent-harness/logs/<project-hash>/`，沿用生产日志的凭据脱敏；仅有当前 Project 的日志可通过受限主进程 API 读取，API 不接受任意路径。查看不发起 Agent 运行或修改项目/模型配置。最多列出 50 次运行，每页 100 个事件，文件/记录查看上限分别为 64/16 MiB；原文件不被截断，超限明确报错。

`pnpm --filter @industrial-agent-harness/desktop test:logs` 在隔离用户目录和正常项目绑定下检查历史、筛选、完整长返回、原始 JSON、项目边界、Esc、实时追加及结束刷新。测试使用确定性 SDK 会话注入，运行经过生产 `KimiSession` 与日志写入/读取/IPC/UI 链路，不发起模型网络请求。
