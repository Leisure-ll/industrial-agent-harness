# 所有领域共用的工程底座

空目录、没有专业 Runtime 的领域和已有专业工程都使用同一组共享 Tools。
Core 不内置综合、SPICE、特定 ISA、SRAM/MPW 生成器或供应商签核流程；这些软件、
模型、参考资料与配方由环境、工程和领域 Skill 提供。基础执行不再依赖先有 eda.yaml。

| Tool | 实际行为 |
| --- | --- |
| project.initialize | 创建 harness.project.json 和缺失的空 harness.tasks.json，不覆盖现有文件，不猜工程阶段 |
| project.files.read | 文件清单及哈希，或一个 UTF-8 文件与 SHA-256；结果以内容绑定回执读取 |
| project.files.apply | 创建、修改、删除与最多 32 个文件的批次；修改/删除必须匹配原 SHA-256，创建必须仍不存在 |
| project.tasks.inspect | 读取声明任务，格式错误也可查看并修复 |
| project.task.run | 按名称执行 harness.tasks.json 中的任务，不接受临时命令替换；保留日志、执行身份与检查证据 |

模型通过共享 project.work Skill 执行“创建→测试→读失败→修改→重跑”。所有调用走同一
industrial_action_call，带当前 State ID；Action 后更新 Scope，已创建的专业配置可进入
领域 StateProvider。工具细节通过 industrial_tool_describe 按需加载；报告内容通过
industrial_artifact_read 分页读取，单页最多 64 KiB。

## 任务落地

在工程中创建 harness.tasks.json：

```json
{
  "schemaVersion": "1",
  "tasks": {
    "test": {
      "command": ["python3", "{input}/tests/check.py"],
      "inputs": ["src/design.py", "tests/check.py"],
      "outputs": [{"path": "result.txt", "kind": "report.result"}],
      "runtime": {"kind": "local"},
      "timeoutMs": 60000,
      "verification": {"kind": "checks-json", "path": "checks.json"}
    }
  }
}
```

command 是参数数组，未经 Shell 拼接；inputs 是精确文件名。输入复制到只读快照，
任务 cwd 是全新输出目录；{input}/{output} 参数及 HARNESS_INPUT_DIR/HARNESS_OUTPUT_DIR
给出两者路径。项目相对导入从输入快照读取，依赖需要事先安装或列为输入文件。
生成的文件保留在 `.harness-runs/<action-id>/work/`，日志和回执进入 Runtime CAS。
不同 Action 不复用输出，不能复用上次的检查报告。

检查脚本实际计算后写 checks.json：

```json
{"schemaVersion":"1","checks":[{"name":"required result matches reference","passed":true}]}
```

检查名字必须唯一，至少一项；所有检查通过、进程成功且所声明输出存在才通过。
没有 verifier 的任务是 not_run；报告缺失/格式错误/超时/取消是 insufficient_evidence；
有效检查失败是 failed。这里验收的是所声明断言，不能据此宣称领域签核或完整芯片交付。

## 边界与历史

文件回执记录修改前后哈希；批次先检查全部前提，拒绝 .git、.harness-runs、领域包声明的证据目录、
依赖目录、Runtime 存储、symlink 和 hard link。文本单文件最多 256 KiB；SDK JSON
调用输入总量也有 256 KiB 上限。源文件修改不生成工程通过：当前验收变 stale，
过去的状态、报告、产物和 Checkpoint 保留。

工作区输入扫描最多 10,000 项、32 层、单文件 64 MiB、总计 256 MiB，排除 Runtime
产物和依赖目录。命令只能写该 Action 的输出目录；原工程、输入快照和 Runtime
证据只读。模型的 native Shell/WriteFile 仍受原有隔离限制。未匹配或读取失败的领域
StateProvider 不建立可信阶段，共享编辑入口仍可用于修复配置。

本地任务支持已验证的 macOS arm64 Seatbelt 与 Linux x86-64 bubblewrap/seccomp，
禁止网络和宿主 socket，提供超时、有限日志与输出；不宣称本地 CPU/内存/PID 配额。
Docker 任务把 runtime 改为 `{"kind":"docker","image":"installed-image:tag"}`，
可声明 cpus/memoryMb/pids。宿主需有 Docker 权限和预装镜像，Runtime 先检查真实
image ID，再以该 ID 执行；network none、cap drop、no-new-privileges、只读输入/
容器根目录、调用者 UID/GID 和资源限制生效。Windows 的真实 Agent/任务执行仍
未资格验证，契约/文件测试通过不代表 Windows 执行支持。

## 外部 MCP 与回归

打包 CLI 提供 mcp add/list/refresh/remove 和 enable/disable/inherit。显式注册的
stdio/HTTP/SSE 服务通过宿主 Runtime 调用，重查审批、Scope、参数和快照，保存
report.external。结果仍是未验收观察，不替换工程通过状态；不自动重试未知副作用。
可信宿主服务可以影响项目外部，MCP roots 是上下文。图片和分页限制见
[外部 MCP](external-mcp.md)。历史 preview.3 安装包不会自动获得新源码功能。

Portable CI 覆盖契约、文件前提/越界/历史和三个真实 MCP transport。原生 CI 强制
真实 pinned Kimi + CLI 跑 Chip/PCB 相同的空工程→通过→破坏→失败→修复→通过。
独立分包和 Linux 安装消费者重复该真实链路，外部 MCP 测审批拒绝/批准、图片、
禁用、快照变化及脱敏；Linux Docker gate 另用实际镜像跑共享任务。受控模型用来
稳定触发真实工具链，不作为模型设计能力或任意领域工程签核的证据。
