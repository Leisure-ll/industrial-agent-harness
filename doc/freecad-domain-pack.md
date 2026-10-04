# FreeCAD CAD Pack V1

2026-10-04：首批面向 3D 零件建模。实际执行依赖官方 **FreeCAD 1.1.4 macOS arm64**；Windows/Linux 原生 CAD 执行尚未验收。Pack 包含 Harness 自有桥接代码与 Skill，不捆绑 FreeCAD 二进制。上游来源和许可证见 [FreeCAD 1.1.4](https://github.com/FreeCAD/FreeCAD/releases/tag/1.1.4) 与 [FreeCAD license](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/LICENSE)。

## 工具与执行

| 工具 | 首批能力 |
| --- | --- |
| `cad.freecad.build` | 参数配方、矩形/圆形全约束 Sketcher 草图、PartDesign Pad、长方体、圆柱、圆柱打孔、并集/差集/交集；保留原生特征树 |
| `cad.freecad.inspect` | 回读受支持的 FCStd/STEP，生成几何报告和预览产物；不修改输入文件 |
| `cad.freecad.export` | 受支持的 FCStd/STEP 转换为 FCStd、STEP、STL，并通过第二个 FreeCAD 进程回读检查 |

Desktop 和 CLI 均通过 `createProjectRuntime` 加载 `freecad-local` Pack。Broker 披露规范 Tool ID；Kimi 先调用 `industrial_tool_describe` 获取选中工具的输入说明，再通过 `industrial_action_call`、当前 State ID 和审批进入持久 Runtime。它是宿主 Runtime 工具提供方，不启动独立的 CAD MCP 进程；新增 CAD 操作没有绕过 Runtime 的直连执行路径。

所有尝试保留 Run/Action/Verification；成功产物位于工程 `cad-output/<action-id>/`，失败保留已经产生的诊断与明确产物集合。原文件始终作为输入快照，输出采用新的 Action 目录。用户应将需要修改并作为新输入的模型放在工程普通目录；`cad-output` 是历史输出区，不作为源文件清单。输入源文件改变后 State 会失效，必须重新披露 Scope。

通过原生 Sketcher/PartDesign/Part 的固定操作构建模型，不提供任意 Python、宏或 Shell 执行。命名参数属于可重建配方；重新提交参数会产生新版本。原生 FCStd 保留草图约束、Pad 长度及布尔特征，可在 FreeCAD 中编辑；配方参数组是参数记录，不是自动关联的 Spreadsheet 表达式。

## 使用

安装官方 FreeCAD 1.1.4，默认发现 `/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd`；其他安装位置显式设置 `INDUSTRIAL_HARNESS_FREECAD_CMD`。受保护 Agent 当前仍只验证 macOS Apple Silicon。

在 CAD 工程中描述任务，例如「用 FreeCAD 创建 40×20×5 mm 的板，在 (10,10) 处打半径 2 mm 的通孔，并验证体积和边界尺寸」。工具输入示例：

```json
{
  "recipe": {
    "parameters": {"L": 40, "W": 20, "T": 5, "R": 2},
    "features": [
      {"id": "Plate", "op": "sketch_pad", "profile": "rectangle", "length": "L", "width": "W", "height": "T"},
      {"id": "Drilled", "op": "hole", "base": "Plate", "radius": "R", "height": "T", "origin": [10, 10, 0]}
    ],
    "result": "Drilled"
  },
  "expect": {"volume": 3937.168146928204, "bounds": [40, 20, 5], "solids": 1}
}
```

长度单位 mm，体积 mm³。配方最多 50 个特征、100 个参数；尺寸为有限正数且不超过 10000 mm。布尔操作只能引用先前特征，原点坐标受限，不接收表达式。几何预期支持体积、边界三轴尺寸、实体数和绝对容差（默认 0.00001）。不提供预期时，仅验收几何与格式一致性，报告明确指出未做设计尺寸验收。

## 回读、限制与证据

保存后启动独立 FreeCAD 进程重开 FCStd，并重新读入 STEP 和 STL。Verifier 读取收集并保存的报告，检查实体有效性、正体积、Sketcher 全约束、原模型与 FCStd/STEP 的体积/尺寸/实体数一致性、网格存在，以及用户提供的尺寸预期。进程退出成功不等于通过；尺寸错误保留输出并返回 `failed`。这些检查不证明机械强度、装配正确性、公差设计或可制造性。

输入限 16 MiB，源目录清单限 100 文件/64 MiB，FCStd 解压限 64 MiB/2000 项。FCStd 只允许本批原生特征及其基准对象，拒绝 Python 代理、Python 属性和表达式；任意插件、装配工作台及复杂既有 FCStd 不在首批范围。STEP 走 Part 原生导入。原生进程固定超时 90 秒，限制输出，取消后终止所拥有的进程组；运行目录之外禁止原生写入和网络访问。输入模型不在 Viewer 中执行。

## CAD Viewer

项目文件树经 Viewer Registry 选择 CAD Viewer。直接打开二进制/ASCII STL；Pack 输出的 FCStd/STEP 使用同名 STL 与 `*.cad-preview.json`，同时校验模型和网格 SHA-256。不含配套预览的 FCStd 会明确要求先运行 inspect/export；不含配套预览的 STEP 保留现有受限 STEP 预览。

只读实体表面显示、拖动旋转、Shift/右键拖动平移、滚轮/触控板缩放、共享缩放/Fit、全屏和 Esc；全屏保留旋转和缩放。Canvas 绘制有界三角面，最大 100000 个三角形/16 MiB 文件，无外部网络或渲染依赖。它是网格预览，不能编辑 B-rep、精确测量、选择原生特征、验证装配或替代 FreeCAD。实际 Desktop 路径在 macOS arm64 Electron 验证，其他 Viewer 平台尚未实测。

## 回归与 CI

`tests/integration/freecad-runtime.test.cjs` 用真实 FreeCAD 测试草图/拉伸/孔/布尔、FCStd 与 STEP 回读、尺寸不通过、拒绝输入与审批、State 失效、取消和历史证据。`apps/desktop/electron/cad-selftest.cjs` 从真实建模产物检查文件树→Registry→实体网格→旋转/平移/缩放/Fit/全屏/Esc/失败状态。解析器与配方边界加入四平台 Portable 回归；CAD 独立 CLI 包加入四平台打包和 Scope 检查。

macOS native CI 通过 `scripts/setup-freecad.cjs` 下载官方 arm64 DMG，校验固定 SHA-256 `071343b4abb70492b75c973f41eaf1d2528f9b9c7ea018d22a4f46ae14d27ac0`，只读挂载并把可执行路径提供给测试。原生测试缺少依赖直接失败，不以 skip 代替成功；CI 下载二进制不会进入 Pack 发行档案。
