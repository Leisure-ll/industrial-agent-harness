# Domain skills

Registry and on-demand loading for domain guidance. Discovery returns a compact index; detailed skill content is loaded only when relevant to the current task. Skill text does not determine execution success.

当前 `src/capabilities.cjs` 含 Chip 网表、波形、版图与 PCB 板图的首批声明。Broker 先披露摘要，选中能力后才读取详细参考内容。这些声明用于 MVP 的发现与查看流程，PCB 专业工具执行尚未接入。

四个对应的 Kimi `SKILL.md` 位于 `skills/`，由 `src/registry.cjs` 以稳定 ID 注册。Kimi 会话启动时只复制当前 Broker Scope 中通过全局默认值与项目覆盖策略启用的 Skill 到临时 `skillsDir`；Project 不修改仓库文件。新增默认 Skill 时，同时增加仓库文件、注册项和 Capability 引用。

Chip Pack 的五组 EDA Capability 来自校验的 `packs/chip-pack.json`，与冻结的四个 Viewer 检查声明合并；`chip.eda.operate` Skill 说明网关调用与 EDA 持久化状态/验收语义。MCP、Desktop、CLI 消费同一份 Tool ID 声明。见 [MCP 接入](../../doc/domain-mcp-integration.md)。
