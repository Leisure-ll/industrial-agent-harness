# 内置浏览器 V1

2026-10-04 加入桌面工作区。入口是聊天标题栏和工作区标题栏的 🌐 按钮；选择项目后即可使用，不需要配置模型。项目文件树中的普通 `.html` / `.htm` 自动进入 Browser Viewer，完整 Godot Web Export 仍优先进入 Godot Viewer。

## 已实现的交互

- 输入 HTTP/HTTPS URL、网站域名或 `localhost:端口`，直接浏览网页和开发服务器。
- 多标签、新建、选择、关闭；页面的 `target="_blank"` 链接进入同一工作区的新标签。
- 前进、后退、刷新、停止加载；地址栏随导航更新，显示加载和失败状态。
- 复用工作区缩小、放大、Fit 和全屏入口。Ctrl/Cmd + 滚轮改变阅读比例，普通滚轮滚动；原生捏合放大页面，Fit 恢复阅读比例与捏合比例。
- 工作区隐藏/恢复、普通文件切换、全屏进出保留标签和页面表单/运行状态。设置和日志遮罩打开时移除原生网页视图，关闭后恢复。
- 页面焦点中的 Cmd/Ctrl + L、T、W、R、+/−、0 对应地址栏、新标签、关闭、刷新、缩放和 Fit；Esc 交回工作区退出全屏。

## 运行时和边界

使用桌面包固定的 Electron 44.0.0 / Chromium，无新增浏览器下载、服务器或外部 Chrome 依赖。`WebContentsView` 留在 `apps/desktop/electron/browser.cjs`；React 视图按需加载，HTML 选择经过 Viewer Registry，Viewer Core 和 CLI 不依赖 Electron。

每个项目使用独立的持久浏览器 partition。Cookie、网页存储和登录状态不共享给其他项目、Harness 主界面或系统浏览器。最多每项目 8 个标签、总计 16 个；窗口/应用关闭释放所有 WebContents，下次运行保留网站登录数据，标签不自动恢复。

网页启用 sandbox、context isolation、web security，关闭 Node、子框架 Node 和 webview。没有暴露 Harness preload API；独立隔离脚本只监听修改键滚轮，经主进程校验发送者、主框架、当前项目与标签后改变显示比例。网页没有工业工具、文件 IPC、模型凭据或任意执行接口。

HTTP/HTTPS 页面正常使用网络。地址栏和导航拒绝 `file:`、`javascript:`、`data:`、`app:` 及其他外部协议、嵌入用户名/密码的 URL；不启动外部程序，不绕过证书错误。摄像头、麦克风、设备权限和下载当前均禁用。V1 提供用户手动浏览与交互，尚未把 Agent 的点击、输入、DOM 读取和截图接入 Kimi，也不包含 DevTools、浏览器注释或扩展安装。

## 项目 HTML

选定 HTML 通过随机、独立来源的项目协议加载。只读资源校验 canonical path 在原项目目录内，拒绝隐藏文件、跨项目请求、路径穿越、目录与越界 symlink；只服务声明的网页资源扩展名，单资源最多 32 MiB，每预览最多 256 个资源。HTML 来源使用 Artifact SHA-256，已读取配套资源也核对摘要；文件改变后需从文件树重新打开。预览不写源文件、DomainState 或验收结果。

HTML 在浏览器沙箱中执行自己的 JavaScript，并可加载 HTTP/HTTPS 资源；运行成功不代表工程验证。需要开发服务器路由/HMR 的项目应使用 localhost 地址，静态预览不模拟服务器后端。

## 验证

2026-10-04 已通过 macOS Apple Silicon 的源码版真实 Electron 自测，包含原生捏合和设置遮罩；迁移到最新主分支后，桌面/Viewer/架构相关单元测试通过 69 项，KLayout 依赖未配置的 1 项跳过。现有五种通用文件 Viewer 的原生桌面回归也通过。

运行 `pnpm --filter @industrial-agent-harness/desktop test:browser`。使用临时工程和独立 userData，包含真实文件树 → Registry → Chromium 的 HTML/CSS/JS 渲染，地址输入/localhost、导航/刷新/停止、标签、缩放/全屏、原生捏合、表单保留、设置遮罩、项目/Cookie 隔离、失败状态、摘要失效和退出释放。`browser-policy.test.cjs` 另外验证资源、URL 和视口边界。验证范围以自测收据为准；Windows/Linux 打包运行未在本次验证。

## 参考

交互参考 [OpenAI 官方 Browser 文档](https://learn.chatgpt.com/docs/browser?surface=app)中的并列网页、独立会话、多标签与本地页面预览。实现按 [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)、[session protocol](https://www.electronjs.org/docs/latest/api/protocol) 和 [Electron 安全指导](https://www.electronjs.org/docs/latest/tutorial/security)在本仓库开发，没有复制 Codex/Kimi 私有实现。
