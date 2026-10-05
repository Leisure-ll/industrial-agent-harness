# 桌面语言切换

左下角 **Settings → Language / 设置 → 语言** 提供 **English / 简体中文 / Follow system（跟随系统）**。默认跟随系统：主语言为中文时显示简体中文，其他语言使用 English。手动选择立即生效，不重载应用；退出后保留选择。跟随系统时响应浏览器的 `languagechange` 通知。

## 展示范围

主界面、项目创建与详情、模型 API、全局和项目资源、外部 MCP、领域管理、更新面板、审批与提问、Thinking/Todo 和日志的自有控件均接入。文件工作区及各内置 Viewer 的 Harness 自有工具栏、提示、CAD 测量/剖切/草图约束标签也跟随语言。日期和数字按所选语言格式化；工程尺寸保留既有单位和精度。

用户输入、历史聊天、模型回复与提问正文、项目名称和目录、源文件、工具名称/参数/返回、原始日志和工程事实保持原文。动态诊断标题仅在日志的展示投影中转换，持久原始事件不变。KiCad/Surfer 等嵌入的上游界面维持自身语言；未登记的运行时诊断按原文显示。系统原生文件选择器的按钮仍由操作系统语言管理，Harness 提供的目录选择标题跟随应用。

## 偏好与边界

Desktop 的 `I18nProvider` 拥有语言选择，使用与主题相同的渲染器偏好存储，键为 `ia-language`，值限于 `system`、`en` 和 `zh-CN`。旧用户、无效值、不可用存储回退为跟随系统；存储不可用时本次切换仍可生效。该偏好不进入 CLI、模型配置、DomainState 或工程文件。

Viewer 通过 `packages/viewer-builtin` 的只读展示 Context 消费翻译回调；不会导入 Desktop，或把语言变更变成 Runtime 操作。Provider 更新不替换组件 key，不重新启动会话，也不重新解析源文件。源内容和传输命令保留原值。输入框在中文输入法组合输入期间忽略用于确认候选词的 Enter，普通 Enter/Shift+Enter 保留已有行为。

## 单一配置入口

语言声明及 Desktop、内置 Viewer 的自有文案统一维护在 [`apps/desktop/i18n.config.json`](../apps/desktop/i18n.config.json)。`locales` 声明语言代码、菜单显示名称及系统语言匹配前缀；`fallbackLocale` 指定缺少译文或系统语言未匹配时的默认语言；`storageKey` 保持偏好存储兼容。`messages` 以现有文案为键，译文以语言代码为键，不依赖数组位置。

例如，增加法语只需在同一配置中增加如下字段（与现有内容合并）：

```json
{
  "locales": {
    "fr": { "label": "Français", "systemLanguages": ["fr"] }
  },
  "messages": {
    "Settings": { "fr": "Paramètres" },
    "New chat in {0}": { "fr": "Nouvelle discussion dans {0}" }
  }
}
```

菜单选项、偏好验证、TypeScript 语言类型和系统语言识别均从配置派生，无需改 Provider、组件或切换逻辑。原生目录选择标题也读取同一配置。只检查系统首选语言；匹配更具体的前缀优先，例如登记 `zh-Hant` 后优先于 `zh`。未补齐的法语文案回退到 `fallbackLocale`，未登记的文案保留原文；移除语言后已保存的选择回退到跟随系统。`system` 是保留值，不应登记为语言。

新增自有控件仍需调用 `t(...)`，并在配置中补充文案，参数名称必须与默认译文一致。现有键沿用文案，修改键时须同时更新调用；这不是自动翻译用户内容的配置。当前接口支持普通文案与参数插值；复杂复数规则和按数量选择句式需要扩展格式化层。配置作为构建资源发布，修改后需重新构建和发布应用，不在运行时加载外部配置。

`core.ts` 只负责配置解析、匹配、偏好及翻译，`I18nProvider` 管理 React 展示状态，Viewer 只依赖宿主传入的翻译回调。Viewer 包不携带 Desktop 字典或语言偏好，CLI 和工业内核也不依赖这份配置。

## 验证

`pnpm --filter @industrial-agent-harness/desktop test:language` 在隔离的 macOS Electron 用户目录检查生产路径：即时切换、首次默认与系统回退、重载持久化、未发送草稿、IME Enter、文档搜索/120% 缩放/同一已挂载节点、原文件原文与弹窗。`test:logs` 还在确定性 SDK 会话中验证等待审批和回答时切换，保留待处理请求及已选择的答案并继续原轮次。现有 UI selftest 明确使用 English，不依赖测试机器系统语言。

新增单元测试覆盖偏好读取/写入失败、语言归一化、未知文案回退、参数插值和各语言的参数一致性；仅扩展测试配置的法语验证自动选项、系统识别、持久化及缺失译文回退，另验证区域语言优先和默认语言可配置。法语仅是测试，不代表产品提供完整法语译文。Electron 测试还检查菜单按配置生成，以及经过真实 preload/main IPC 的中英文目录选择标题。桌面构建、架构门禁、Viewer 单元测试与通用文档回归均需通过。此页面不据此声明其他平台完成原生语言切换验收。

macOS arm64 的 `test:cad` 还通过真实 FreeCAD 1.1.4 建模、独立回读和 OCCT 查看链路，在已选择两个对象测量最短距离时切换中英文，检查同一已挂载画布、两个选择、测量模式和精确距离均保留；原有剖切、草图约束、缩放和全屏回归通过。

集中配置随 Desktop staging 和 electron-builder 的文件清单一起打包；staging 检查主进程能解析配置路径。macOS arm64 未签名目录包已完成实际构建和 `smoke-packaged-desktop.cjs` 首次启动验证，确认主进程与渲染器在打包资源中正常读取配置。此项为打包与启动验证，语言切换完整回归仍使用上面的隔离 Electron 测试。
