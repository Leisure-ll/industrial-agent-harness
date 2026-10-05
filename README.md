# Industrial Agent Harness

English · [简体中文](README.zh-CN.md)

[![Status: Developer Preview](https://img.shields.io/badge/status-developer%20preview-orange)](#preview-scope)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node.js: 24+](https://img.shields.io/badge/Node.js-24%2B-339933)](package.json)

**An AI workbench for engineering projects, with scoped tools and verifiable results.**

Industrial Agent Harness connects local projects, Kimi Code, professional software and engineering evidence through a desktop workbench and a headless CLI. Domain Packs provide the knowledge, tools and verification methods for each field.

> [!IMPORTANT]
> **Developer Preview.** The project is a Workbench MVP with a first persistent RTL verification path. APIs, Pack interfaces and runtime behavior are still evolving. This README describes the current source tree; published preview archives follow their own release notes.

[Quick start](#quick-start) · [Domain Packs](#domain-packs) · [Viewers](#viewers) · [Documentation](#documentation) · [License](#license)

## What you can do

- **Work from a real project.** Bind a local directory to a domain, keep multiple chats, resume sessions and inspect execution logs.
- **Load relevant knowledge and tools.** The Capability Broker progressively discloses Skills and tool schemas, then enforces the selected scope at execution.
- **Use project guidance.** Discover `.skill/`, `.skills/` and standard project Skill directories, and load project `AGENTS.md` through Kimi's native mechanism. See the [compatibility audit](doc/kimi-native-compatibility-audit.md) for remaining limitations.
- **Keep engineering evidence.** The RTL runtime records inputs, actions, artifacts, verification and checkpoints. Input changes invalidate current evidence; interrupted work remains visible after restart.
- **Inspect artifacts in the workbench.** View waveforms, netlists, layouts, KiCad designs, Godot assets and ordinary project files.
- **Automate and extend.** Use the CLI's JSON Lines events, the Node SDK or stdio JSON-RPC; build independent Domain Packs with complete Skill resources and installation integrity checks.

Kimi Code owns the agent loop, conversation history and compaction. Harness supplies project context, scoped engineering tools and evidence. A completed agent turn or a successful process exit does not establish engineering acceptance.

The first implemented industrial path is:

```mermaid
flowchart LR
    Project["Project + state"] --> Broker["Capability Broker"]
    Broker --> Agent["Kimi Code"]
    Agent --> Runtime["Scoped Domain Runtime"]
    Runtime --> Tools["Chip Pack tools"]
    Tools --> Evidence["Artifacts + verification"]
    Evidence --> State["Updated state + checkpoint"]
```

## Quick start

Use **Node.js 24+** and **pnpm 11.1.3**. Agent execution additionally requires **uv**, **Python 3.13**, the pinned Kimi CLI and a model API configuration. Protected agent execution is available on **macOS with Apple Silicon (arm64)** and **Linux x86-64 with bubblewrap**; see [preview scope](#preview-scope) before trying other platforms.

```sh
git clone https://github.com/Zhiman-BJ/industrial-agent-harness.git
cd industrial-agent-harness
npm install --global pnpm@11.1.3
pnpm install --frozen-lockfile
```

### 1. Explore the CLI without a model

```sh
pnpm cli run \
  --project-dir ./examples/chip-sobel \
  --domain chip \
  --task "Inspect netlist signals" \
  --scope-only
```

This prints the registered capability scope and disclosure trace. It needs no API key or native engineering tools, and does not execute or verify the design.

### 2. Start the desktop workbench

```sh
pnpm --filter @industrial-agent-harness/desktop setup:kimi
pnpm dev
```

Open **Settings → Model API** to configure your model, then add a local project and select its domain. Open the right-hand workspace to browse files. File previews work without a model API key.

The setup command installs **Kimi CLI 1.51.0**; the integration uses **Kimi Agent SDK 0.1.8**. Layout viewing additionally needs KLayout Python: run `pnpm --filter @industrial-agent-harness/desktop setup:layout` or set `KLAYOUT_PYTHON`.

### 3. Verify the real RTL path on macOS with Apple Silicon

After setting up Kimi above, prepare Verilator, a C++ toolchain and the Chip Python environment:

```sh
brew install verilator
(cd domain-packs/chip/eda-harness && uv sync --frozen --no-dev --python 3.13)
KIMI_EXECUTABLE="$PWD/apps/desktop/.venv-kimi/bin/kimi" \
  HARNESS_REQUIRE_CORE_NATIVE=1 pnpm run test:industrial-core
```

The tests run real RTL simulation and check assertions, waveforms, failure handling, installed Pack integrity and restart recovery. Model responses come from a controlled local provider, so these tests do not spend model API credits or measure model capability. See the [industrial runtime guide](doc/p0-industrial-runtime.md) for real-task setup and evidence boundaries.

For Linux x86-64 Chip users, the [one-command installer](releases/chip-linux-installer-v0.1.0-preview.3.md) prepares private runtimes, the protected Agent and the EDA image.

Prefer a packaged preview? Browse [GitHub Releases](https://github.com/Zhiman-BJ/industrial-agent-harness/releases) and follow that version's instructions. [Headless installation](apps/cli/README.md#github-release-安装) and [domain CLI packages](doc/domain-cli-downloads.md) cover checksums and external dependencies. Existing archives do not acquire newer source features automatically.

## Domain Packs

| Domain                                | Available in this preview                                                                                               | Dependencies and limits                                                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Chip](domain-packs/chip/README.md)   | EDA knowledge and tool registration; a persistent, declared RTL verification path; waveform, netlist and layout viewers | Python and Verilator for the Core path; other EDA flows need their own tools, images or PDKs. Broader EDA execution still needs Runtime integration.            |
| [PCB](doc/pcb-mcp-integration.md)     | KiCad viewers, scoped tool registration and external design Skill loading                                               | Full tools and Skills require an authorized, fixed PCB-bench checkout and matching KiCad environment. Private actor resources are excluded from public bundles. |
| [Godot](domain-packs/godot/README.md) | Source and asset inspection, Web Export viewing and registered native scene tools                                       | Native tools require Godot 4; Web Export needs matching export templates and the Viewer Bridge. Native write tools still need the protected Runtime path.       |
| [CAD · FreeCAD](doc/freecad-domain-pack.md) | Parametric sketches, pads, holes, boolean solids and versioned parameter/outline edits; FCStd/STEP/STL export, independent geometry readback and OCCT viewing | Requires FreeCAD 1.1.4 on macOS arm64 for native execution. Bounded native feature types; no mechanical strength or manufacturing acceptance. |

Build your own Pack with the [Pack authoring tutorial](doc/pack-authoring.md). Domain code lives in Packs; the shared Core and Broker remain independent of concrete domains. Registration, a rendered preview or a successful native smoke check does not imply a complete industrial workflow.

## Viewers

Viewers open from the active project's file tree. They share zoom, Fit and fullscreen controls and leave source files and verification results unchanged.

| Viewer                                               | Inputs                                                                                                       | Viewing features and limits                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| [Chip layout](doc/viewer-eda-reference.md)           | GDS/GDSII, OAS/OASIS                                                                                         | Viewport rendering and layer selection; requires KLayout Python.                                                               |
| [Netlist](doc/viewer-eda-reference.md)               | Yosys `write_json` output                                                                                    | netlistsvg diagrams in a worker; ordinary JSON uses the document viewer.                                                       |
| [Waveform](doc/viewer-eda-reference.md)              | VCD, FST, GHW                                                                                                | Signal and timeline inspection with bundled Surfer WASM.                                                                       |
| [KiCad](doc/kicad-viewer.md)                         | `.kicad_pcb`, `.kicad_sch` and project subsheets                                                             | Local KiCanvas layer, net and symbol inspection; read-only 2D viewing, no KiCad install required.                              |
| [Godot Web Export](doc/godot-viewer.md)              | Matching HTML/JS/WASM/PCK files                                                                              | Run, pause, step and inspect scene nodes; requires a single-threaded export with the Viewer Bridge.                            |
| [Images and sprites](doc/godot-assets-viewers.md)    | PNG/JPEG/WebP; `.sprite.json` plus images                                                                    | Pan, sampling modes, atlas selection and cropping previews; no Godot runtime required.                                         |
| [Animation](doc/godot-assets-viewers.md)             | Supported `.tres`/`.tscn` and atlas animations                                                               | Playback and frame stepping for bounded SpriteFrames/Sprite2D formats; does not run the Godot engine.                          |
| [Engineering files](doc/engineering-file-viewers.md) | Godot scenes/resources/scripts; KiCad libraries/rules; Gerber/drill; STEP/VRML and selected 3D/audio formats | Structured, manufacturing-layer and media previews; limited geometry and semantics, not an editor or manufacturing acceptance. |
| [CAD · OCCT](doc/freecad-domain-pack.md) | STL; Pack-generated FCStd/STEP with hash-checked BREP/STL and optional native sketch companions | Official OCCT 7.9.2 AIS/V3d WebGL2: shaded faces, CAD edges, X/Y/Z capped sections, an explicit Measure button for face/edge picking and BREP length/radius/area/minimum-distance measurements (separate single-object size and two-object minimum-distance modes); native sketch geometry, dimensions and constraint highlighting. Shared navigation/fullscreen; local WASM, WebGL2 required. Read-only, nominal geometry measurements without tolerance or engineering acceptance. macOS arm64 Electron verified. |
| [Documents](doc/document-viewers.md)                 | CSV/TSV, JSON, JSONL/NDJSON, Markdown, TXT/LOG                                                               | Tables, structures, record browsing and text search; bounded UTF-8 input, no formulas or embedded HTML execution.              |

Exact format lists, file limits and rendering dependencies are documented in the linked guides. New Viewer integrations must update both language READMEs and follow the [Viewer integration contract](AGENTS.md#viewer-integration-contract).

Try the [Sobel chip project](examples/chip-sobel/README.md), [LED board](examples/pcb-led/README.md), [Godot playground](examples/godot-viewer/README.md) or [document samples](examples/document-viewers/README.md). These are viewing examples; Godot Web Export must be generated separately. They are not engineering acceptance evidence.

## Documentation

| Start here                                                                                   | Details                                                                                                                             |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [Documentation index](doc/README.md)                                                         | Architecture, product decisions and module guides; most detailed documentation is currently in Chinese.                             |
| [CLI](apps/cli/README.md) · [Node SDK](doc/sdk.md)                                           | Tasks, streaming events, chat recovery, cancellation and stdio JSON-RPC.                                                            |
| [Pack authoring](doc/pack-authoring.md) · [Versioned contracts](doc/contracts-versioning.md) | Independent Pack development, resources, compatibility and canonical industrial facts.                                              |
| [Current delivery and validation](doc/harness-quality-three-tracks.md)                       | Implemented scope, exercised tests and remaining work. Historical architecture proposals are not implementation claims.             |
| [Paired evaluation baseline](doc/benchmark-baseline.md)                                      | Native Kimi/Harness comparison, frozen inputs and independent verification. Formal model success-rate and cost results are pending. |
| [Security](SECURITY.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)                      | Execution boundaries, reporting and component provenance.                                                                           |

## Development and contributions

Issues and pull requests are welcome. Include the source commit, platform, affected domain, a minimal reproduction and redacted logs. For code changes, read [AGENTS.md](AGENTS.md), keep domain behavior inside Packs and verify the relevant real execution path.

```sh
pnpm run test
pnpm run test:architecture
pnpm run test:release
pnpm run format:check
```

The [Harness CI gate](.github/workflows/ci.yml) runs shared-package and packaged CLI regressions on Linux x64/arm64, macOS arm64 and Windows x64, desktop installation on macOS/Windows, and the industrial Core path on Apple Silicon and Linux x86-64, including the actual installed Chip CLI. [CI regression coverage](doc/ci-regression.md) documents dependencies, retained evidence and explicit coverage gaps; a skipped test does not establish support. Report security issues through the process in [SECURITY.md](SECURITY.md).

## Preview scope

- **Platforms:** desktop build and first-run CI targets are macOS with Apple Silicon (arm64) and Windows x64. Intel Mac is temporarily unsupported; no Intel installers or Pack catalog targets will be published. Support can resume after installation and runtime validation on an Intel test machine. Signed installers and real upgrades still need separate acceptance.
- **Protected execution:** macOS uses Seatbelt; Linux x86-64 uses bubblewrap/seccomp and requires unprivileged user namespaces. Windows protected Agent execution remains unavailable.
- **Tool compatibility:** legacy MCP writes are blocked; enabled external MCP services and Computer Use are refused in protected sessions pending Runtime integration.
- **Engineering acceptance:** the first Core path verifies declared RTL/testbench assertions and evidence. Coverage sufficiency, physical signoff and other domains' complete workflows are pending.
- **Packaging and evaluation:** local unsigned desktop checks and controlled model fixtures are documented. Signed releases, end-to-end cross-platform qualification and formal paid model comparisons remain separate work.

See the [validation record](doc/harness-quality-three-tracks.md) for exact tested versions and results.

## License

Project-owned contributions are licensed under the **[MIT License](LICENSE)**, including the authorized EDA Harness and EDA Harness demo code.

Bundled renderers, fonts, dependencies and separately installed tools retain their own licenses. The complete distribution is not MIT-only; consult [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the relevant provenance records. External private PCB resources are not granted a public license by this repository.
