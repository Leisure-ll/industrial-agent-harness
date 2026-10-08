# PCB Bench MCP：Desktop 与 CLI 共享接入

Historical standalone MCP reference. Integrated PCB/Godot now consume owner-maintained typed Runtime Actions; this MCP surface is frozen and is not disclosed by the product Broker. See [current native profiles and qualification](pcb-godot-runtime.md).


2026-09-29，已实现注册、完整 Skill 加载、范围网关和原生 controller launch adapter；
协议、配置与固定外部源码已验证。**原生 KiCad 镜像执行尚未验证；不计作 Industrial Core Vertical Slice 或 bench 全能力超集验收完成。**

## 资源与版本

`packs/pcb-bench.json` 注册 `pcb-bench.tools`、89 个 canonical Tool ID、六个阶段组与一个完整工具组；
`pcb.design.e2e` 绑定外部 `pcb-design-e2e` 的正文、9 个参考文件和示例 asset。
Desktop 的 Settings → MCP & Skills 和 PCB Project 资源页自动消费共享 catalog；CLI 使用相同全局默认与项目覆盖。
项目可启用、禁用或继承资源；当前 Scope 内真正调用时仍检查 allowlist，不接受参数增加权限。

固定后端 commit `f64692bcfdd74ac6d95051df1adac598cf21105a`，原生工具 schema 摘要
`162b419952c2fcdbe401887cb0827449f4f10e1c17bcfa374423784b012446bf`。
运行时为上游 KiCad 10.0.6 release 镜像，KiCad CLI/pcbnew 和 symbols/footprints/3D 发行包须匹配锁声明。
gateway 单独固定 MCP Python SDK 1.29.1；本仓库 Kimi SDK/CLI 版本保持原声明。
超时等运行参数按本 Harness 的政策处理，不要求与 bench 相同。

完整安装、镜像前提、环境变量和 candidate 目录约定见 [PCB Pack](../domain-packs/pcb/README.md)。

## 调用链

Desktop / CLI → shared Core/Broker/资源策略 → 当前 Scope → Kimi 会话的独立 `mcp.json`
→ official MCP SDK PCB gateway → 固定 Docker 镜像里的上游 controller → PCB Runtime/native tools。

Gateway 只披露四个工具：

| 工具 | 行为 |
| --- | --- |
| `domain_tool_list` | 分页发现当前 Scope 的 canonical ID、原生名称、摘要与风险 |
| `domain_tool_describe` | 获取一个已允许工具的真实 input schema |
| `domain_tool_call` | 在已绑定 Project 中调用已允许工具；保留原生结果及错误，变更沿用 Kimi MCP 审批 |
| `domain_tool_result_read` | 分页读当前会话保存的大响应，并保留完整摘要 |

实际服务身份、全部 89 个 live tool 名称和 schema 摘要必须与声明一致。
不假设 PCB 服务具有 Chip 的包版本、`get_server_info` 或 CLI 启动约定；两个 provider 用各自 adapter。
`inspect_tool` 不能借一个允许的观察工具获取另一个被禁止工具的契约。
参考文件读取保留上游限制；对 controller 返回的 revision、分页/omission、观察覆盖与 verifier 状态不作伪造。

Skill 从已校验的外部资源树完整复制到独立 Kimi session，附加 canonical gateway 调用说明。
Scope 更换时清除上一批全部 Skill 文件；资源不符拒绝启动，不回退为仓库里的注册 stub。
公共包只携带注册与桥接代码，不携带私有 backend/Skill 正文、维护 Skill、任务或参考答案。

## 执行边界

Docker 只挂载该 candidate、launch adapter 和独立 policy；公开需求文件可选且只读。
执行固定镜像内的原始工具和设计 Skill，并再次核对其源摘要；不挂载 PCB-bench checkout，也不用可变宿主源目录覆盖镜像。
原生程序由上游 Domain Runtime 执行，gateway 不直接执行 CAD，也不创建另一个 model loop。
启动时检查 Linux/root controller 身份、KiCad/CAD 包版本、源摘要与原生 schema。
同一可写工作区只允许一个活跃 controller；其他聊天仍可并行，原生 PCB 同时执行须使用不同 candidate 目录。

保留上游动作 lease、pending/completed receipts、观察覆盖、输入/输出与原生验证语义。
未知动作结果不自动重试或重放；连接不会自动 reconcile pending 变更。
恢复同一工作区需保持声明的 source/image/schema/公开需求身份；另一版本不能覆盖旧 session。
已有非本桥接的 `session` 目录拒绝接管。标准 Kimi 工具不是完整的 bench actor OS sandbox；
此接入只对原生 MCP 工具/controller 的容器和受限 Python 执行边界作上述约束。

工具执行成功、合法的检查 FAIL、UNKNOWN 与最终工程验收分别保留。
`requirementsBound` 表明是否绑定外部公开需求；未绑定时不声称独立 bench acceptance。
Viewer/文件观察仍只读，不从渲染或 schema discovery 更新验证状态。
本次不把上游 receipts 冒充 Harness 已完成的 canonical DomainState/Checkpoint 闭环。

`view_design` 的 PNG image blocks 仅在当前模型声明支持 image input 时发送。
text-only 模式不会声称图片送达；返回中的图片摘要与 `delivered` 字段保留实际行为。
大文本响应保留全部 transport 内容并分页，原生已压缩的观察不会被重建成完整原始 Action stdout。
单次参数 64 KiB、文本返回 16 KiB、会话缓存 4 MiB；图片每张最多 4 MiB、最多 4 张、总计 10 MiB。
没有自动变更重提；传输失败后查看既有 controller 记录。

## 渐进披露与日志证据

本接入按**模型上下文**衡量渐进披露，不以磁盘上是否已准备资源或进程里是否已有 schema 衡量：

1. Broker 先记录 `domain.index`、`capability.resolve`、`skill.batch`、`tool.scope` 和 `detail.deferred`。会话只准备 Scope 选中的 Skill。
2. Kimi 的初始系统指令包含 Skill 名称、描述与 `SKILL.md` 路径；正文及 references 不直接注入。用 `ReadFile` 读取正文及指定 reference 后，这些结果才进入模型消息。
3. PCB gateway 启动时获取全部原生 schema 以核对固定工具身份；模型只看到四个 wrapper tool。`domain_tool_list` 给分页摘要，`domain_tool_describe` 才返回所选工具的参数 schema。
4. 原始诊断日志保留 Broker Trace、ReadFile/describe/call 的 ToolCall/ToolResult，以及实际 Kimi 上下文快照。UI「工具调用」可展开文件路径、参数和返回；「上下文」可查看选择依据与已保存的步骤边界。没有专用 Skill 加载动画，也不将资源复制视为模型阅读。

渐进披露测试使用真实固定 Kimi、CLI 和完整外部 Skill，逐步检查受控模型端实际收到的请求：初始正文/schema 不在上下文；读取正文和参考文件后进入；列表不带 schema；describe 后出现所选 schema。再用生产 `DiagnosticReader` 校验同一日志的 UI 工具投影与完整详情。这是日志数据链验证，**不是 Electron 页面截图或真实模型自主选择能力的验收**。

真实设计任务仍须在固定原生镜像上完成正/负任务：从公开需求生成原理图并通过 ERC，生成 PCB、布局布线、填铜并通过 DRC/连通性检查，导出实际文件；对故障工程定位、修复并重新验证。执行需保留候选 revision、原生 receipts、检查结果及渐进披露日志。受控测试不会代替该 gate。

## 已验证与未验证

- 架构与 Node 测试：声明/风险、Source 资源 hash/库存与 symlink 拒绝、旧 Viewer Scope、完整资源切换、全局/项目继承和真正 CLI `--scope-only`。
- 真实 official MCP stdio + 独立受控 backend：四工具 surface、范围/参数拒绝、live schema 变更拒绝、受控变更和状态回读、合法检查 FAIL、vision/text-only、完整大响应分页。
- 真实 CLI + 固定 Kimi：使用实际 PCB schema 和完整 Skill，验证审批、拒绝后无受控变更、批准后受控状态与结果回传；后端为受控 fixture，不是原生 CAD 验收。
- 固定的真实 PCB-bench checkout：完整 89-schema 身份对照、会话加载 11 个实际 Skill 文件，宿主未具 controller 权限的执行被原服务拒绝。
- Desktop 构建通过；注册沿用共享 catalog/IPC/UI，无专用第二套资源策略。PCB 专项 Electron UI 实测另行记录，不由共享 catalog 测试推断。
- 当前机器没有上游固定原生镜像，未执行原生 PCB 编辑、ERC/DRC、route、solver、export 或恢复测试。
- 独立 Chip/PCB/Godot CLI 包从其他目录加载通过；PCB 包具有 89 工具、资源禁用项和独立域限制，不包含私有源码或完整 Skill 正文。
- Linux/Windows/macOS 包装后的原生链路和完整 bench 对照未实测；不继承上游环境测试或旧任务资格。

运行 `pnpm test:pcb-mcp` 验证基础配置/协议；设置授权的 `INDUSTRIAL_HARNESS_PCB_BENCH_DIR` 后同时验证真实源码 schema/Skill。
独立原生镜像与真实正/负 candidate 验证是后续工业闭环 gate，不是受控 fixture 的结果。
