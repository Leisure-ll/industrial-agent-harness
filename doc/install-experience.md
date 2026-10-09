# Installation experience

The 1.0.1-beta.1 local desktop candidate addresses issue #60 on macOS Apple Silicon. It consumes Domain Packs 0.4.1 at immutable commit `07437f707c26c9cbbfbc5355d63c84d2e55d8793`; the lockfile binds the archive integrity. Domain dependencies remain maintained by the Pack owner. The Core contains the generic installer, catalog, readiness descriptions and a small durable installation status record shared by CLI and Desktop.

## User flow

1. Copy the application from the DMG and open it. The list shows all five declared domains. Choose one or more optional domains: Chip, PCB, Godot and CAD are available from bundled Pack archives, even without an online directory. CUDA remains visible with its actual remote-service prerequisites and unavailable desktop-package status; it is not silently hidden or claimed ready.
2. Review the download and disk-space estimate. CAD prepares FreeCAD 1.1.4; PCB prepares KiCad 10.0.6 and its included Python; Godot prepares 4.7.2. Applications live in the user Pack store and do not replace applications the user installed elsewhere. Chip retains explicit Python, compiler and EDA/PDK prerequisites. CUDA remains a configured remote developer integration without a qualified desktop bundle.
3. Preparation reports disk checking, downloading, archive verification, opening/extraction, copying, version/signature checks and activation. Download speed and remaining time appear only when measurable. The installer checks actual free space before writes and reuses archives only after validating their full hash.
4. Completion shows each domain's actual readiness and links to existing model setup and project creation. A Pack may be installed while its external tools still need setup. A model connection is a separate prerequisite. Native tool readiness is not an engineering Verification.
5. Use the capability center to add, update or repair domains. First-run cancellation/close waits for cleanup. A status receipt reports completed, cancelled, failed or interrupted preparation after reopening. Completed domains remain installed if a later selected domain fails. Removal shares the cross-process installation lock. Preparation started in another process stays observable through polling; its cancellation is controlled by that process. Existing project domain bindings do not change.

The catalog explicitly distinguishes unconfigured, unchecked, connected and unavailable states. An unavailable remote catalog retains compatible bundled choices; it never produces a claim that every possible domain is installed. Only authenticated remote entries or Core-owned bundled entries can be installed. Normal checks cannot downgrade installed versions. Both adapters use the same catalog and installed-readiness descriptions; the CLI additionally exposes runtime receipts in `domains list`.

## Qualification commands

```sh
pnpm install --frozen-lockfile
pnpm test:architecture
node scripts/ci-tests.cjs portable
node apps/desktop/scripts/test-install-experience.cjs
pnpm --filter @industrial-agent-harness/desktop build
node scripts/stage-desktop.cjs dist/desktop-stage-local
apps/desktop/node_modules/.bin/electron-builder --projectDir dist/desktop-stage-local --config "$PWD/electron-builder.config.cjs" --mac dmg --arm64 --publish never
node scripts/smoke-packaged-desktop.cjs
node scripts/smoke-packaged-desktop.cjs --domains
node scripts/smoke-packaged-cad.cjs dist/ci-reports/cad-install --dmg
```

For an actual old-to-new application replacement, supply an existing 1.0.0 application and the exact new DMG. The gate creates an isolated profile and Pack store, prepares real CAD history in the old application, replaces the application at the same path, upgrades the bundled CAD Pack, and compares persisted files and logical SQLite records:

```sh
node scripts/smoke-install-upgrade.cjs \
  --old-app "/path/to/1.0.0/Industrial Agent Harness.app" \
  --new-dmg "dist/desktop-release/Industrial Agent Harness-1.0.1-beta.1-arm64.dmg" \
  --evidence dist/ci-reports/install-upgrade \
  --archive /path/to/FreeCAD_1.1.4-macOS-arm64-py311.dmg
```

`--prepare` and `--upgrade` run those stages separately. `--capture-existing` can inspect and preserve a completed old-app engineering baseline after a later legacy selftest failure; it does not turn that failure into a full acceptance pass. `--recheck-final` replaces a previously upgraded application with a final candidate and checks restart/data preservation. It retains the original migration identity and does not claim a second Pack upgrade.

The installation UI test uses a signed local fixture feed, real IPC/Pack installation and a tiny locally signed app to exercise states, cancellation, retry and repair. It is transport and UI evidence, not domain qualification. The packaged domain smoke prepares the actual owner-declared native tools on macOS. The existing installed PCB/Godot tests require independent production CLI/Desktop payloads, real native reports and independent verification; they do not fall back to development sources. CAD's DMG gate verifies real build/edit, independent geometry checks, viewer, repair and restart.

Optional `HARNESS_RUNTIME_ARCHIVES` maps runtime asset IDs to exact official archives for qualification. The helper only populates the archive cache; production hash, archive, signature and version checks still execute. No runtime path or receipt override is used. Cached tests do not establish network download throughput.

## Local qualification, 2026-10-09

The delivered Apple Silicon DMG was built from `0e63a25` (including the committed application changes and test capture fix). Its SHA-256 is `329ed76e1781ed7c1b52a79cb018858db546c2305cbe0e1f3ff4553b9b633bf2`, size 272,099,091 bytes. The following commit only refined the standalone upgrade evidence runner; it changed no packaged application code.

- The actual packaged first-run screen showed all five declared domains with four installable choices. The unconfigured online catalog retained bundled installation. Official Chip/PCB first installation and subsequent Godot installation passed on the packaged application.
- Nineteen Electron installation flows and a separate normal-quit cleanup check passed, covering light/dark/narrow layouts, cancellation, retry, repair, failed-update preservation, cross-process status, removal rejection and language switching. The design uses the existing Desktop dialog, typography, icon and control styles; the UI review also used [Impeccable](https://impeccable.cn/).
- Official FreeCAD, KiCad and Godot preparation passed full hash, archive, upstream signature and executable/version checks. Independent installed CLI/Desktop payloads passed PCB and Godot task, edit, verification, history and repair integration checks. These do not certify unexercised tasks or platforms.
- The committed portable suite passed 341 tests with one declared KLayout skip; the MCP transport suite passed 13 with one declared private PCB fixture skip. Pack Manager/CLI (40), release (17), architecture (11 + 24) and repository formatting checks passed.
- A real 1.0.0 profile with two completed CAD turns, two Actions, 25 Artifacts, two passed Verifications and three Checkpoints survived application replacement and CAD Pack `.4` → `.6`. The native application receipt/path was reused. Of 68 tracked files, 67 remained byte-identical; the changed state SQLite file retained identical logical records. Project binding, model configuration, chat database, native chat files, artifact objects and project files were preserved.
- That original migration used candidate DMG `bdfb4f420991c2b0e121e278891ee721f7e5af8763529b4e12b305f03e301788`. The final delivered DMG was then installed at the same path and passed its own restart and data-preservation checks. The old application's full legacy selftest had failed at an `UnknownVizError` screenshot after creating the engineering baseline; this remains recorded as a legacy capture failure, not a full old-app acceptance pass.

First-run screenshot acceptance now waits for a newly presented frame and stable pixels, not just DOM readiness. Both final first-run and installed-domain screenshots were visually inspected; the older stale loading-frame capture is not used as delivery evidence.

## Release boundary

This candidate is a local unsigned installer. The current account has no Developer ID signing identity and the repository has no release signing secrets configured. Public Gatekeeper acceptance, the signed online Pack channel and actual Core OTA therefore remain separate release requirements. The existing release workflow fails without matching Pack keys and code-signing/notarization credentials; its Pack build now installs the pinned consumer dependency before creating the catalog. No keys or private credentials belong in source.

Windows retains its existing build/first-run scope. These changes do not qualify native CAD/PCB/Godot on Windows, Linux or Intel Mac. Native project success, failure, recovery and historical evidence remain governed by each domain's declared profile.
