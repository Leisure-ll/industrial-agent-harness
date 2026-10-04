# Domain runtime

Owns deterministic domain execution, run state, evidence, and artifact provenance. It must not depend on Electron, Kimi, or the MCP transport.

当前已实现 `ObservedContextStore`：CLI 与桌面端按 Project/Domain 在用户数据目录保存 SQLite 工件文件观察与最小 Checkpoint。每次提供给模型前重新核对文件路径与 SHA-256；历史 Checkpoint 仍可分页读取。记录明确标为 `verificationStatus: not_run`，不能代表工程通过。

`ActionJournal` 为已有原生工具调用保存 Run/Action 身份、实际输入、诊断及显式工件集合。它继续保持 `not_run`；仅有进程退出不能建立工程验收。

`IndustrialRuntime` 提供 schemaVersion `1` 的持久 Project、DomainState、Run、Action、Artifact、Verification 与 Checkpoint。注入的 Pack StateProvider 读取实际输入摘要；`execute({toolId,inputs,expectedStateId},{scope,approval})` 在执行边界重查项目、领域、Broker 范围、当前 State 与审批。结果包括 `{run,action,artifacts,verification,state,checkpoint}`，CLI/Desktop 使用同一 Factory/Runtime。拒绝、失败与中断均保留诊断、显式产物集和不足证据结果。

SQLite 原子提交规范记录与 State/Checkpoint head；产物进入 SHA-256 内容存储，读取再次验证。输入变化使当前 State 失效为 `stale`，历史验收和产物仍可查询；不修改过去的事实。一个项目同时只能由一个 Runtime 拥有；存活租约拒绝重开，死亡租约将未完成 Action 恢复为失败。`cancel()` 请求 Pack 原生取消，`waitForIdle()` 等待其实际清理，不能通过杀死模型进程假定工业工具也已停止。

已行使的首条闭环是 Chip Pack 的 RTL lint/Verilator assertion simulation、真实 VCD、独立证据检查以及重启恢复。每个 Tool 当前要求一个汇总 Verifier，避免忽略其他验证器。其他领域仍使用各自已有运行时，不因此成为规范 Core 闭环。原生工具/容器清理由现有 EDA Runtime 负责。实际支持和限制见 [P0 工业运行时](../../doc/p0-industrial-runtime.md) 与 [安全边界](../../SECURITY.md)。

Runtime Tool 可携带输入指南，通过受 Scope 约束的 `describeTool` 按需披露；这属于工具文档，不生成工业事实。FreeCAD 原生 Pack 复用执行、产物、回读验证与持久化路径，见 [FreeCAD 接入](../../doc/freecad-domain-pack.md)。
