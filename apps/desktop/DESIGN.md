---
name: "Industrial Harness desktop"
description: "A neutral desktop conversation workbench with compact system type and a persistent project context."
colors:
  light-bg: "#fafafa"
  light-panel: "#f2f2f2"
  light-raised: "#ffffff"
  light-border: "#dedede"
  light-control-border: "#b5b5b5"
  light-text: "#252525"
  light-muted: "#686868"
  light-hover: "#e8e8e8"
  light-active: "#e9e9e9"
  light-accent: "#343434"
  light-code: "#f3f3f3"
  light-sidebar: "#eeeeee"
  light-sidebar-hover: "#e3e3e3"
  light-sidebar-active: "#dedede"
  light-success: "#317357"
  light-danger: "#b13939"
  light-warning: "#96631e"
  dark-bg: "#161616"
  dark-panel: "#222222"
  dark-raised: "#282828"
  dark-border: "#3a3a3a"
  dark-control-border: "#707070"
  dark-text: "#dedede"
  dark-muted: "#a1a1a1"
  dark-hover: "#343434"
  dark-active: "#333333"
  dark-accent: "#dedede"
  dark-code: "#202020"
  dark-sidebar: "#282828"
  dark-sidebar-hover: "#343434"
  dark-sidebar-active: "#3d3d3d"
  dark-success: "#85d0ae"
  dark-danger: "#f19b9b"
  dark-warning: "#edc580"
typography:
  welcome:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'IBM Plex Sans', sans-serif"
    fontSize: "26px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  project-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'IBM Plex Sans', sans-serif"
    fontSize: "30px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.03em"
  dialog-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'IBM Plex Sans', sans-serif"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.5
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'IBM Plex Sans', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  conversation:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'IBM Plex Sans', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'IBM Plex Sans', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  metadata:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'IBM Plex Sans', sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
  domain-status:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'IBM Plex Sans', sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: "16px"
  source:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  inline-code: "4px"
  control: "6px"
  approval: "7px"
  secondary: "8px"
  send: "9px"
  popover: "12px"
  composer-body: "13px"
  surface: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  inset: "14px"
  lg: "16px"
  xl: "20px"
  section: "24px"
  canvas: "32px"
components:
  button-primary:
    backgroundColor: "{colors.light-accent}"
    textColor: "{colors.light-bg}"
    rounded: "{rounded.control}"
    typography: "{typography.label}"
    padding: "10px 14px"
  button-primary-dark:
    backgroundColor: "{colors.dark-accent}"
    textColor: "{colors.dark-bg}"
    rounded: "{rounded.control}"
    typography: "{typography.label}"
    padding: "10px 14px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.light-muted}"
    rounded: "{rounded.secondary}"
    typography: "{typography.label}"
    padding: "5px 10px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.light-muted}"
    rounded: "{rounded.control}"
    padding: "7px"
    size: "32px"
  button-send:
    backgroundColor: "{colors.light-accent}"
    textColor: "{colors.light-bg}"
    rounded: "{rounded.send}"
    padding: "7px"
    size: "34px"
  composer:
    backgroundColor: "{colors.light-panel}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.surface}"
    typography: "{typography.conversation}"
    padding: "0"
  composer-body:
    backgroundColor: "{colors.light-raised}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.composer-body}"
    typography: "{typography.conversation}"
    padding: "14px"
  navigation-chat-active:
    backgroundColor: "{colors.light-sidebar-active}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.control}"
    typography: "{typography.label}"
    padding: "7px 10px"
  domain-pill:
    backgroundColor: "{colors.light-raised}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.pill}"
    typography: "{typography.domain-status}"
    padding: "5px 9px"
  approval:
    backgroundColor: "transparent"
    textColor: "{colors.light-text}"
    rounded: "{rounded.approval}"
    padding: "12px"
  user-message:
    backgroundColor: "{colors.light-active}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.surface}"
    typography: "{typography.conversation}"
    padding: "10px 14px"
  message-copy:
    backgroundColor: "{colors.light-panel}"
    textColor: "{colors.light-muted}"
    rounded: "{rounded.popover}"
    padding: "0"
    size: "32px"
---

# Design System: Industrial Harness desktop

## Overview

**Creative North Star: "Neutral desktop conversation workbench"**

The user's desktop reference replaces the former blue shell. Charcoal content, slightly lighter navigation and input surfaces, fine system type, and quiet gray selection keep attention on the current project and conversation. Light mode uses the same hierarchy in neutral whites. The user's saved theme preference continues to determine the active theme.

This records the implemented shell in [style.css](src/style.css), [App.tsx](src/App.tsx), and [MessageActions.tsx](src/components/MessageActions.tsx), under the approved [surface direction](.impeccable/surfaces/apps-desktop-src-app-tsx.md). [PRODUCT.md](../../PRODUCT.md) supplies the retained green Core identity and functional constraints. Pack-supplied domain markers remain functional metadata.

**Key Characteristics:**

- Neutral paired themes with tonal panel separation.
- Regular system type, compact conversation rhythm, and restrained medium headings.
- Thin Lucide controls and quiet gray navigation selection.
- One composer centered on arrival and anchored below an ongoing conversation.
- Hover and keyboard message controls with reserved space.

## Colors

The frontmatter mirrors the actual `--ia-*` semantic colors; its `light-` and `dark-` prefixes identify the two implemented theme values.

### Primary

The neutral accent controls filled primary actions, Send, caret, and keyboard focus. It reverses against the conversation background in dark mode. The green Core mark is a retained raster identity asset, not a new control color; use its existing [runtime assets](public/README.md) and [provenance](branding/README.md).

### Neutral

Conversation background, panel, raised surface, and sidebar form the ground. Text and muted text supply hierarchy; border separates surfaces, while control-border supplies stronger form and scrollbar definition. Hover, active, sidebar-hover, and sidebar-active distinguish interaction and selection. Code uses its own quiet surface. Success, danger, and warning are semantic state colors; they do not color the general shell.

**The Paired Theme Rule.** Resolve foreground, surface, and selection from the same active theme. Preserve the saved theme preference.

## Typography

**Body Font:** the platform system UI stack in the frontmatter.
**Label/Mono Font:** labels share the system stack; source previews use the recorded monospace stack. IBM Plex Sans remains a bundled, licensed Latin fallback; it follows platform families in the actual CSS rather than serving as the primary macOS face.

**Character:** Fine, regular text and modest medium headings match the desktop reference. There is no separate display face. Tabular numerals support times and numeric readouts.

### Hierarchy

- **Welcome:** the recorded welcome role; below a 440 px chat container its size becomes 22 px.
- **Project / dialog titles:** the separate recorded roles, used on project details and model dialogs.
- **Conversation:** user messages, assistant prose, and composer input use the conversation role.
- **Labels / metadata:** navigation and message time use label; status hints use metadata and domain pills use domain-status. Compact settings and diagnostics retain smaller 10 px text.
- **Markdown headings:** 20 / 17 / 15 / 13 px, medium weight (500), with line height (1.4). Heading margins are 1.1em above and 0.45em below; paragraphs use 0.6em vertical margins.
- **Source:** the recorded source role. Tool output and Markdown code remain monospace.

**The Quiet Hierarchy Rule.** Use regular weight (400) for conversation and chat labels, and medium weight (500) for established headings and project names.

## Layout

The shell retains project/chat navigation, conversation, and an optional file workspace. Settings stays at the lower left. Workspace and file tree start closed; both outer panels remain collapsible. The chat surface has a thin border and rounded outer edge inside a 6 px shell inset. Opening the workspace squares the chat's adjoining right edge.

The sidebar is 256 px wide, becoming 220 px at 1250 px viewport width and 204 px at 1050 px. Shared headers are 48 px. Conversation and composer use a 680 px target measure with at least 24 px horizontal padding; compact viewports use 20 px. The empty title, introduction, and composer form a centered group, with existing project/file actions below. After a turn exists, the scrolling conversation grows and the composer sits at the bottom.

The workspace defaults to 48% of available width, with a 360 px minimum; at 1250 px its minimum is 340 px, and at 1050 px its default basis is 45%. Its file tree steps from 176 to 148 to 136 px. User-resized workspace width is retained. Workspace controls can wrap, and project paths truncate or wrap in their established contexts.

Below a 560 px chat container, hide the visual keyboard hint while retaining the accessible input description. Below 440 px, reduce the composer body inset to 12 px and the empty-state action margin above to 12 px. The native window minimum remains 1000 × 650; the renderer's 880 px CSS floor is not a supported native window size.

Current native captures and local visual coverage are macOS arm64 in both themes, Chinese/English, and empty/chat/workspace states. These UI fixtures do not establish engineering acceptance. See [UI verification](../../doc/desktop-ui-refinement.md), [CI coverage](../../doc/ci-regression.md), and [Desktop preview limits](README.md) for broader platform and packaged-runtime scope.

## Elevation & Depth

The resting shell and composer are flat. Tone, thin rules, and selected fills provide separation. Overlays alone use diffuse shadows: Settings (`0 12px 32px #00000026`), model dialogs (`0 16px 56px #00000033`), and agent logs (`0 20px 70px #0005`). The sidecar records these extensions.

**The Flat Shell Rule.** Keep ordinary navigation, messages, and the composer free of added shadows; use the existing overlay shadows for floating surfaces.

## Shapes

Small controls use the control radius; message bubbles, composer, chat frame, and major dialogs use the surface radius. The composer body has its own inset corner. Domain pills are fully rounded. Thin borders and flexible rectangular panels define the workbench; there are no decorative icon tiles.

Lucide shell icons inherit a thin stroke (1.6). Most control icons are 13–18 px inside 32 px targets; Send is 34 px. The sidebar Core mark is 22 px. Domain markers retain their Pack-supplied meaning rather than becoming shell decoration.

## Components

### Buttons

Primary project actions use neutral accent against the background. Send uses an upward Lucide arrow and its dedicated shape; hover lowers opacity to 0.82. Other primary project actions lower opacity to 0.85. Empty-state secondary actions use transparent fill, a thin border, and muted labels. Ghost controls gain the hover surface. Disabled shell buttons use opacity (0.42).

Keyboard focus uses a 2 px accent outline; inputs and summaries offset it by 3 px, while buttons and selects use 2 px. Button state changes are immediate, preventing mixed colors during theme switches.

### Inputs / Fields

The composer uses panel tone around a raised body, with a thin border. Empty sessions include a project strip above that body. Input starts at 64 px high, resizes between 50 and 160 px, and uses the conversation role. Focus-within adds an accent border and 1 px outline offset by 3 px. Border motion is 160 ms with `cubic-bezier(0.16, 1, 0.3, 1)`; reduced motion disables it.

Preserve Enter to send, Shift+Enter for a line, IME composition handling, and the accessible help text. Availability follows actual project/domain, task, image-input, and remote readiness. The approval selector stays explicit.

### Navigation

Project names sit above read-only domain metadata. The active project uses sidebar-hover tone; the current chat uses sidebar-active tone. Other chat rows remain quiet at regular weight. Nested chats retain a fine vertical rule. Deletion controls appear on row hover or keyboard focus. Names truncate without pushing out controls, and the sidebar brand may wrap at compact widths.

### Chips / Containers

The domain pill is read-only status, with a thin border, raised fill, and Pack marker or Lucide fallback. Domain selection occurs in its existing creation or project-detail controls. Approvals and questions use compact bordered containers with a 12 px inset; required actions stay visible. Thinking and tool entries retain their existing collapsed presentation and explicit states.

### Messages and Copy

User bubbles align right; assistant replies sit directly on the conversation ground. Each message reserves a 32 px metadata row with 2 px top margin, so revealing time and Copy does not move content. Hover and focus-within reveal it; devices without hover keep it visible. Copy has an accessible name, a temporary success check, a live status announcement, and localized error text.

Time is 24-hour local display with a full date/time tooltip when a valid recorded time exists; old replies without recorded time omit it. Copy retains the selected message body, preserving assistant Markdown while excluding leading thinking, tool output, and UI labels. These are display controls, not verification facts.

## Do's and Don'ts

### Do:

- **Do** resolve colors through the active shell theme and preserve the saved preference.
- **Do** keep conversation and input at 13 px / 1.6, with regular weight.
- **Do** retain the green Core raster and functional Pack domain markers.
- **Do** keep time and Copy available on hover, keyboard focus, and non-hover devices without layout movement.
- **Do** preserve actual task, remote, approval, and read-only Viewer boundaries.

### Don't:

- **Don't** restore the discarded blue shell or a coarse, heavy conversation hierarchy.
- **Don't** add shadows or decorative icon tiles to resting shell surfaces.
- **Don't** make domain status in the generic composer an editable selector.
- **Don't** infer readiness, approval, timestamps, or engineering acceptance from visual presentation.

The existing uppercase navigation section labels, specialized Viewer controls, and log-specific styles are not new general typography or icon rules. This record leaves their implementation in place and does not promote them as patterns for new shell surfaces.
