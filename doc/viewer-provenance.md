# Viewer 代码来源

`packages/viewer-builtin/src/layout`、`src/netlist`、`src/waveform` 的初始代码于 2026-09-23 从本地 `silicon-lens-harness` demo 工作树迁入。迁移时保留 KLayout、netlistsvg 和 Surfer 的渲染路径，将 UI 所用的旧 `replayApi` 命名调整为新桌面端的 `viewerHost`，并调整模块路径。Viewer CSS 同样来自该 demo。

版图 Python 模块使用 KLayout 的 Python API；网表 worker 依赖锁定的 `netlistsvg@1.0.2`；波形模块包含官方站点的 Surfer JS/WASM 快照。Surfer 的详细来源、哈希与 EUPL-1.2 许可证保留在 `packages/viewer-builtin/src/waveform/surfer/`。

旧 demo 的回放系统、项目注册表和完整 Electron IPC 不随 Viewer 源码复制。新桌面端应通过项目/Artifact 身份核验后调用 Viewer，并保持产物来源与显示缓存分离。

2026-10-04 CAD 显示改为官方 OCCT 7.9.2 AIS/V3d/TKOpenGles 的本地 WebAssembly：完整上游源码固定为 `c5f20409c52bf8f658314d205a0e5d6f0be0969c`，无上游改动；Harness 自有 C++/React 桥接使用 MIT。初始化参考上游 MIT WebGL 示例并保留声明。OCCT LGPL-2.1 与例外、Emscripten 声明、对应源码归档、编译/重新链接资料和资源哈希位于 `packages/viewer-builtin/src/cad/occt/`，随 Desktop 许可证资源复制。实际读取哈希绑定的 BREP 曲面，STL 使用 AIS_Triangulation；详见 [OCCT renderer](../packages/viewer-builtin/src/cad/occt/README.md)。
