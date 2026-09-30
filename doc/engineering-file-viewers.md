# Godot 与 PCB 工程文件预览

项目文件树现在为 Godot 源工程和 PCB 交付文件提供只读预览。打开文件时，桌面端先登记 Artifact ID 和 SHA-256，再由 Viewer Registry 选择解析器。显示的是原文件的有限结构、几何或媒体快照；Viewer 不运行脚本、不编辑工程，也不把预览结果当作设计验证。

| 类别 | 文件 | 工作区可见内容 |
| --- | --- | --- |
| Godot 场景、资源 | `.tscn`、`.tres` | 节点/资源段、属性和项目内 `res://` 引用状态；受支持的 SpriteFrames 或 AnimationPlayer 另有 Animation 标签 |
| Godot 脚本、配置 | `.gd`、`project.godot` | 声明提纲、带行号源码与关键字着色，或设置分组 |
| Godot 二进制资源 | `.res` | 文件头和大小等元数据；可显式交给系统关联应用 |
| Godot 音频 | `.wav`、`.ogg`、`.mp3` | 文件头检查、大小与浏览器音频播放；WAV 另显示声道、采样率和位深 |
| Godot 3D 素材 | `.obj`、`.wrl`、`.gltf`、`.glb` | OBJ/VRML 的正投影线框，glTF 2.0 的节点与 mesh 数量；可显式交给系统关联应用 |
| KiCad 库、规则、配置 | `.kicad_sym`、`.kicad_mod`、`.kicad_dru`、`.kicad_pro` | 符号引脚与基础形状、封装焊盘与基础形状、规则或配置分组 |
| PCB 制造文件 | `.gbr`、`.ger`、`.gtl`、`.gbl`、`.gts`、`.gbs`、`.gto`、`.gbo`、`.gtp`、`.gbp`、`.gko`、`.gm1`、`.drl`、`.xln`、`.exc` | Gerber/Excellon 简化几何，同目录同设计名的最多 15 个配套层叠加，可逐层隐藏 |
| PCB 3D 模型 | `.step`、`.stp`、`.wrl` | STEP 实体数和抽取点位置，VRML 正投影线框；可显式交给系统关联应用 |

所有视图使用工作区缩小、放大、Fit、全屏和画布滚轮/触控板捏合缩放。左侧结构列表可筛选、选中属性，并在有几何时控制可见层；符号库默认仅显示第一枚符号，选中其他符号会切换图形，制造文件默认叠加配套层。Source 标签显示文本原件；播放音频使用浏览器内置控件。普通 Godot Web Export 运行预览，以及 KiCad `.kicad_pcb` / `.kicad_sch` 的 KiCanvas 查看仍由原有 Viewer 负责。

这些预览有意限定保真度：Godot 文本场景按段和首行属性列出，不执行场景、脚本、shader 或资源引用；`.res` 不解码。OBJ/VRML 不是可旋转的材质模型；glTF/GLB 只列元数据，STEP 不镶嵌 B-rep 曲面，点位图不能用于间隙检查。KiCad 符号/封装只绘制支持的基础形状；旋转、复杂形状和参数语义需在 KiCad 中确认。Gerber 的圆弧、填充区、清除极性和部分光圈会以简化形状显示或发出警告；Excellon 无小数点坐标采用 3 位小数假设并发出警告。制造、DRC/ERC 和 3D 验收必须使用专业工具。

“Open in app” 仅在 3D 模型和 `.res` 上提供，需要用户点击，使用操作系统的文件关联；没有关联应用时显示启动错误。它不会通过 Shell 命令执行文件，也不会把“已打开”当作验证。内部预览无需联网，也无需安装 Godot 或 KiCad。

文本单文件上限 4 MiB，媒体与符号库 16 MiB；几何最多解析 30,000 个原语，UI 最多绘制 12,000 个。源码、配套制造文件均限制在当前项目内；源文件需与登记哈希一致，文件变更须重新打开。配套制造文件分别生成只读快照；损坏或不可读的非主层会显示警告而不冒充完整叠层。未知或不支持的坐标格式明确失败。

`packages/viewer-builtin/tests/engineering.test.cjs` 覆盖解析、格式边界、哈希、大小和越界路径；`pnpm --filter @industrial-agent-harness/desktop test:engineering` 从真实项目文件树检查 Registry、渲染、缩放、全屏、图层与错误状态。本地另用 Godot 4.7.2 示例、KiCad 10.0.6 官方库文件及本仓库 `pcb-led` 生成的 Gerber/钻孔文件做格式抽检。桌面链路目前只在 macOS Electron 实测，其他平台未宣称通过。
