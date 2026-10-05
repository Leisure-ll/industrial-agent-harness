# Agent 聊天 UI 来源

2026-10-04，仓库所有者明确将本仓使用的 EDA Harness demo 自有代码按 MIT 授权，包括下述改编组件和自有示例源码。授权文本见根目录 `LICENSE`；其中第三方组件继续遵守各自原许可。本次记录与文件补齐发生在 Industrial Agent Harness，未修改或发布私有上游仓库。

实时 Agent 聊天区参考 [`Zhiman-BJ/eda-harness-demo`](https://github.com/Zhiman-BJ/eda-harness-demo) 中 `src/features/replay/ThinkingPreview.tsx`、`PlanTodo.tsx` 和 `ToolPreview.tsx` 的呈现方式。当前代码在 `apps/desktop/src/components/` 下，接收 `@moonshot-ai/kimi-agent-sdk@0.1.8` 的实时事件；没有引入轨迹回放引擎。

`ThinkingPreview.tsx` 和 `TodoList.tsx` 改编了对应组件的交互。工具、审批和状态在 `AgentFlow.tsx` 中通过实时事件展示。上游 demo 的模型配置是针对回放与 Live Agent 的已有流程；本项目的 `ModelSettings.tsx` 独立接入 Electron 设置与 Kimi CLI 配置。

2026-10-05 根据实际轴承座聊天反馈补充通用展示：主回答和子任务文本/摘要使用已有固定版本的 `react-markdown 10.1.0` / `remark-gfm 4.0.1`，渲染标题、列表、表格、引用、粗体和代码块。表格与代码在内容区域内滚动；不执行原始 HTML，不加载模型提供的图片，链接只显示文字。超出 256 KiB 或 AST 节点/深度限制的正文回退为原文，不影响其他回答。识别正文开头连续的 `<think>…</think>` 作为折叠思考，代码块内和正文中提到的字面标签不被拆分；流式未闭合思考沿用少量实时预览。上述适配只改变显示，原生事件、历史和模型上下文保持原样。

任务栏改为与输入框同宽的紧凑卡片，默认一行显示数量、原生当前项及完成进度，展开后看完整任务；展开区域单独限高滚动。切换聊天后默认收起，空列表不显示。完成度严格来自原生 Todo 状态，不能因为主回合结束就推断条目已完成；主回合结束后保留静态状态图标，不再显示旋转中的加载状态。产品记录见 [PD-047](product-decisions.md#pd-047聊天正文排版与紧凑任务栏)。

Viewer 的代码来源单独记录在 [Viewer 代码来源](viewer-provenance.md)。

`examples/chip-sobel` 的七个源文件来自同一 demo 的 `demos/sobel/artifacts.tar.gz`。提取时根据 `manifest.json` 的路径与 SHA-256 校验，保留少量 RTL、测试、参考模型、约束和说明文件。`outputs/` 另取同一 Sobel 设计的最终网表、波形和版图，让文件树直接验证自动 Viewer 路由；它们是录制的产物，不代表精简源码目录本身可复现完整 EDA 流程。

| 项目产物 | 原 manifest SHA-256 |
| --- | --- |
| `outputs/sobel_netlist.json` | `eff43cc4f94307efbc3981fbc49c000d19b16192f8d7dafc77f3b92d820317b1` |
| `outputs/sobel_wave.vcd` | `da71356734959328ded9bc00845307d737735afb7071b392137ed9bfa45d52ad` |
| `outputs/sobel_layout.gds` | `88eb101db90f76a960f5b83e446423b7f8d66fa28240dc1110c49b6ceeabac95` |
