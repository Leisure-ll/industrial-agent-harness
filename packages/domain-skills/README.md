# Domain skills

Registry and on-demand loading for domain guidance. Discovery returns a compact index; detailed skill content is loaded only when relevant to the current task. Skill text does not determine execution success.

当前 `src/capabilities.cjs` 含 Chip 网表、波形、版图与 PCB 板图的首批 Viewer 声明；Domain Pack 再添加受范围约束的原生工具声明。Broker 先披露摘要，选中能力后才读取详细参考内容。

对应的 Kimi `SKILL.md` 位于 `skills/`，由 `src/registry.cjs` 以稳定 ID 注册。Kimi 会话启动时只复制当前 Broker Scope 中通过全局默认值与项目覆盖策略启用的 Skill 到临时 `skillsDir`；Project 不修改仓库文件。新增默认 Skill 时，同时增加仓库文件、注册项和 Capability 引用。
源码态与安装态 Skill 加载都复制完整目录树，保留 `references/`、`assets/`、`scripts/`，拒绝 symlink、特殊文件及超限资源；Scope 更换原子清理此前全部资源，失败保留旧 Scope。`pcb.design.e2e` 从固定、已授权的外部 PCB-bench checkout 读取 11 个原始设计 Skill 文件，缺失或变更拒绝，不使用注册 stub 代替。

Chip Pack 的五组 EDA Capability 来自校验的 `packs/chip-pack.json`，与冻结的四个 Viewer 检查声明合并；`chip.eda.operate` Skill 说明网关调用与 EDA 持久化状态/验收语义。MCP、Desktop、CLI 消费同一份 Tool ID 声明。见 [MCP 接入](../../doc/domain-mcp-integration.md)。
PCB 的六个阶段组和完整设计/修复组来自 `packs/pcb-bench.json`，覆盖 89 个公开工具。见 [PCB MCP 接入](../../doc/pcb-mcp-integration.md)；注册和协议测试不代表原生执行或完整 Core 工业闭环已验收。

Godot 的源场景检查与原生运行检查来自 `packs/godot-local.json`，对应两份按任务范围加载的 Skill。原生检查不等于游戏行为验收。见 [Godot game MCP](../../doc/godot-mcp-integration.md)。

公开 Pack 构建复制自有 Skill 完整目录，并携带主仓许可与第三方声明。PCB 的完整外部设计 Skill 不打入公开归档：包内保留公开引导及 `external` 固定来源声明，安装态与源码态同样在使用时校验用户授权 checkout。缺资源明确拒绝，不能以公开 stub 替代。

`loadRegistry()` 同时返回 `runtimePacks`：仅从仓库登记或已校验安装库读取 Runtime 入口及其领域目录，供工业运行时工厂加载；没有额外领域硬编码。

独立 Skill-only Pack 开发、构建、安装与资源验证见 [作者教程](../../doc/pack-authoring.md)。发行物 gate：`node scripts/check-pack-release.cjs`。

CAD 的 `freecad-local` 提供可重建参数配方与三种宿主 Runtime 工具。`transport: runtime` 注册可打包的执行入口与固定源码清单，不生成 MCP 直连服务，见 [FreeCAD CAD Pack](../../doc/freecad-domain-pack.md)。
