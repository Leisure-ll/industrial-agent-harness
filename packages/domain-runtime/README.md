# Domain runtime

Owns deterministic domain execution, run state, evidence, and artifact provenance. It must not depend on Electron, Kimi, or the MCP transport.

当前已实现 `ObservedContextStore`：CLI 与桌面端按 Project/Domain 在用户数据目录保存 SQLite 工件文件观察与最小 Checkpoint。每次提供给模型前重新核对文件路径与 SHA-256；历史 Checkpoint 仍可分页读取。记录明确标为 `verificationStatus: not_run`，不能代表工程通过。

`ActionJournal` 为原生工具调用先写入 Run/Action 身份、实际输入和运行状态，再持久记录结果、诊断、显式工件集合及 `VerificationResult`。Godot Gateway 的原生操作经过这条路径；进程成功仍保持 `not_run`，不宣称工程验收。StateProvider、领域 Verifier 与完整工业状态闭环仍未实现；本模块目前不是完整 Domain Runtime。
