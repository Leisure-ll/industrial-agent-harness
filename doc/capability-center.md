# Capability Center 能力中心设计稿

状态：设计稿（待确认）· 2026-10-08

## 1. 背景与问题

Domain pack 安装、Skills / MCP 启停、外部 MCP 添加目前分散在三个弹窗里：

| 内容 | 现状 | 痛点 |
| --- | --- | --- |
| Pack 安装/更新/移除 | `DomainManager` `<dialog>` | checkbox 表单，已安装/可安装/进度/诊断挤在一个弹窗，pack 变多后不可扩展 |
| Skills / MCP 启停（全局） | `GlobalResourceSettings` `<dialog>` | 无搜索、无状态、无分组视图 |
| 外部 MCP 添加 | 同上弹窗内的 `<details>` 折叠区 | 最该被发现的入口藏得最深 |
| 项目级覆盖 | `ProjectDetails` 内另一份 `ResourceSettings` | 与全局入口割裂，无作用域切换心智 |

目标：用一个全屏「能力中心」页面替代三个弹窗，信息架构以 **domain pack 为中心**（一个 pack 捆绑 skills + MCP + runtime），而不是插件/技能/服务器平行罗列。

## 2. 信息架构

```
Capability Center（全屏页，主区切换，侧栏保留）
├─ Domain Packs    卡片网格：安装/更新/移除/修复
├─ MCP Servers     远端服务(Zhiman Remote) + 内置（随 pack）与外部（用户添加）统一列表
├─ Skills          按 domain 分组的技能列表
└─ 运行时诊断      pack 错误、目录源告警的集中展示
```

不设「插件 / 命令 / 钩子」等平行类目——本产品中能力随 pack 而来，pack 是用户心智中的一等单元。

## 3. 页面布局

```
┌────────────┬───────────────────────────────────────────────────────┐
│            │ ← 返回        能力中心          [作用域: 全局|项目▾]  ✕ │ 56px header
│  侧栏       ├──────────┬────────────────────────────────────────────┤
│ (保持不变)  │ Packs    │  (区块内容区，独立滚动，内容列宽上限 960px)  │
│            │ MCP  ·3  │                                            │
│            │ Skills·12│  ┌──────────────────────────────────────┐   │
│            │ 诊断     │  │ 行卡片 / 列表 / 进度条 / 空状态        │   │
│            │          │  └──────────────────────────────────────┘   │
└────────────┴──────────┴────────────────────────────────────────────┘
```

- 复用现有 `page` 状态机：新增 `'capabilities'`，与 `'chat' | 'project'` 同级，侧栏不动。
- 左侧区块导航显示计数徽章（如 MCP 服务器数、可用更新数）。
- 作用域 segmented control（全局 / 当前项目）仅出现在 MCP 和 Skills 区块内、且存在活跃项目时；ProjectDetails 的入口直达项目作用域并锁定。
- Esc / 返回按钮回到进入前的页面（chat 或 project）。

## 4. 区块详细设计

### 4.1 Domain Packs

数据来源：`domainStatus()`、`domainAvailable()`、`onDomainProgress` 事件；操作 `domainInstall / domainRemove / domainRepair / domainCancel`。

**卡片网格布局**（参考 ZCode 插件市场，2026-10-08 确认）：放弃 checkbox 批量安装，每卡独立操作。

- **卡片**：emoji 图标块 + 名称 + 版本 + 一行摘要（截断）+ 元信息（下载体积、前置依赖）；右侧/底部主按钮。
- **可安装组**：未安装的 pack 卡片，按钮 `Install`；数据来自 `domainAvailable()`。
- **已安装组**：状态徽章（`Ready to use` `--ia-success` / `Needs preparation` `--ia-muted`）+ 动作：`Check / repair`（或 `Prepare / retry`）、`Remove`；有更新时（`updateAvailable`）显示 `x → y` 与 `Update` 按钮（`domainInstall([id])` 单元素数组）。
- 网格 2 列（窄窗口 1 列），组标题 + 计数。
- **进行中操作**：区块顶部通栏进度条（label · phase · MB 进度 · Cancel download）。
- **告警**：目录源不可用（`catalogWarning`）显示为通栏 note（bundled pack 仍可安装）；开发模式 `managed=false` 保留现有提示文案。
- 诊断错误同时在所属 pack 卡片内显示，并汇总到「运行时诊断」区块。

### 4.2 MCP Servers

数据来源：`resourceGet({projectId?})`（内置服务器 + 启停状态）、`externalMcpList()`（外部服务器）、`remoteService()`（远端服务）。

- **远端服务分组（Zhiman Remote，置顶）**：连接状态徽章（`serviceLabels` 五态）+ 远端可用 domain 徽章列表（`RemoteServiceState.domains`）+ `Check connection` 按钮；标注 trial。整体从 `GlobalResourceSettings` 迁移（`RemoteServiceSettings` 原样搬入，容器改变）。项目级的远端同步（`ProjectExecution`）仍留在 ProjectDetails，不迁移。
- 作用域切换：全局 ⇄ 当前项目（项目作用域的行控件为 `Inherit (全局态) / Enabled / Disabled` 三态 select，复用 `ResourceSettings` 现有逻辑）；远端服务分组不受作用域影响。
- 搜索框：按 id / title / domain 过滤。
- 列表行：
  - 内置：title · id · domain 徽章 · 传输方式（Local/Remote）· 工具数（可由 `detail(capabilityId)` 获取）· 启停控件。
  - 外部：title · id · `External` 徽章 · transport · 工具数 · `checkedAt`（相对时间）；动作 `Refresh tools` / `Remove`。
- **添加外部 MCP**：区块头部常驻主按钮 `添加 MCP 服务`，展开内联表单（三个 tab：本地命令 / 远程 URL / 导入 JSON，即现有 `ExternalMcpSettings` 表单原样迁移）——不再藏在折叠区。
- 空状态：虚线边框盒 + 引导文案 + `添加 MCP 服务` CTA（对齐参考截图的空态样式）。

### 4.3 Skills

数据来源：`resourceGet({projectId?})`。

- 与 MCP Servers 相同的作用域切换 + 搜索模式。
- 按 domain 分组展示（分组标题 = pack 名称），行 = title · id · 默认启用徽章 · 启停控件（全局 checkbox / 项目三态 select）。
- 保留现有说明文案（全局默认、项目覆盖优先、改动对新建会话生效）。

### 4.4 运行时诊断

数据来源：`domainStatus().errors`、`catalogWarning`。

- 只读列表：`domain · message`，每行附「前往 pack」链接（跳到 Packs 区块并定位该 pack 行）。
- 目标：把现在散在 DomainManager 里的 `diagnostics` / `feedError` 变成可持续观察的面板。

## 5. 关键交互流

1. **安装/更新 pack**：勾选可安装组的若干行 → 头部 `Install N` → 进度通栏（可 Cancel）→ 完成后刷新列表并回调 `onChanged`（composer 的 domain 下拉同步）。
2. **添加外部 MCP**：MCP 区块 → `添加 MCP 服务` → 内联表单选 tab 填写 → `Add and check` → 校验工具数 → 新行出现在列表顶部。
3. **作用域切换**：MCP / Skills 区块内的 segmented control，切换即重新 `resourceGet({projectId?})`；无活跃项目时隐藏项目侧。
4. **退出页面**：返回按钮 / Esc → 恢复进入前页面；设置弹层内的两个入口（Domains、MCP & Skills）改为深链直达对应区块。

## 6. 组件复用映射（容器重组，非重写）

| 现组件 | 去向 |
| --- | --- |
| `DomainManager`（非 firstRun 路径） | 拆为 `PacksSection`（状态机与 IPC 原样保留） |
| `DomainManager`（firstRun 路径） | **保留轻量弹窗**，仅作首次引导；后续可更名 `OnboardingDomainPicker` |
| `ResourceSettings` | 拆为共享 `ResourceList`，被 MCP / Skills 区块复用（kind 参数化） |
| `ExternalMcpSettings` | 迁移为 `ExternalMcpPanel`（表单逻辑不变，容器从 `<details>` 换成内联展开面板） |
| `RemoteServiceSettings`（在 `RemoteExecution.tsx`） | 迁移为 MCP 区块内的远端服务分组（逻辑不变，容器改变）；`ProjectExecution`/`RemoteTaskStatus` 不动 |
| `GlobalResourceSettings` 弹窗 | 删除（被本页替代） |
| `ProjectDetails` 内资源区 | 保留入口，内部改用 `ResourceList`（scope 锁定为项目） |

新增：`CapabilityCenter`（页面壳 + 区块导航 + 作用域状态）、`ScopeSwitch`（segmented control）。

IPC 面零改动；全部复用第 4 节列出的现有 API。

## 7. 视觉规范

沿用 `apps/desktop/DESIGN.md` 的 token 与密度体系：

- 页面底 `--ia-bg`，左导航 `--ia-panel`，行卡片 `--ia-raised` + 细分隔线（不引入新卡片层级）。
- 状态徽章：Ready/已启用 `--ia-success`、错误 `--ia-danger`、中性信息 `--ia-muted`；文字与背景取同一主题，满足 4.5:1 对比。
- 字号密度与现有一致（11px 元信息 / 12px 控件与摘要 / 14px 正文）；内容列宽上限 960px 居中，避免宽屏行过长。
- 键盘与无障碍：区块导航 `aria-current`、搜索框显式 label、启停控件保留现有 aria-label、作用域切换用 radiogroup；焦点管理沿用 `GlobalResourceSettings` 的 opener 还原策略。

## 8. 实施步骤

1. `CapabilityCenter` 页面壳 + `page` 状态扩展 + 设置弹层深链（此时三个弹窗仍在）。
2. `PacksSection` 迁移 DomainManager 逻辑，移除非 firstRun 弹窗入口。
3. `ResourceList` + MCP / Skills 区块，吸收 `GlobalResourceSettings` / `ExternalMcpSettings`，删除该弹窗。
4. 「运行时诊断」区块 + ProjectDetails 内复用改造。
5. 更新 `test:ui`（入口变化、外部 MCP 表单无需展开即可达、作用域切换）与 i18n 词条；过一遍明暗两主题 + 1250/1050px 窄窗口检查。

## 9. 明确不做

- 不做参考截图中的 插件/命令/钩子/记忆/子代理 类目（能力模型不同）。
- 不做外部 MCP 的实时连接状态点——当前 `ExternalMcpSummary` 无连接态字段，需后端支持后再加（预留行内徽章位）。
- 首次引导不改成全屏页（装完即走，不打断新用户）。
