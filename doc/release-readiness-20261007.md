# 2026-10-07 发布整改与本地验收

目标：macOS Apple Silicon + CAD/FreeCAD 的本地可安装预览。用户已确认暂不提供 Developer ID 凭据；本轮交付不包含正式签名、公证、公众下载或真实 Core OTA。应用包含可选 CAD Pack 与固定 Kimi Code 2.1.1，首次选择后准备官方 FreeCAD 1.1.4；不要求最终用户安装开发工具。

## 审计问题与处理

| Issue | 处理与验证 |
| --- | --- |
| [#42](https://github.com/Zhiman-BJ/industrial-agent-harness/issues/42) | 原生 step 各自维护流偏移，工具前言不再吞掉最终答案；Markdown/GFM 与前导思考片段分开显示。安装/修复沿用真实官方 FreeCAD 流程；公众发行项保留待办。 |
| [#44](https://github.com/Zhiman-BJ/industrial-agent-harness/issues/44) | 原生子任务生命周期卡片与结果、子任务审批、前后台控制事件、上游自动后续回答和历史恢复；主会话只订阅原生 main 文本，子任务正文不会混入主答案。后台运行与后续回答持有资源租约。 |
| [#45](https://github.com/Zhiman-BJ/industrial-agent-harness/issues/45) | OCCT 相机保留当前画布宽高比，Fit 恢复初始视角；共享工作区分隔线可拖动、键盘调整、双击复位并保存宽度，聊天最窄 280 px。原生渲染像素比例、全屏前后与测量回归。 |
| [#46](https://github.com/Zhiman-BJ/industrial-agent-harness/issues/46) | Desktop/CLI 使用同一版本比较，正常更新仅选择新版本；Manager 下载前及激活锁内拒绝降级。同版本修复保留。 |
| [#47](https://github.com/Zhiman-BJ/industrial-agent-harness/issues/47) | Pack 与原生依赖下载共享取消、60 秒连接/停滞限时、20 分钟总限时及进度。真实签名 HTTPS 服务验证中断、取消、旧包保留和重试，不替换 production fetch。 |
| [#48](https://github.com/Zhiman-BJ/industrial-agent-harness/issues/48) | 资源设置按 ID 选择，Scope 变化保持原生上下文，MCP 用实际内核审批而非旧工具；原生 macOS CI 增加桌面 UI、语言、文件、图片、并行、聊天、日志、MCP、subagent 和 CAD 缩放验收。 |

## 验收方法与边界

Portable 回归检查共享契约、Pack、取消/恢复、桌面存储、语言及解析边界；原生回归执行真实 FreeCAD 和 Verilator、Scope、审批、失败、超时、取消、聊天恢复及上游内核兼容。桌面子任务测试通过真实 Kimi Code 与本地可控模型响应触发原生 Agent 工具、子任务 Bash 审批、主会话提问和原生后台通知后的工具审批/提问、后台待审批时停止，保存并恢复卡片与 Markdown。它验证外壳兼容，不评价模型推理质量，也不宣称改变上游策略。

`test:cad-resize` 通过实际 Electron 事件和 OCCT 像素，检查拖动、最小聊天宽度、键盘 Home/End、恢复默认、小窗口、进出全屏的比例，以及 40 mm 边、Ø4 mm 圆孔、最短距离、剖切和草图约束；工程文件哈希保持不变。查看与测量不产生工程验收事实。

安装验收使用真实 DMG，在 Git 工作区之外复制并运行应用，清除 FreeCAD/Kimi 路径覆盖。可复用同一官方 FreeCAD DMG 缓存，但仍执行完整摘要、真实挂载/复制、上游代码签名和版本检查。首次选择 CAD 后，实际建模、同聊天修改尺寸、独立回读、OCCT 显示、损坏修复和重启恢复均经过正常产品接口。安装操作会下载约 620 MB 的官方归档并准备约 2.5 GB 的 FreeCAD app；下载取消后可重新准备。

```sh
pnpm test:ci -- portable
pnpm test:ci -- native
pnpm test:architecture
pnpm --filter @industrial-agent-harness/desktop build
pnpm --filter @industrial-agent-harness/desktop test:subagents
pnpm --filter @industrial-agent-harness/desktop test:cad-resize
node scripts/stage-desktop.cjs dist/desktop-stage-local
apps/desktop/node_modules/.bin/electron-builder --projectDir dist/desktop-stage-local --config "$PWD/electron-builder.config.cjs" --mac dmg --arm64 --publish never
node scripts/smoke-packaged-cad.cjs /absolute/fresh-evidence --dmg
```

阶段目录与证据目录需新建。原生 CAD 需要固定 FreeCAD，可由 `scripts/setup-freecad.cjs` 准备。安装包缓存参数、依赖边界及 CI 方法见[Apple Silicon CAD 分发](macos-cad-distribution.md)。不据本次 macOS 本地验收宣称 Windows/Linux 桌面原生 CAD 就绪；其他平台结果以 CI 与对应原生安装验收为准。

## 后续公众发行条件

正式 Developer ID 签名/公证、HTTPS 下载站点与发行源、公钥部署、从已发行版本到新版本的 Core OTA，以及带浏览器下载隔离标记的 Gatekeeper 首次启动验收。这些与本轮可本地安装的 DMG 分开跟踪；本地包的应用更新页显示未配置更新源。
