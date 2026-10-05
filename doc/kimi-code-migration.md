# Kimi Code 2.1.1 迁移

2026-10-05：Desktop 与 Headless CLI 共用 `agent-kimi`，运行时从 Python CLI 1.51.0 / npm Agent SDK 0.1.8 迁至 MIT 开源的 `@moonshot-ai/kimi-code@2.1.1`。固定版本和完整性由 manifest、pnpm lockfile 保证，服务启动时再次核对版本，关闭自动更新。

旧 [kimi-cli 仓库](https://github.com/MoonshotAI/kimi-cli) 于 2026-09-23 归档。[新仓库](https://github.com/MoonshotAI/kimi-code)公开源码；新 Node SDK 尚未发布至 npm，所以本接入使用官方公开的 [Server API](https://github.com/MoonshotAI/kimi-code/blob/%40moonshot-ai/kimi-code%402.1.1/docs/en/reference/server-api.md)。该 API 被上游标记为实验性，升级必须先通过固定版本契约测试。

## 接入边界

- 每个会话独立启动 `kimi web --host 127.0.0.1 --no-open`，使用私有 `KIMI_CODE_HOME`、随机 token、REST 与认证 WebSocket。执行与常驻额度继续由现有 Core 管理。
- Kimi 负责原生 Agent Loop、工具循环、Skill、压缩与持久化。Harness 只映射事件、身份和生命周期，不复制 SDK 或 fork 上游。
- 工业与外部 MCP 继续通过既有 Gateway；宿主 metadata 工具与插件回调经认证的本地 MCP 服务提供，执行时仍检查当前 Scope。启动等待所有已配置 MCP 连接；错误或超时明确失败，避免缺少工业工具却继续运行。
- `openai_legacy` 产品设置映射至新内核的 `openai` provider；密钥通过 `api_key_env` 注入，输出上限用 `max_output_size`。Node.js 最低版本为 22.19。
- manual 模式保留每次审批；Harness 的 auto 策略和已启用插件继续自动批准相应请求，问题仍需用户回答。停止优先调用原生取消，超时只关闭目标会话。进程死亡、事件断连或流缺口明确失败，不自动重提任务。

## 历史与诊断

兼容性键加入内核及版本。旧聊天展示、诊断和旧上下文文件保留；首次继续旧聊天建立新原生上下文段并提示。新上下文身份以 `harness-native-session.json` 映射，实际消息与恢复材料由 Kimi Code 管理。已初始化身份或原生历史缺失时报错，不悄悄替换为空上下文。

原生事件保存为 `kimi-code.event`，既有界面和历史诊断消费者继续使用映射的 `sdk.event`。新快照通过消息 API 获取，展示为“已保存对话”；它不等于完整模型上下文、系统指令或 HTTP 请求，也不推断每个模型步骤的上下文。旧 context/wire 快照只读解析仍保留。已知密钥、认证 token 和返回的图片载荷不进入诊断事件或快照。

## 验证

使用 macOS arm64、Node.js 26.10.0、固定 Kimi Code 2.1.1 与本地可控 OpenAI SSE 响应；不使用远端模型密钥。测试运行真实内核，模型响应只用于控制链路，不代表工业验收或模型质量。

- Agent 包回归和固定版本契约：Bash 批准/拒绝、参数完整性、Scope 撤销、双服务认证、启动失败、版本不符、启动中取消、并行隔离，以及两种 provider 的图片输入。
- `test:chat-resume`：多进程三轮恢复、模型切换创建新段、SIGTERM 中断后继续。
- `test:session-resources` / `test:session-chaos`：空闲回收、跨宿主额度、强杀后清理与恢复、另一聊天独立完成。
- `test:external-mcp`：真实 stdio/HTTP/SSE Gateway、拒绝后无 host 修改、截图进入模型请求。
- Chip MCP 测试使用独立固定 Python 环境，检查目标持久化和上下文回读；不执行芯片计算或 signoff。
- 架构边界、桌面构建、Headless 打包与包外运行使用既有验证入口。

本次结果：

| 检查                         | 结果                             | 范围                                                                                       |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| 全仓 `pnpm test`             | 189 项：188 通过、1 跳过、0 失败 | 唯一跳过为可选 Viewer 依赖；Agent 测试均运行                                               |
| `test:architecture`          | 12/12 通过                       | Core/Broker/CLI 分层边界                                                                   |
| 六项真实内核集成             | 6/6 通过                         | 问题、跨进程恢复、资源额度、强杀恢复、外部 MCP、Chip MCP                                   |
| Desktop 构建与格式检查       | 通过                             | TypeScript、Vite 与源码格式                                                                |
| macOS Electron 聊天/并行回归 | 通过                             | 重启恢复、200 次切换、160 次同帧双击、审批/提问/Stop 隔离；使用受控会话 seam               |
| macOS arm64 未签名 `.app`    | 通过                             | 首次启动、归档中的真实 2.1.1、认证 MCP 回调、Bash 审批与写入、跨原生进程恢复、Web 资源读取 |
| Headless 包外实际执行        | 通过                             | 无额外 Kimi 安装，随包真实内核完成一轮请求                                                 |

桌面发布流程增加 `node scripts/smoke-packaged-kimi.cjs`，在打包后实际运行原生内核。它在本地受控模型下检查宿主回调、审批、文件执行及恢复，macOS arm64 已实测；macOS Intel/Windows 的对应发布 gate 尚未在本次运行。未签名 `.app` 构建使用 Electron 44.0.0；签名、安装器和 OTA 不属于上述结果。

旧 27B 长上下文和自动压缩测评属于旧内核历史证据。新版本的远端模型、长上下文压缩、具体 GUI 供应商、Windows/Linux 打包与安装仍需独立验收。WebSocket 异常目前明确结束当前轮，不实现断连后的透明续流；已落盘上下文可在下一轮恢复。完整 Industrial Core Vertical Slice 的既有缺口不因本迁移完成。
