# Contracts

Shared types and schemas for project identity, agent events, domain runs, artifacts, capabilities, and errors. Keep contracts independent of UI and runtime implementations.

当前有工件文件观察、观察状态、最小 Checkpoint、原生 Action 记录与 VerificationResult 的 Zod schema。文件状态只说明路径和内容哈希已核对；原生 Action 的 `not_run` 表示尚未进行工程验证。完整 Run、真实工程 Verifier 与领域 State 契约仍需在 Industrial Core Vertical Slice 中补齐。
