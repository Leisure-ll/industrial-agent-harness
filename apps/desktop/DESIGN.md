# Industrial Harness desktop design

This documents the implemented desktop shell in `src/style.css`. It refines the
existing blue sidebar and three work areas using Impeccable's Operate and polish
guidance. It is a working engineering product: navigation, task state, and readable
project content lead the interface.

## Work areas

Project/chat sidebar | agent conversation | file workspace. Settings remains at
the lower left. The workspace and its file tree start closed, and both side
panels remain collapsible. Project/domain configuration stays on project details;
the composer shows the session domain as read-only metadata.

Project rows put the folder name above its domain. The current chat has its own
selection fill. Other chats stay quiet. The welcome view provides project
creation when no project is selected; otherwise it links to project details and
the current project's files. Project details exposes New chat above its resource
settings.

## Palette

| Token | Light | Dark | Purpose |
| --- | --- | --- | --- |
| `--ia-bg` | `#fbfcfd` | `#161f26` | Conversation and source canvas |
| `--ia-panel` | `#f1f5f8` | `#1d2933` | Secondary work surfaces |
| `--ia-raised` | `#ffffff` | `#202e39` | Inputs and dialogs |
| `--ia-sidebar` | `#eaf1f6` | `#1d2c37` | Project navigation |
| `--ia-text` | `#223441` | `#e6eef4` | Primary text |
| `--ia-muted` | `#5c707f` | `#a6bac8` | Secondary text |
| `--ia-accent` | `#315f7e` | `#b4d5ec` | Primary actions and keyboard focus |
| `--ia-active` | `#dce9f2` | `#314c60` | Selection and user messages |
| `--ia-danger` | `#b13939` | `#f19b9b` | Error text |
| `--ia-success` | `#317357` | `#85d0ae` | Completion text |

Use the semantic tokens instead of one-off theme colors. Select text and its
background from the same theme. Body and selected text must meet 4.5:1 contrast.
Theme changes are immediate; shared Viewer button transitions are disabled in the
shell to avoid briefly mixing light fills with dark-theme text.

## Type and density

The locally bundled IBM Plex Sans variable font supplies Latin type. Chinese
uses platform fallbacks. Source text remains monospace. The core scale is 11 px
metadata, 12 px controls/tool summaries, 14 px conversation and input, and 26–34 px
welcome titles. Headings use medium weight and modest negative tracking. Paths
and data use tabular numerals where applicable.

Headers are 56 px, icon targets at least 32 px, and the conversation measure tops
out at 720 px. Composer radius is 14 px with a visible border; dialogs use a soft
offset shadow. Separate work areas with thin rules, and use spacing within
content instead of extra cards or decorative icon tiles.

## Interaction and window size

Buttons have explicit accessible names, and toggles expose pressed/expanded
state. The composer uses a focus-within outline, an upward Send icon, and a
localized keyboard hint: Enter sends; Shift+Enter adds a line. It is disabled
until a project domain is selected. Readiness text follows actual agent status.

The native minimum remains 1000 × 650. At 1250 px and 1050 px the sidebar and
file tree become narrower. Workspace controls may wrap rather than clip. The
composer hides its visual keyboard hint below 560 px of available column width,
while its accessible description remains present. The settings popover scrolls
within the window. Reduced-motion preferences disable the composer transition.

## Verification

`pnpm --filter @industrial-agent-harness/desktop test:ui` runs the built renderer
through its real Electron preload/IPC, using an isolated temporary project and
user directory. It checks project creation, source preview, theme contrast,
local font loading, languages, compact panel bounds, visible controls, keyboard
input, and draft retention. `test:language` and `test:documents` retain the
existing language and Viewer regression coverage. Current local verification is
macOS arm64; other platforms need their own runtime acceptance.
