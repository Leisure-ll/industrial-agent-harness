# Kimi 子 agent 兼容性与 GUI 接入审计

日期：2026-10-05。状态：**原生兼容性审计、事件/生命周期适配和首版 Desktop GUI 已实现；macOS 桌面真实并行分析与规划已验证**。

接入前基线为 Harness `21a4221`（Viewer 布局修复分支）；本次实现叠加于该提交，保留既有 Viewer/资源筛选修复。Kimi CLI 和 SDK 源码均未修改。此前[原生兼容性审计](kimi-native-compatibility-audit.md)中对子 agent 的“仅源码核对”结论，以下列实测范围为补充。

## 结论与版本边界

沿用 Kimi 的任务派发、独立上下文、调度、续接、审批与持久化；Harness 增加事件适配、生命周期观察和 GUI 呈现。前台显示和后台审批缺口已通过下述适配补齐；工业工具继承仍有明确边界，不能把“加一张任务卡”视为完整兼容。

当前产品固定使用 **Python `kimi-cli 1.51.0` + Node `@moonshot-ai/kimi-agent-sdk 0.1.8`**。已安装 CLI 的构建标识为 `github.com/MoonshotAI/kimi-cli@5c7db06c24a1`。本次未升级这两项依赖。

官方[旧仓库](https://github.com/MoonshotAI/kimi-cli)目前已归档，推荐迁移到新的 [Kimi Code CLI](https://github.com/MoonshotAI/kimi-code)。新版的[子 agent 文档](https://moonshotai.github.io/kimi-code/en/customization/agents)继续采用主 agent 派发、独立上下文和摘要回传，并新增 Markdown agent 定义等能力。这些新功能、配置路径和存储格式不能直接套用到已安装的旧版。内核迁移应单独验证 SDK/Wire、模型配置、历史恢复、工具注入和工业隔离，见[官方迁移说明](https://moonshotai.github.io/kimi-code/en/guides/migration)。

## 当前原生策略（1.51.0）

| 机制 | 实际行为 | Harness 接入原则 |
| --- | --- | --- |
| `coder` | 通用编程；原生文件读写、Shell、搜索等工具 | 展示其真实任务和操作；工业工程写入仍服从 Runtime 边界 |
| `explore` | 探索和分析；无文件写工具，Shell 的只读要求也写在原生提示中 | 保留原生角色；操作系统隔离继续作为工程写入边界 |
| `plan` | 规划；没有 Shell 和文件写工具 | 展示规划任务及摘要 |
| 派发 | 主 agent 调用 `Agent`，选择类型、任务提示、模型别名、前后台模式、可选超时 | GUI 不自行选择或调度 agent |
| 上下文 | 子 agent 拥有独立历史，接收父 agent 显式传入的任务；父 agent 接收最终摘要 | 子 agent 的文本、思考和工具记录保持独立，不混入主回答 |
| 并行与递归 | 可并行执行；内置子 agent 不允许再派发子 agent | 按原生身份与调用 ID 分组，保留现有深度约束 |
| 续接 | `Agent(resume=agent_id)` 使用原生保存的上下文 | GUI 使用原生 ID；不会另造子会话或复制历史 |
| 后台 | 原生 `TaskList`、`TaskOutput`、`TaskStop` 与通知负责管理；主对话结束不代表任务结束 | 任务状态跨主对话轮次观察，控制接回原生接口 |
| 模型 | 显式模型别名优先，其次类型默认模型，再继承父 agent 模型 | 显示实际可得的模型信息；当前 Harness 私有配置只声明一个模型别名 |
| 工作目录 | 与父 agent 共享文件环境，不自动产生独立 Git worktree 或独立 OS 沙箱 | 保留已有隔离；并行修改的冲突不能靠 GUI 消除 |

源路径（均为已安装的原生版本）：`agents/default/{agent,coder,explore,plan}.yaml`、`tools/agent/__init__.py`、`soul/agent.py:Runtime.copy_for_subagent`、`subagents/{builder,runner,store}.py`、`background/{agent_runner,manager,models}.py`。

## 接入前实测基线（历史）

在 macOS arm64 上运行真实的已安装 Kimi CLI，通过固定 SDK 分别直接调用和经 Harness 受保护进程调用。本地模型协议服务返回确定的工具调用，工程为临时文件。**这不是在线模型推理、真实工业任务验收或 GUI 已跑通的证明。**

两组前台探针加十组生命周期探针，均完成断言。报告和可复跑脚本位于 [审计证据目录](evidence/kimi-subagent-2026-10-05/)，运行方法见下文。

| 对照场景 | 结果 |
| --- | --- |
| 三种内置类型读取文件、摘要回传、上下文隔离、续接首个实例 | 两边都完成；父 agent 独有的任务标记未进入子上下文，续接请求保留已读文件内容 |
| 前台过程事件 | 两边各收到 52 条 `SubagentEvent`；SDK 保留 `agent_id`、`subagent_type`、`parent_tool_call_id`。Harness 输出给 GUI 的子 agent 事件数量为 **0** |
| 同轮并行派发两个子任务 | 两边都完成，两个子 agent 的类型与身份可区分 |
| 拒绝子 agent 的 Shell 审批 | 两边均能拒绝；子任务得到拒绝结果并回传摘要。SDK 中审批的子 agent 身份字段缺失 |
| 停止正在运行的前台子任务 | 两边均返回 `cancelled`，原生子 agent 记录为 `killed` |
| 主对话先完成，后台子任务继续运行 | 两边在主对话结束时都仍为 `running_background`，稍后完成；本轮 SDK 子 agent 过程事件为 **0** |
| 主对话结束后，后台子任务请求 Shell 审批 | 两边原生任务都进入 `awaiting_approval`，但当前 SDK 轮次迭代器没有收到审批，Harness 也未展示审批 |
| 父子工具集 | 父 agent 具有审计用外部工具；子 agent 没有继承该工具。Harness 的 `industrial_capability_detail` 同样只出现在父 agent 工具集中 |

报告不含用户工程、真实凭据、在线模型响应或原生完整会话；只保留受控用例的计数和断言结果。原生状态 `idle` 表示实例可续接；单次任务“完成”应来自调用结果或后台 task 状态，不能直接把 `idle` 当作永久完成。

## 接入前兼容性缺口（历史）

1. **前台事件未展示。** `packages/agent-kimi/src/index.cjs:emitEvent` 没有处理 `SubagentEvent`，诊断日志保留了原始 SDK 事件，Desktop `AgentFlow` 与展示事件契约也没有子任务类型。适配时每个子 agent 需要独立的工具参数累积状态，避免并行流混串。SDK 的该事件 schema 使用 `passthrough()`，身份信息已经保留，TypeScript 的旧声明没有完整列出它。
2. **后台观察与审批通道不完整。** 原生前台 runner 包装过程事件；后台 runner 主要写自己的 output/wire 文件。SDK 0.1.8 的 `sendPrompt` 结束后清除事件接收回调，所以后台审批实际生成后仍无法通过已结束的轮次接收。审批 schema 还会丢弃原生 `agent_id` / `source_kind` 等字段；Harness 的 `approve` 只接受仍存在 `this.turn` 的审批。需要先选定有后台能力的 SDK/原生协议接入路径，而不是轮询文件后伪造审批，或通过额外用户 prompt 假装主对话仍在运行。
3. **空闲回收只观察主任务。** Harness `isBusy` 当前检查主轮次、审批与提问，没有纳入原生后台任务。源码已确认遗漏；本次没有执行资源回收时的故障试验。GUI 接入前需以原生任务状态保护会话租约，覆盖回收、切换 Scope、关闭及重启行为，避免后台任务被当作空闲资源。回收时取消后台子 agent 的具体行为仍需单独实测。
4. **工业工具不会自动继承。** 1.51.0 的子 agent builder 重新构建工具集，并传入 `mcp_configs=[]`；Wire `external_tools` 注册到根 agent。外部工具未继承已实测；Domain MCP 未继承为源码核对结论，本次未连真实 MCP 服务。首版可展示探索、规划和分析任务，由父 agent 执行 Runtime 工业动作。若要求子 agent 自行调用工业 Runtime，需要独立的最小工具桥接方案，仍由 Broker/Runtime 逐次检查 Scope、State 和审批。

这些缺口应落在 Kimi 接入层和 Harness 生命周期观察中；不重建原生 agent 循环、调度、上下文或 task store。只读观察文件必须绑定本聊天的原生 session 段，并限制路径、大小和读取量；绝不能把这些调试记录升级成工业验收事实。

## 首版 GUI（已实现）

- 在主对话的 `Agent` 调用位置展示一张可折叠子任务卡：任务名、角色、前后台模式和实际状态。
- 多个任务在同一轮对话中逐项排列，展开后查看该子任务的思考、工具及最终摘要；完成后默认折叠。
- 待审批操作始终可见，标明所属子任务；不要藏在折叠区域中。后台运行、等待审批、失败和取消必须分别呈现。
- GUI 展示与控制使用原生 agent/task/call ID。停止、续接、超时和恢复沿用原生行为；在接口验证前不添加看似可用的控制按钮。

首版沿用原生 `Agent`、`TaskList`、`TaskOutput`、`TaskStop` 和 `resume`。没有新增调度器、子 agent 编辑器或 GUI 专属停止/续接协议。内置子 agent 按原生定义不向最终用户提问，歧义交给父 agent 的摘要处理。

回归覆盖前台/并行/后台、审批同意与拒绝、停止与超时、续接与重启恢复、Scope 变化、资源回收、长输出与事件交错，以及 UI 折叠和待审批可见性。原生子任务 Shell 写入真实工程已验证为拒绝；父 agent 的 Runtime 修改沿用已有工业路径，本次在线子任务验收不执行修改或声称工程验收通过。

## 已落实的接入路径与边界

- 前台 `SubagentEvent` 按 native agent/call 和 Harness turn 身份转换为独立显示事件。参数缓冲按子任务分开；原生补充摘要轮次保留文本分段，不与主回答合并。
- SDK 0.1.8 没有持续后台事件订阅，审批 schema 还丢失来源字段。新增宿主 stdio 观察桥，只观察原生审批消息并使用其真实 RPC/request ID 回送决定。SDK 与 CLI 的循环、工具、配置、调度和上下文均保持原有实现；详见 [ADR-007](decisions.md#adr-007原生子-agent-加显示与审批观察适配)。
- 后台状态与过程从本聊天的原生 task/subagent 文件只读观察；不写 context、task/control 或工业事实。检查真实路径、链接、inode 与元数据大小。每次扫描最多 128 个目录项/每文件 128 KiB，保留扫描游标及活动任务，尚未扫描完的记录也保护会话回收。
- 单次子任务过程显示限制为 128 KiB/2048 个事件；单个工具正文最多 12000 字符。超限显示说明，完整原生记录保留。常驻显示索引最多 256 个调用，优先释放已结束索引；历史仍在 ChatStore 和原生会话中。图片数据不进入子任务展示或诊断日志。
- 子任务状态更新和审批归属原来的对话轮次。原生后台任务保护空闲回收；同 Scope 可继续主对话，工具范围/模型/项目资源变更和删除等待相关后台任务结束。关闭应用会结束原生进程，不承诺后台任务脱离应用继续执行；恢复沿用原生保存的上下文与终态，不自行重新执行任务。
- 观察桥的私有 socket 与令牌在受保护进程外。macOS 禁止原生进程读取该目录或连接该 socket；Linux 保留已有 AF_UNIX 限制。连接丢失时任务显示中断、审批失效，后续轮次重建原生连接。
- 子 agent 首版没有继承 Harness 外部 Runtime 工具或 Domain MCP，也不提供独立 worktree。探索/规划/分析由原生子 agent 完成，实际工程修改由父 agent 通过 Broker/Runtime 执行。原生 Shell/文件工具不能写真实工程。
- CLI 可输出同样的子任务显示事件；单次命令仍在主回合结束后关闭会话，后台任务在该命令退出后不会继续执行。持续后台交互验收针对 Desktop。

## 本次实现验证

macOS arm64 上已执行固定真实 CLI 的并行三角色、上下文隔离、跨轮次续接、后台审批同意/前台拒绝、停止、30 秒原生超时、工程写入拒绝、空闲回收保护及完成后台任务的会话重开。正式测试在 `packages/agent-kimi/tests/subagents-wire.test.cjs`；长输出、交错片段、UTF-8 部分写入、损坏记录和超过一次扫描量的任务覆盖在 `subagent-display.test.cjs`。这些测试使用受控本地模型响应，证明协议与隔离行为，不代表模型任务成功率。

Desktop `test:subagents` 使用真实 CLI、真实 Renderer/IPC/ChatStore 路径，验证三角色默认折叠、展开 ReadFile 输入/结果、主回合结束后的后台审批按钮、批准后完成以及刷新后历史恢复。截图位于 `dist/subagent-selftest/`。该检查已加入 macOS 原生 CI；原生回归同时加入 macOS/Linux x86-64 CI 测试目录。Linux 的新增路径和 Windows 工业执行本次未实测；Windows 工业执行仍不可用。

```sh
KIMI_EXECUTABLE=/absolute/path/to/kimi node --test packages/agent-kimi/tests/subagents-wire.test.cjs
KIMI_EXECUTABLE=/absolute/path/to/kimi pnpm --filter @industrial-agent-harness/desktop test:subagents
pnpm test:architecture
pnpm run test:ci -- portable
```

### 在线模型与真实工程（macOS Desktop）

正常本地应用使用用户已有的 `openai_legacy` / `Minimax-M3` 配置，在真实带筋轴承座工程中通过 GUI 提交只读任务。主 agent 原生并行派发 `explore`「核对尺寸与文件依据」与 `plan`「规划 36→40 mm 改动方案」；两者开始时间相隔约 0.11 秒、运行区间重叠，均已完成，主 agent 等待后汇总。任务卡、工具与审批保留在实际应用聊天中，不是受控模型截图。脱敏计数与结果见 [在线桌面证据](evidence/kimi-subagent-2026-10-05/live-desktop.json)。

核对涉及配方、设计输入、已有 readback、草图与产物哈希。三份关键输入（配方、FCStd、design-input）任务前后 SHA256 均未变化；没有调用工业 Action，也没有构建、编辑或导出。已有回读只提供整体包围盒、体积和实体数，缺少逐特征座孔直径断言；这证明回读覆盖不足，不能据此宣称实际尺寸错误。规划中的体积估计、薄壁或加工判断仍是模型建议，不是工程验收事实。

探索任务的大量文件内容触发 128 KiB 过程显示上限；任务仍正常完成，卡片标明缩短，完整记录保留在原生会话中。主回答中该模型返回的字面 `<think>` 文本沿用现有文本展示；SDK 原生 `think` 事件才按思考组件折叠。本次没有改写模型内容或 Kimi 推理策略。耗时包含系统锁屏和人工审批等待，不作为速度或模型任务成功率基准。

## 复跑接入前审计

旧脚本属于历史审计探针，不作为 CI 门禁；部分探针专门观察旧 SDK 缺口，不能据此要求新产品保持旧缺陷。目标行为已另写为上方正式原生与 Desktop 回归测试。历史证据目录不覆盖。

传入已有依赖的开发 checkout 和已安装的 CLI 1.51.0 可执行文件：

```sh
node scripts/audits/kimi-subagent-baseline.cjs /path/to/harness-checkout /path/to/kimi
node scripts/audits/kimi-subagent-lifecycle.cjs /path/to/harness-checkout /path/to/kimi
```

探针仅写临时工程、临时模型配置和报告，不读取用户 API Key，也不改变正在运行的桌面会话。第二个脚本可加 `parallel`、`reject`、`cancel`、`background-idle` 或 `background-approval`，单独复跑某个场景。SDK/CLI 版本不同的结果不能算入这份基线。
