# Godot game MCP and Skills

The Godot Domain Pack supplies two progressive capabilities. A scene inspection request exposes only `godot.game.project_status` and `godot.game.inspect_scene_source`, plus the `godot.game.inspect` Skill. A game development request exposes five tools and the `godot.game.develop` Skill. The Broker records `capability.resolve`, `scope.replace`, `skill.batch`, `tool.scope`, and `detail.deferred` in its trace. The MCP gateway then enforces that allowlist for both `domain_tool_describe` and `domain_tool_call`; `domain_tool_list` displays only those IDs. Global resource settings can disable the server or a Skill, and a project can override the global default.

| Tool | What it establishes | Risk |
| --- | --- | --- |
| `project_status` | `project.godot` source hash, project name, main scene, selected Godot version | Read-only |
| `inspect_scene_source` | Bounded serialized `.tscn` sections and properties | Read-only |
| `inspect_scene_runtime` | Headless instantiation, resolved node properties, sprite frames and collision shapes | Mutating: project scripts can run |
| `check_project` | Godot headless import/parse diagnostics | Mutating: imports can write files |
| `run_scene` | Bounded headless scene execution and diagnostics | Mutating: project scripts can run |

The native tools use a registered Godot 4 executable. Every mutating call first enters Domain Runtime's persistent Action journal, which records Run/Action IDs, inputs, diagnostics, an explicit artifact set and a `not_run` VerificationResult. The Godot Pack also writes a private native receipt with timestamps, exit status, bounded output and unknown artifact coverage. A successful process is never promoted to a gameplay pass. Visual or interactive acceptance still needs task-specific evidence. The gateway confines requested scene paths to the bound project, but Godot itself and project scripts are not OS-sandboxed.

The original GameDevBench diagnostic found that a sprite frame could be imported and a scene could run while the visual frame was wrong, and a HUD scene could load while its growth direction violated the requirement. These tools expose the values and native failures needed to diagnose those cases; they do not automate the benchmark's acceptance tests. Test evidence is in `tests/integration/godot-mcp-policy.test.cjs`, including a real Godot 4.4.1 import, scene inspection and bounded run. Other Godot versions and OS packaging remain to be verified.

在本机既有 GameDevBench 候选工程上，运行态场景检查读出 `task_0003` 的 `right` 动画 Atlas region 为 `(0, 0, 16, 16)`，与验收期望 `(48, 0, 16, 16)` 不符；`task_0005` 的 `ControlPanelRect.grow_vertical` 为 `0`。这两项观察对应之前的独立验收失败，但不是再次完整运行 benchmark。
