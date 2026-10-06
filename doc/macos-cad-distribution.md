# Apple Silicon CAD 分发与安装

2026-10-06：首批目标是 macOS Apple Silicon + CAD/FreeCAD。本地 DMG 可以测试完整准备流程；公众下载仍需正式 Developer ID 签名、公证和发行源配置。Windows、Intel Mac 与其他工业工具不据此宣称安装就绪。

## 用户流程

1. 下载 DMG，将 Industrial Agent Harness 拖入 Applications，然后打开。
2. 首次启动选择 CAD。CAD Pack 随 Core 提供，不依赖预先存在的在线目录。应用显示约 620 MB 的 FreeCAD 下载量和准备进度。
3. 应用从官方固定发行下载 FreeCAD 1.1.4，验证完整 SHA-256、只读挂载、复制完整 app、验证上游代码签名并检查版本。安装到用户 Pack store 下的 `.runtime-assets/`，不修改用户已有 FreeCAD。
4. 准备成功后配置模型 API，创建绑定本地目录的 CAD 项目，发送建模或修改任务。Core 内置 Kimi Code 2.1.1；最终用户不需要 Node、pnpm、Python Kimi 或命令路径设置。
5. 设置 → 领域可补装、更新和检查／修复。原生依赖缺失或主执行文件变化会显示需要准备；修复重新检查签名和版本，可复用已验证的下载缓存。重启保留项目、依赖、历史 Action 和 Checkpoint。

下载和校验失败不激活新 Pack，也不覆盖旧版本。准备期间界面保留进度，禁止重复准备及新任务；安装后的项目绑定不会自动改变。网络更新目录不可用时，应用仍提供随 Core 带来的可选包，并提示暂时无法检查更新。在线 Pack 更新沿用签名目录验证。旧版 CAD Pack 未声明托管依赖时，请先更新 Pack。

## 安装层和执行层

- Core 资源目录保存可选 `.hpack` 和固定摘要索引；这部分继承应用签名的信任边界。主进程固定资源路径，渲染器不能导入任意本地索引。
- Pack 通过 `runtimeAssets` 声明平台、官方 HTTPS URL、大小、SHA-256、app 和可执行文件路径、版本探测以及环境变量映射。共享 Pack Manager 仅提供受控 `macos-app-dmg` 安装，拒绝任意安装脚本；大型依赖不塞入小型 Pack 归档。
- 下载流式写入临时文件，限制字节数和 HTTPS 重定向；验证成功后缓存。准备用跨进程锁，复制和探测成功后原子替换；失败清理 staging 并卸载 DMG。
- Domain registry 将验证过的依赖路径交给共享 Runtime factory。安装态不回落到开发环境或 `/Applications/FreeCAD.app`；工业修改仍经过 Scope、审批、Action、独立 Verifier 与 Checkpoint。
- 快速状态读取检查准备收据和主可执行文件摘要；“检查／修复”执行完整签名与版本复查。不会在每次打开设置时扫描整个大型 app。Pack 卸载保留可复用依赖与下载缓存，不删除项目或工程证据；运行时缓存清理 UI 尚未提供。
- CLI 使用同一 store 和环境解析；`domains install/update` 自动准备依赖，`domains repair DOMAIN` 复查和修复，`domains list` 显示依赖状态。

## 本地构建与验收

在开发机执行以下命令。最终用户直接使用 DMG，不需要这些工具。

```sh
pnpm install --frozen-lockfile
pnpm --filter @industrial-agent-harness/desktop build
node scripts/stage-desktop.cjs dist/desktop-stage-local
apps/desktop/node_modules/.bin/electron-builder --projectDir dist/desktop-stage-local --config "$PWD/electron-builder.config.cjs" --mac dmg --arm64 --publish never
node scripts/smoke-packaged-cad.cjs dist/ci-reports/cad-install --dmg
```

阶段目录与验收目录每次需新建。默认构建在 Apple Silicon 嵌入可选 CAD Pack；`HARNESS_BOOTSTRAP_DOMAINS` 可指定其他受支持包或留空。生产构建仍要求既有的发行源、公钥、签名和公证配置，见[发行规划](installation-and-ota-plan.md)。

安装验收从真实 DMG 复制应用，在仓库之外的应用工作目录与独立用户 store 运行；清除 FreeCAD 和 Kimi 路径覆盖，使用 Core 内置可选包。默认依赖从官方 HTTPS 下载；本地可用 `HARNESS_CAD_INSTALL_ARCHIVE` 提供同一官方 DMG 缓存，该输入依然经过全部校验、真实挂载、复制和原生探测。不会使用已挂载的开发 FreeCAD。

测试通过 GUI 首次选择、真实 Kimi Code 的审批与工具回调、FreeCAD 草图拉伸／贯穿孔建模，再用同一聊天修改宽度和孔径。断言独立回读的尺寸、体积、模型版本和持久 Checkpoint；从项目文件树打开实际 FCStd/BREP 到 OCCT。随后删除托管可执行文件，通过正常设置修复，再重启检查依赖、项目和两次验收记录。模型响应为本地受控响应，不评价模型推理质量，也不消耗用户模型额度。

`.github/workflows/desktop-package.yml` 的 macOS 门禁执行上述实际 DMG 路径，保留报告、界面截图和工程证据；失败即失败，不跳过原生 CAD。共享单元测试覆盖篡改、大小、HTTPS 降级、取消、并发准备、版本不匹配、损坏修复和更新失败保留旧 Pack。在线签名目录、真实旧→新 Core OTA、公众 Gatekeeper 下载路径及正式发布属于下一阶段，不能由这份未签名本地包代替。
