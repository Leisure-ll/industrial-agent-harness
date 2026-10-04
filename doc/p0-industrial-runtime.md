# P0 工业运行时与执行边界

状态：2026-10-04 的实际实现与本机 macOS 验证。主仓自有贡献按用户选择采用 MIT；第三方边界见根目录 `THIRD_PARTY_NOTICES.md`。本页不声明完整桌面发行包、其他平台或其他领域已经通过工业验收。

`harness-core.createProjectRuntime` 从仓库注册或验签安装后的 `loadRegistry.runtimePacks` 加载 Pack 声明的 runtime entry。项目不能注入任意入口。领域实现与 Capability ID 留在 Chip Pack；通用 Factory、Broker、Kimi 与 Runtime 不硬编码领域。CLI 与桌面项目运行时缓存消费同一入口。

首条真实路径为：Project → Chip StateProvider（读取 eda.yaml/RTL/testbench 的内容摘要）→ 规范 DomainState → State 驱动 Broker → 固定 Kimi SDK 0.1.8 / CLI 1.51.0 → 宿主 industrial_action_call → Runtime 二次权限检查 → vendored EDA Harness 的 lint/simulate DAG → 真实 Verilator（启用 assertions）→ log/execution report/completion report/VCD → Chip assertion Verifier → 新 DomainState → 持久 Checkpoint。

Action 记录输入内容身份、实际 Verilator 版本、参数、Run/Action ID、诊断、产物与 Verification。Verifier 单独检查真实断言失败、completion marker、原生 verifier 和 VCD 结构。进程成功只决定执行状态；工程接受来自 Verifier。断言失败为 `failed`，编译失败/原生超时/取消/缺少证据为 `insufficient_evidence`。测试覆盖 Verilator `%Error` 与新版本 `%Fatal` 的断言输出。覆盖程度由真实 testbench 定义，不代表设计生产签核。

每次请求需当前 `expectedStateId`。Scope、项目/领域不符或未经批准时，Runtime 保存失败 Action、显式空产物集及不足证据，不启动原生工具。源输入变化保留旧验收、将当前状态置为 `stale`；执行中变化也不得建立当前接受。产物按 SHA-256 保存并再次核验；历史 Checkpoint 链和失败记录可在重开进程后查询。并发 owner 由 SQLite 事务租约拒绝；死亡 owner 的 running Action 恢复为失败。新版数据库被拒绝且不清除其原租约。

macOS 使用真正的 Seatbelt 进程边界：Kimi 及其 Shell/WriteFile/子进程只可写独立 session/scratch，实际 Project 与工业元数据只读。固定 CLI 启动时要求工作目录可写，所以 native cwd 使用稳定的 session `workspace`，其中 `project/` 是只读真实工程的符号链接；Prompt 明确两者含义。工程写入仍由宿主 Runtime 完成。native 历史按稳定 workspace 关联，新的边界版本参与会话兼容键。

遗留 Domain MCP 的修改继承只读边界并可见失败，不能靠 Prompt 放行。尚未形成 Runtime 闭环的领域不自动获得写入能力。外部 MCP host 服务与应用控制插件在真实受保护会话中被明确拒绝，其其他进程/远程副作用尚未纳入工业审计；不能用未经验证的旧功能回避边界。Linux/Windows 工业 Kimi 执行在启动前拒绝，直到存在同等的真实进程边界与对应发行验证。

实际验证入口：

```sh
node --test tests/integration/industrial-core-vertical-slice.test.cjs
node --test packages/agent-kimi/tests/process-sandbox.test.cjs packages/domain-runtime/tests/industrial-recovery.test.cjs
node --test tests/integration/license-materials.test.cjs
```

Core 集成测试使用真正的 CLI/Kimi 和本地确定性模型响应推动调用，随后执行真实 Verilator；不使用外网模型凭据，不将这些受控响应当成模型能力评测。CI 的 mandatory macOS gate 要求固定 CLI/Python 与 Verilator；没有安装不能以跳过替代通过。

安装态 Pack 库存不可变：Python 桥接禁止生成 bytecode/cache，项目产物与 Core SQLite/CAS 放在包外。安装 `.hpack` 后，通过包外 `INDUSTRIAL_HARNESS_EDA_PYTHON` 指向按其 uv.lock 准备的 Python 环境；不能在验签后的 Pack 内创建 `.venv`。源码开发 checkout 的默认 `.venv` 仅用于开发。安装态集成测试实际执行 Verilator 后重新扫描库存、重开 Factory 与读取验收历史。

剩余边界：Runtime 插件属于可信代码，host 执行没有替任意第三方 Pack/恶意 testbench提供完整 OS 沙箱；网络、秘密读取也不在本次写入边界内。当前只接入 RTL 验证，没有授权源码修复 Tool，没有其他领域的规范 Core verifier。主仓与 EDA Harness/demo 自有贡献已获 MIT 授权，但不能替代无授权外部 actor 或第三方二进制的源码/告示义务。三平台发行物和完整第三方依赖 SBOM仍需独立资格验证。
