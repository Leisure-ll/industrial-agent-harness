# Headless v0.2.0-preview.3

2026-09-29 · 在 preview.2 分包基础上，增加 **Desktop / CLI 共用的外部 MCP 注册层**。下载 Chip、PCB 或 Godot 包后，可以继续接入已安装的 computer-use 等通用服务。

## 下载哪个包

四个归档分别为 `industrial-agent-harness-cli-chip-headless-v0.2.0-preview.3.tar.gz`、`industrial-agent-harness-cli-pcb-headless-v0.2.0-preview.3.tar.gz`、`industrial-agent-harness-cli-godot-headless-v0.2.0-preview.3.tar.gz` 和 `industrial-agent-harness-headless-headless-v0.2.0-preview.3.tar.gz`，各有同名 `.sha256`。三个领域包绑定各自 Domain，多领域包运行需 `--domain`。保留整个解压目录；Node manifest 与 `HARNESS-PACKAGE.json` 可在 macOS 同时存在。

需要 Node.js **22.13+**。Agent 另需 Kimi CLI **1.51.0** 和模型 API 凭据；Chip 内置 EDA MCP 另需 Python **3.13** 的固定依赖。安装步骤见 [分包文档](https://github.com/Zhiman-BJ/industrial-agent-harness/blob/headless-v0.2.0-preview.3/doc/domain-cli-downloads.md)。

## 安装和首次运行

```sh
shasum -a 256 -c industrial-agent-harness-cli-chip-headless-v0.2.0-preview.3.tar.gz.sha256
tar -xzf industrial-agent-harness-cli-chip-headless-v0.2.0-preview.3.tar.gz
cd headless-chip
node industrial-harness.cjs run --project-dir /absolute/project --task '检查工程状态' --scope-only
node industrial-harness.cjs mcp add --file /absolute/path/mcp.json
node industrial-harness.cjs mcp list
```

Linux 可用 `sha256sum -c`。`mcp.json` 使用标准 `mcpServers`，例如 `{"mcpServers":{"computer-use":{"command":"/absolute/path/to/installed-mcp-server","args":[]}}}`，请替换实际服务命令。也支持 HTTP URL、旧 SSE、envRefs/headerEnv 凭据引用。添加时启动并检查所选服务；失败不保存。`mcp refresh / remove` 管理快照，`mcp disable external.computer-use --project-dir DIR` 控制项目启用。

截图使用视觉模型并指定 `run --image-input`。真实 Agent 运行默认拒绝待审批操作；选择 `--approval approve` 会自动批准这一轮的全部待审批调用。服务安装与 OS 屏幕录制/辅助功能权限需要另行准备。

## 相比原生 Kimi Code 集成了什么

- **共享外部 MCP 注册**：Desktop 全局设置与所有领域 CLI 包使用同一私有注册和资源策略；支持本地 stdio、Streamable HTTP、旧 SSE，公共列表不返回启动参数或凭据。
- **渐进披露与执行检查**：外部 Gateway 固定四个入口，按需发现和单项 schema；实际调用前重查 Scope、参数与当前工具快照，变化要求刷新。服务/配置/引用环境变化后，下一轮开启兼容的新 Kimi 会话段并保留聊天历史。
- **审批、截图与分页**：实际外部调用保守标为 mutating，服务的只读提示不能免审批；原生图片进入 Kimi 模型，长文字私有缓存分页，已知外部凭据在文字结果、缓存与诊断 JSONL 中脱敏。失败/超时不自动重发操作。
- **已有领域能力**：保持 Chip 的固定 EDA Harness 0.6.0 源码、25 工具映射、共享 Domain Gateway 和 Skill；PCB 保持检查 Skill，Godot 保持普通项目任务。四种 CLI 包均不依赖 Electron。

Agent Loop、原生上下文、压缩、审批与模型 Provider 继续由固定 Kimi Code 提供，Harness 不增加另一个模型客户端。

## 验证范围

macOS 已运行单元测试、架构检查与桌面构建；实际 stdio/HTTP/SSE Gateway 检查 Scope/参数拒绝、工具变化拒绝、图片、分页、脱敏和配置失败。固定 Kimi SDK **0.1.8** / CLI **1.51.0** 验证批准后的 host 修改、拒绝后无修改，以及 MCP 图片进入实际模型请求。Electron 自测验证表单添加、CLI 共享读取、项目禁用、审批、运行中禁止修改、刷新和移除。

发布流程在 Linux 重跑单元/架构与实际协议测试，验证三个解压包的共享注册，并对解压 Chip 包运行固定 Kimi 的真实外部 MCP 和 EDA MCP 测试，通过后才上传归档。模型响应及 computer-use 服务是受控 fixture，没有使用真实供应商服务或进行芯片 signoff；没有 Windows 发行包验收。

## 尚未集成

- 不自动安装外部服务、发起 OAuth 登录或申请系统控制权限。通用 MCP 协议接通不代表任意 computer-use 供应商均已逐一验收。
- 外部 host 服务可操作项目之外的应用，MCP roots 只提供上下文。返回保持 `not_run`，不写工业状态或证明工程验收。
- PCB 工业 MCP、KiCad 镜像/DRC/ERC 与 Godot MCP/引擎未接入。
- 包内不含 Kimi CLI、Python 环境、模型凭据、工业镜像或桌面 Viewer。完整 Core 工业闭环仍未完成。
- preview.2 及更早归档不会自动获得本次入口；请下载此版。

[外部 MCP 配置与边界](https://github.com/Zhiman-BJ/industrial-agent-harness/blob/headless-v0.2.0-preview.3/doc/external-mcp.md) · [Chip MCP](https://github.com/Zhiman-BJ/industrial-agent-harness/blob/headless-v0.2.0-preview.3/doc/domain-mcp-integration.md)
