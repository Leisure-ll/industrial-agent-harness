# Kimi agent adapter

Thin integration around `@moonshot-ai/kimi-agent-sdk`, pinned to `0.1.8` in this package and the root lockfile. It will map sessions, events, tool registration, approvals, interruption, and recovery where supported by the SDK. Validate the actual API before claiming a capability.

当前已接入会话启动、流式文本、工具事件、审批与中断入口。有效 Broker Scope（domain、stage、capability、skill、tool）或模型配置变化时创建新会话；仅 Scope 版本号变化会复用原会话。只注册当前 Scope 对应的 Harness 外部工具，工具处理器再次校验当前 Scope。需要本机 Kimi CLI 才能做真实会话验证。

P0 的实际工业会话采用 macOS Seatbelt：真实 Kimi/原生 Shell/WriteFile/子 MCP 只能写隔离 session/scratch，实际工程只读；宿主 `industrial_action_call` 以当前 DomainState ID、Scope 和审批进入持久 Runtime。固定 Kimi 要求 cwd 可写，所以使用稳定 session workspace，Prompt明确原 Project 的绝对路径与只读 project/ 链接。原生上下文恢复及快照按 workspace 关联。未验证的 Linux/Windows 拒绝启动；已注册 Runtime 的会话在披露、配置和 Skill/Tool 装载之前排除外部 MCP host 服务与应用控制插件，保留用户配置并记录原因，Runtime 工具继续可用。其他受保护会话仍明确拒绝未支持的 host 配置。旧 Domain MCP mutation 也受此只读边界限制。详见 [安全边界](../../SECURITY.md) 和 [实际闭环](../../doc/p0-industrial-runtime.md)。

Harness 外部工具返回最多 16 KiB UTF-8 JSON；能力详情可按 `skills`、`tools`、`verification` 分段获取。每轮 Industrial Context 最多 8 KiB。SDK 的上下文占用和压缩事件会汇总为 `context-metrics`；界面工具结果截断会标注原始字节数。这些外部工具边界不作用于 Kimi 原生工具；已注册 Domain MCP 网关另有 16 KiB 输出和原始响应分页限制，也不改写 Kimi 的上下文压缩。

每轮生成一份完整的 JSONL 诊断日志，保留 Broker Trace、实际送入 SDK 的提示、SDK 暴露的原始事件和未截断的工具结果。固定 CLI 版本的 `context.jsonl` 与 `wire.jsonl` 也在每轮结束时保存受限权限的快照，日志记录路径、字节数及 SHA-256；快照失败会显式记录。日志路径通过 `diagnostic-log` 事件给 CLI 与桌面 Debug 模式。已知 API Key 和常见凭据字段会脱敏；日志仍含工程数据。若提供观察状态回调，提示中会附带最小 Checkpoint 锚点，`industrial_context_read` 可按页取回；该工具只报告文件哈希观察，不报告工程验收结论。

每个 SDK 会话使用独立 Kimi share directory（Desktop/CLI 提供持久目录，未提供持久回调的调用方使用临时目录）：复制模型配置，以 `extra_skill_dirs` 添加经过 Project 禁用策略和 Broker Scope 筛选的仓库 Skill，并生成会话 `mcp.json`。会话 workspace 映射所选 Project 根目录的 `.kimi/skills`、`.claude/skills`、`.codex/skills`、`.agents/skills`、`AGENTS.md`（缺失时使用 `agents.md`）和 `.kimi/AGENTS.md`，由 Kimi 原生发现、解析和处理同名优先级；同时以绝对路径追加 `.skill/`、`.skills/`，支持 `<name>/SKILL.md` 与 `<name>.md` 布局。摘要先披露，正文按需读取，资源引用保留在原项目中；这些项目技能不授予工业工具权限，也不进入 Broker 注册技能的启停清单。原生用户 Skill 路径继续由 Kimi 发现；`.skill/` 与 `.skills/` 作为 extra scope，优先级低于原生项目及用户 scope。

会话通过 Kimi 原生 `--add-dir` 注册真实 Project，使 Glob 能搜索其绝对路径；工作目录仍是隔离 workspace。`KIMI_SHARE_DIR` 固定为实际会话目录，避免 SDK 0.1.8 的 env 优先级覆盖 shareDir。上述映射在新建或重开原生进程时更新，运行中的技能索引不会自动刷新。升级后的工作区版本参与兼容键，旧聊天开始一个新上下文段并保留历史。映射仅覆盖所选 Project 根目录；绑定仓库子目录时的祖先指令、相对 cwd、原生斜杠命令等剩余限制见 [Kimi 原生机制审计](../../doc/kimi-native-compatibility-audit.md)。

关闭会话只删除临时目录，持久目录仅在明确删除聊天时清理；用户的 `~/.kimi` 不会被改写。当前默认注册 Chip Pack；会话配置绑定绝对项目路径、当前 Tool Scope 和固定运行时。普通任务与禁用后的 Scope 不加载它。MCP 文本分段被转换为聊天可见文本，原始 SDK 记录保留。详见 [MCP 接入](../../doc/domain-mcp-integration.md)。

`DiagnosticReader` 提供当前项目的运行列表、原始记录分页及 UTF-8 分段读取；只读语义投影提供时间线、上下文和调用/返回配对，不改写原始日志。上下文从同项目同 Trace 的固定原生快照读取，验证路径、大小及 SHA-256；无压缩且当前提示及全部 Checkpoint 保留时，按步骤边界展示保存的消息。该视图不是完整 HTTP 请求记录，不猜测缺失的上下文或工具定义。索引缓存有界，完整语义内容只缓存一轮；原始记录最多 64 MiB，单记录 16 MiB，上下文快照最多 64 MiB；逐步骤消息关联最多 200,000 项。SDK/UI 双重记录只在展示中去重。支持范围与 UI 限额见 [桌面文档](../../apps/desktop/README.md)。

`KimiSession.run(task, images)` 接受经校验的内联 PNG/JPEG/WebP 用户参考。有图时调用原生 SDK `prompt(ContentPart[])`，保留原始 data URL；无图保持字符串接口。模型能力配置共享于 CLI/Desktop，声明支持图片时生成 `image_in`；配置不支持则在请求前拒绝，不静默退化成文本。图片字节、尺寸、哈希及实际 ContentPart 存入每轮诊断日志；这些输入不构成工程验证结果。

`KIMI_EXECUTABLE=/absolute/path/to/kimi node --test packages/agent-kimi/tests/vision-wire.test.cjs` 从仓库根目录执行真实 SDK 0.1.8 / CLI 1.51.0 的可选集成测试。它使用本地 OpenAI SSE fixture，检查实际 Provider 请求中的图片与原生历史，不使用真实 API key。CI 未安装 CLI 时明确跳过；普通测试仍检查生产 adapter 的多模态发送、能力拒绝及完整日志。桌面三种图片格式与当前 MiniMax M3 实际识图已在 macOS 验证。

Desktop/CLI 通过 `resolveSession` / `sessionInitialized` 回调提供共享聊天索引中的不透明运行时身份。有效 Scope 与模型配置兼容时，把原 session ID 和持久 share directory 交给 SDK 恢复；不兼容时产生新段。已初始化的上下文丢失会报错，不默默创建空上下文。接口与验证见 [聊天持久化](../../doc/chat-persistence.md)。

运行时接受有效外部 MCP 快照，经 domain-mcp 生成私有 Gateway 配置；revision、连接配置、工具 schema 和引用环境值参与会话兼容性，运行中的 adapter 也在下一轮检测变化。Industrial Context 只给发现入口，不倾倒全部 schema。真实 MCP 截图经 Kimi 原生多模态进入视觉模型；审批由固定 CLI 处理。已知外部凭据加入诊断 JSONL 脱敏，观察保持未验证。见 [外部 MCP](../../doc/external-mcp.md)。

日志索引以 64 KiB 块扫描，跨块记录只在完整时拼接一次；追加记录增量更新分类统计。序号与语义 ID 使用索引查询，长字段的 UTF-8 分页最多复用一个已编码字段。缓存仍按文件身份和变化失效，保留原有大小、路径与快照哈希校验。性能证据见[全仓优化记录](../../doc/repository-optimization.md)。

## 横切插件注入

Desktop/CLI 通过 `diagnostics.resources` 注入 Core 的共享资源管理器，Kimi 只在获得执行及常驻额度后启动原生 Prompt。启用该管理器必须同时提供持久会话回调；空闲关闭不删除持久目录，下一轮仍使用固定 SDK 的原生恢复。`onIdleRelease` 允许宿主释放观察数据库连接，`close()` 释放原生进程和资源租约。详见[多会话资源保护](../../doc/session-resource-guards.md)。

`KimiSession` 仍保留已有横切插件注入 API 与受控会话测试。已注册工业 Runtime 的会话不加载应用控制插件，也不加载外部 MCP；不改动用户保存的 enable/disable 配置，记录 `resource.filtered` 与可见提示。不能通过插件宿主 callback 绕过工业授权与审计。将这些侧效应纳入 Runtime 后，才可声明这些服务在真实工业会话可用。

Kimi Wire `QuestionRequest` 进入当前会话的待答状态，`answerQuestion` 调用固定 SDK 的 `respondQuestion`，支持重试、跳过和完成后的过期处理。固定 Kimi CLI 1.51.0 将问题 ID 同时用作 RPC 请求 ID；真实 Wire 回答链路已验证。`approvalMode=auto` 传给 SDK 的 `yoloMode`，不改变问题需要用户作答的语义。

Stop 优先发送原生取消，3 秒后本轮仍未结束则通过 SDK 关闭该会话，并在关闭完成后结束宿主等待。重复 Stop 复用同一请求；其他会话继续运行，旧轮次迟到的事件不会进入新轮次。该路径处理 SDK 0.1.8 信号强杀后结果等待不结束的边界，未修改 SDK，也不自动重试工程动作。执行错误关闭本轮原生会话，观察/日志清理失败仍释放执行额度。真实验证入口：`pnpm test:session-chaos`，范围见[资源与切换保护](../../doc/session-resource-guards.md)。

`industrial_tool_describe` 在当前 Broker Scope 内按需提供选中工具的输入指南与例子；`industrial_action_call` 根据指南提交输入，回传相对产物路径和验收范围。指南不构成工程证据。

每轮工程上下文还包含当前 DomainState 的有界产物引用（最多 2 KiB，优先模型引用），提供规范 ID、种类、相对路径与哈希，不读取内容或猜测活动模型。后续「刚刚的新版本」可据此定位实际输出；原始输入文件和当前产物明确区分。

`industrial_action_call` 接受互斥的 `inputs` 对象或 `inputsJson` JSON 字符串（最多 256 KiB），优先后者保留复杂嵌套的数值/数组类型。严格解析为同一规范 inputs 对象后进入原有 Scope、State、审批和 Runtime 校验；不把字符串数字或 `{item:…}` 转为工程数值/数组，不改动 Kimi/SDK。真实 MiniMax-M3 CAD 修改曾因未定型嵌套参数的错误编码连续重试，增加显式 JSON 传输后另行验收。无交互 CLI 的问题处理见 [CLI](../../apps/cli/README.md)。
