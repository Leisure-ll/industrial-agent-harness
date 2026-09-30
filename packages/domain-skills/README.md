# Domain skills

Registry and on-demand loading for domain guidance. Discovery returns a compact index; detailed skill content is loaded only when relevant to the current task. Skill text does not determine execution success.

当前 `src/capabilities.cjs` 含 Chip 网表、波形、版图与 PCB 板图的首批 Viewer 声明；Domain Pack 再添加受范围约束的原生工具声明。Broker 先披露摘要，选中能力后才读取详细参考内容。

对应的 Kimi `SKILL.md` 位于 `skills/`，由 `src/registry.cjs` 以稳定 ID 注册。Kimi 会话启动时只复制当前 Broker Scope 中通过全局默认值与项目覆盖策略启用的 Skill 到临时 `skillsDir`；Project 不修改仓库文件。新增默认 Skill 时，同时增加仓库文件、注册项和 Capability 引用。
Skill 加载复制完整目录树并拒绝 symlink；Scope 更换清理此前全部资源。`pcb.design.e2e` 从固定、已授权的外部 PCB-bench checkout 读取 11 个原始设计 Skill 文件，缺失或变更拒绝，不使用注册 stub 代替。

Chip Pack 的五组 EDA Capability 来自校验的 `packs/chip-pack.json`，与冻结的四个 Viewer 检查声明合并；`chip.eda.operate` Skill 说明网关调用与 EDA 持久化状态/验收语义。MCP、Desktop、CLI 消费同一份 Tool ID 声明。见 [MCP 接入](../../doc/domain-mcp-integration.md)。
PCB 的六个阶段组和完整设计/修复组来自 `packs/pcb-bench.json`，覆盖 89 个公开工具。见 [PCB MCP 接入](../../doc/pcb-mcp-integration.md)；注册和协议测试不代表原生执行或完整 Core 工业闭环已验收。

Godot 的源场景检查与原生运行检查来自 `packs/godot-local.json`，对应两份按任务范围加载的 Skill。原生检查不等于游戏行为验收。见 [Godot game MCP](../../doc/godot-mcp-integration.md)。
