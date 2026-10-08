# 模型 API 与思考参数兼容

2026-10-08。Agent 内核固定为 Kimi Code 2.1.1；模型服务的 API 协议与 Agent 产品是两个独立选择。

## 本次故障与修复

本地失败记录 `dc215536` 使用 MiniMax-M3，却将 `https://api.minimaxi.com/v1` 配置为 Kimi API。上游据此发送 Moonshot 的 `thinking.type = enabled`，服务端返回 400；这不是 Godot 工具调用失败。MiniMax 官方 [Chat Completions 文档](https://platform.minimax.cn/docs/api-reference/text-openai-api) 将 M3 的开关声明为 `adaptive`／`disabled`，省略时默认开启。

共享 `agent-kimi/model-config.cjs` 对官方 MiniMax 主机、`/v1` 路径和 MiniMax 模型组合解析为 OpenAI-compatible；已有配置读取和新设置保存均生效，地址、模型、密钥和历史不变。其他网关及 API 路径保留显式选择，避免仅凭模型名称修改第三方协议。设置中的“服务商”改为“API 格式”，Kimi 项明确为 Moonshot API。

Kimi 协议保留原有 `high`／`off`；通用 Chat Completions 的启用请求使用上游 `on`，第一轮由服务默认决定思考档位。该选择同时写入原生 `[thinking].effort` 和公开 prompt API，供原生子任务、后续回答及压缩路径继承。Harness 不重写模型请求、思考历史或上游 Agent 策略。上游在重放通用接口的思考历史时可能自行补 `reasoning_effort = medium`；这仍是原生行为。

## 参考 OpenCode

研究基线为 OpenCode `dev` commit `5d9cd9b259f0456522f318a7435501d03cfbee79`，参考其 [ProviderTransform](https://github.com/anomalyco/opencode/blob/5d9cd9b259f0456522f318a7435501d03cfbee79/packages/opencode/src/provider/transform.ts)、[对应测试](https://github.com/anomalyco/opencode/blob/5d9cd9b259f0456522f318a7435501d03cfbee79/packages/opencode/test/provider/transform.test.ts) 和 [模型 variants 文档](https://opencode.ai/v2/docs/models)。未复制其代码或引入它的 Agent。

它将模型元数据中的 `reasoning_options` 区分为开关、effort 和 token 预算，再依据实际 API SDK、模型及服务商转换参数。模型级选项和选中的 variant 可覆盖服务商默认。其 MiniMax 测试单独检查 Anthropic SDK 的 `adaptive` 与 OpenAI-compatible 的省略默认；同一模型经不同网关也可能有不同字段。由此不能把通用 `thinking: true` 或 `high` 直接发给所有服务。

后续适配应保留三个层次：

1. 连接协议：决定请求路径、格式、认证及流式解析。
2. 已验证模型能力：区分可关闭、档位、预算或强制思考，记录服务商与模型组合的来源；未知网关保留显式配置。
3. 用户选择：只提供当前组合确实支持的模式和档位，在请求发出前检查，不在 400 后自动重试或重放任务。

## 当前支持边界

本次完成协议错误修复和默认档位传递，不等同于所有厂商的思考开关已适配。固定 Kimi 公开 API 的通用 Chat Completions 路径提供原生 effort 配置，没有任意厂商请求体覆盖入口。`off` 在缺少模型 `off_effort` 元数据时不会发送关闭字段；本次 MiniMax 实测 `reasoning_effort = none` 仍返回思考内容，不能用它伪装为成功关闭。

MiniMax 的强制关闭、DeepSeek 的专用开关、Qwen 的 `enable_thinking`、Anthropic 的预算等需各自核验并通过原生支持的协议或后续正式扩展接入。当前不承诺这些行为，不通过改写上游源码补字段。模型能力目录、GUI 档位选择和厂商参数扩展尚未实现；引入请求适配桥或升级内核前，应单独记录集成缺口与架构决定。

## 验证

- Desktop 模型配置单测：旧 MiniMax 配置修复、保存、官方主机边界、仿冒主机／自定义网关保留、密钥不落配置、原有 Kimi 模式。
- `packages/agent-kimi/tests/thinking-wire.test.cjs`：真实固定 Kimi runtime 与本地受控 HTTP 服务，检查旧 MiniMax 组合、通用默认、Kimi 开／关及两轮包含思考历史的请求；不是远程模型质量测试。
- 本机同一 MiniMax 地址和已有凭据：错误 Kimi 参数复现 400；正确配置通过原生会话得到 `OK`。只发送合成短文本，未发送工程文件；凭据不输出、不提交、不更换。

Mac 上的接口烟测不能证明其他厂商或其不同网关已经兼容。
