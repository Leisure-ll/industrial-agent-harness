# Desktop UI refinement with Impeccable

2026-10-05. This change refines the existing engineering workbench using the
[Impeccable](https://impeccable.cn/#downloads) Operate and polish guidance.
The source guidance was inspected at upstream revision
`ece38d9904b8a619b3f77cab476eacad09c4fb11`; the detector used engine 0.1.11.

The desktop keeps its project/chat sidebar, conversation, and collapsible file
workspace. The changes clarify navigation selection, improve reading density,
give project creation and file browsing a direct entry, expose New chat on the
first screen of project details, and unify light/dark colors and keyboard focus.
It adds no industrial execution or verification behavior.

The [desktop design reference](../apps/desktop/DESIGN.md) records tokens,
typography, density, responsive rules, and interaction states. IBM Plex Sans is
self-hosted (45.7 kB) with its complete license and provenance retained in desktop
staging; the application makes no external font request.

## Verification scope

- Build/typecheck, architecture gates, and desktop unit tests.
- The actual Electron project-creation → project details → new chat → file tree
  → source preview path, plus light/dark contrast, local font loading, Chinese/
  English, 1440 × 900, 1250 × 800, 1000 × 720, and 1000 × 650 windows, input
  focus, Shift+Enter, and draft retention.
- Existing language and document Viewer selftests, plus parallel chat, approval,
  stop isolation, renderer restoration, and logs/resource Viewer regressions.
- Impeccable's mechanical scan of `src/App.tsx` and `src/style.css` returned no
  findings. This is a source check; visual inspection and interaction checks are
  separate evidence.
- Font license/provenance shipping through `copyDesktopNotices`.

UI selftest data is an isolated temporary RTL project. It does not run a model,
claim engineering acceptance, or modify a user's project. Local runtime checks
cover macOS arm64. Packaged installers, Windows runtime behavior, and production
release rollout are outside this change's verification scope.

Run after `pnpm build`:

```sh
pnpm --filter @industrial-agent-harness/desktop test:ui
pnpm --filter @industrial-agent-harness/desktop test:language
pnpm --filter @industrial-agent-harness/desktop test:documents
pnpm --filter @industrial-agent-harness/desktop test:parallel
pnpm --filter @industrial-agent-harness/desktop test:logs
```

Set `INDUSTRIAL_UI_SCREENSHOTS` to an output directory to retain the native
screenshots from `test:ui`.

## Native screenshots

These captures use the isolated UI selftest project, with an unsent draft and an
unmodified source file. They demonstrate the implemented shell and source
workspace, not a completed engineering run.

![Light desktop workbench](images/desktop-ui-light.png)

![Dark desktop workbench in Chinese](images/desktop-ui-dark.png)

## Message actions and product mark (2026-10-08)

Based on latest main `62c1714`, messages now provide their time and a Copy button
on hover, without clicking to reveal them. The row also appears on keyboard
focus, and remains visible on devices without hover. User controls align below
the right edge of the bubble; assistant controls align with the reply. Reserved
space prevents movement on hover. Copy shows a brief check/accessible success
message; failures show a localized retry action. Assistant copies preserve the
body's Markdown source, excluding leading reasoning and tool/interface text.
The chat approval select added in current main also uses shell theme tokens,
preventing inherited Viewer styles from giving it a dark fill in the light theme.
Its displayed text is included in native contrast checks in both themes.

User times use the stored turn creation time. New events gain host receipt
metadata through the shared ChatStore; both the stored read model and live IPC
use that field. Stream coalescing keeps the first receipt time. Older replies
without receipt metadata omit time instead of inventing one at load. This is
display metadata, not an industrial execution/verification timestamp, and it
does not change Kimi's native context or persistence.

Core identity now uses the user's supplied green mark. In response to review,
the sidebar uses a transparent derivative, and the native app icon uses balanced
inner whitespace and a rounded backing. The original PNG and built-in imagegen
edit prompts are kept in [branding](../apps/desktop/branding/README.md).
Committed PNG/ICO formats cover the sidebar, favicon, Dock/window, macOS app,
and Windows app/NSIS installer, uninstaller, and header configuration.

Verified locally on macOS arm64:

- `pnpm build`; 29 Harness core, 34 desktop, 12 SDK, 17 CLI, and 12 architecture
  tests passed.
- Native `test:messages` covers actual mouse hover, unchanged layout, exact
  system-clipboard contents, Markdown body-only copy, keyboard Enter,
  localized failure/retry, live stream timestamps, old history, chat switching,
  renderer reload, both themes/languages, 1000 × 650 layout, and local brand
  asset loading. It restores all native clipboard formats after the test.
- Existing `test:ui`, `test:language`, and `test:parallel` passed, including
  onboarding, file preview, font/contrast checks, IME, draft retention, approval,
  stop/question isolation, and concurrent renderer restoration.
- An unsigned macOS arm64 application directory was built with the custom
  1024 px ICNS icon. Its packaged `--messages-selftest` passed through the
  actual `app://viewer` renderer, including native hover and clipboard checks.
  The isolated fresh Core fixture closes the real Domain onboarding dialog
  before checking message hit targets; it installs no Domain packs.
- Impeccable context/polish guidance and one source detector scan over App,
  AgentFlow, MessageActions, and shell CSS. The scan reported one existing
  neutral Markdown blockquote border, retained as semantic quotation styling;
  it is outside the added message-control styling. Native visual checks remain
  separate from this mechanical scan.

Windows runtime and NSIS installation remain unverified in this change.
Local application builds use no production signing/notarization or rollout.

Run after `pnpm build`:

```sh
pnpm --filter @industrial-agent-harness/desktop test:messages
```

The captures below are isolated UI fixtures, not an actual model/engineering
run. Native clipboard tests never copy data from an existing user project.

![Message hover with transparent brand mark](images/desktop-message-hover-light.png)

![Dark reply hover and copied feedback](images/desktop-message-hover-dark.png)
