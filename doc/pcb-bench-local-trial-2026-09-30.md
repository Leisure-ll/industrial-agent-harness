# PCB-bench 本地双题诊断试跑（2026-09-30）

这次使用 PCB-bench 源码 `f64692bcfdd74ac6d95051df1adac598cf21105a` 和 `combined-v36`
开发集的 `d13_usb_protection`、`rf_lc_repair`。输入逐文件对照 `freeze.json` 校验，
模型只收到原题、公开需求和修复题的故障种子；候选目录分开。两题并行时没有 controller
目录锁冲突。任务级别的结果来自只读挂载候选工程、在模型结束后另起进程执行的上游
`tools.acceptance`，并没有把模型的自报状态当作验收。

本机没有 PCB-bench 冻结的 `sha256:fcf2…` 镜像，也无法连接其原生执行机。
模型试跑使用本地临时开发镜像 `sha256:4ba05767…`；提交的
[`Dockerfile.local-dev`](../domain-packs/pcb/Dockerfile.local-dev) 另行重建为
`sha256:b752d152…`，经 KiCad 10.0.6、四个 KiCad 包、Java 25、FreeRouting
SHA-256、89 工具 schema 和真实 MCP `project_status` 验证。两个开发镜像均无上游冻结镜像的
436 项回归凭据，结果是诊断，不是 PCB-bench 正式分数。

| 任务 | 原生过程 | 独立验收 |
| --- | --- | --- |
| `rf_lc_repair` | 先复现 `rf_response` FAIL；通过 MCP 修改、重生原理图后，ERC、DRC、功能分析、原理图/PCB 一致性、`verify_design` 和 `finalize_claims` 均 PASS。`claims.json` 保存，电气总资格仍为 UNKNOWN。 | `cad_prototype` **PASS**；功能仿真 PASS、claims PASS，完整电气与实体资格 UNKNOWN。 |
| `d13_usb_protection` | 经 112 次原生动作生成原理图和四层 PCB，原理图校验 PASS；在试跑窗口结束时仍是部分手工布线，最新 DRC FAIL，未执行最终声明。 | `cad_prototype` **FAIL**：ERC、网络表、一致性、板尺寸与设计需求 PASS；交付板 DRC、原规则 DRC 和验证策略 FAIL，claims 缺失。 |

试跑还定位并验证了以下 Harness 问题：

1. 原题直接提交时，Broker 曾让通用的 `pcb`、`board` 命中压过具体的 KiCad 设计/修复意图，
   只开放只读 Viewer。改为按短语具体性排序并登记通用设计/修复动作短语后，原始两题均直接获得
   `pcb.bench.operate` 和 89 个工具；无需改写原题。
2. Kimi 的宿主 Shell 可绕过 Domain Runtime。首次设计试跑中，它直接改写
   `board.kicad_sch`，下一次原生校验报 `Failed to load schematic`。这轮因此作废。
   后续设计对照仅用本机 `sandbox-exec` 临时禁止宿主进程写候选 CAD 文件，Docker 内的
   原生控制器仍可写。**仓库内尚未提供等效的正式 Agent 沙箱**，也不能据此宣称 benchmark 隔离达标。
3. 当前模型把嵌套工具参数里的布尔值传成字符串、数组传成对象，导致 `finalize_claims`
   在网关 schema 校验处反复失败。新增互斥的 `argumentsJson` 严格 JSON 对象入口后，
   真模型成功提交了布尔值和数组；服务端仍按原生 schema、Broker Scope 校验。
4. 续跑时 Broker 选到 `pcb.bench.verification`，它原先漏了最终声明工具，实际请求被
   `Tool is outside the current Broker scope` 拒绝。将 `finalize_claims` 加入验证能力后，
   同一候选工程完成声明。首次 amd64 镜像冷启动也超过网关原 45 秒读取等待；启动等待现独立设置为
   120 秒，单次动作超时策略未改变。

设计题最后的 DRC 失败不是缺少 KiCad、原生工具或布线后端：开发镜像包含固定 FreeRouting，
但该模型在窗口内选择了手工 `add_track`，留下与其他网络焊盘形成的阻焊桥接及器件
Courtyard 重叠。下一步应先建立正式的宿主文件隔离，再比较模型是否会选用已有自动布线工具、
以及失败后的布局修正策略；不应根据这次诊断增加题目专用工具或声称完整电路资格。
