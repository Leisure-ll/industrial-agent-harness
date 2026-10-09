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

The installation UI test uses a signed local fixture feed, real IPC/Pack installation and a tiny locally signed app to exercise states, cancellation, retry and repair. It is transport and UI evidence, not domain qualification. The packaged domain smoke prepares the actual owner-declared native tools on macOS. The existing installed PCB/Godot tests require independent production CLI/Desktop payloads, real native reports and independent verification; they do not fall back to development sources. CAD's DMG gate verifies real build/edit, independent geometry checks, viewer, repair and restart.

Optional `HARNESS_RUNTIME_ARCHIVES` maps runtime asset IDs to exact official archives for qualification. The helper only populates the archive cache; production hash, archive, signature and version checks still execute. No runtime path or receipt override is used. Cached tests do not establish network download throughput.

## Release boundary

This candidate is a local unsigned installer. The current account has no Developer ID signing identity and the repository has no release signing secrets configured. Public Gatekeeper acceptance, the signed online Pack channel and actual Core OTA therefore remain separate release requirements. The existing release workflow fails without matching Pack keys and code-signing/notarization credentials; its Pack build now installs the pinned consumer dependency before creating the catalog. No keys or private credentials belong in source.

Windows retains its existing build/first-run scope. These changes do not qualify native CAD/PCB/Godot on Windows, Linux or Intel Mac. Native project success, failure, recovery and historical evidence remain governed by each domain's declared profile.
