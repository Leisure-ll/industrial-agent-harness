# Godot 与 PCB 工程文件 Viewer 优先级

这份清单按日常设计判断价值排序，不把 MCP 原生检查与只读 Viewer 混为一谈。Viewer 展示文件或运行态；验收仍由原生检查及任务专属测试完成。

| 优先级 | Godot 文件 | 当前状态与下一步 |
| --- | --- | --- |
| P0 | `.tscn` 场景 | 现有 Viewer 仅能解析部分 SpriteFrames/AnimationPlayer 素材；Web Export Viewer 看运行结果。值得增加源场景树、节点属性、锚点/增长方向、碰撞框和资源引用的专用视图，并与 MCP 的运行态观察并排。 |
| P0 | `.tres` 资源 | 已有部分动画/图集预览。扩展 SpriteFrames、AnimationLibrary、Theme、TileSet/TileMap 资源结构，显示引用关系与缺失资源。 |
| P1 | `.gd` 脚本 | 需要语法高亮、信号/节点路径导航和原生解析错误定位；保持只读。 |
| P1 | `project.godot` | 结构化显示主场景、Autoload、Input Map、显示/渲染设置及 Godot 版本兼容提示。 |
| P2 | `.res`、音频和 3D 资源 | 二进制资源与素材预览需经 Godot 导出/解析，成本高于文本资源。 |

| 优先级 | PCB 文件 | 当前状态与下一步 |
| --- | --- | --- |
| 已有 | `.kicad_sch`、`.kicad_pcb` | KiCanvas 已提供原理图/板图和多页原理图浏览。 |
| P0 | `.kicad_sym`、`.pretty/*.kicad_mod` | 增加符号、引脚、电气类型及封装焊盘几何预览，便于在放置前核对库对象。 |
| P0 | Gerber 与 Excellon：`.gbr/.gtl/.gbl/.drl` 等 | 增加层叠对齐、钻孔、板框和制造输出对照；注意扩展名有厂商差异，应根据内容识别。 |
| P1 | `.kicad_pro`、`.kicad_dru` | 结构化显示层数、规则、约束与检查配置，并与板图元数据关联。当前 `.kicad_pro` 只有普通文件预览。 |
| P2 | `.step/.stp/.wrl` | 3D 外形与装配预览，依赖较重，可先外部打开。 |

第一轮建议先做 Godot `.tscn` 的源场景视图和 KiCad 符号/封装库预览；它们直接对应这轮 Godot 动画帧、HUD 对齐与 PCB 选型检查的高频失误。
