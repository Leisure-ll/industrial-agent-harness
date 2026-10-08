---
version: 1
slug: "apps-desktop-src-app-tsx"
primary_target: "apps/desktop/src/App.tsx"
related_targets: ["apps/desktop/src/style.css"]
---

# Desktop shell redesign

Mode: Operate. Scope: desktop shell, project navigation, empty chat, composer,
conversation typography, and shell settings. Preserve existing functions, copy,
green identity, theme preference, approval and remote execution behavior.

## Direction contract

THESIS: A neutral desktop conversation workbench, following the user's supplied
2026-10-08 15:48 screenshot. Replace the blue-heavy shell and coarse type hierarchy.

OWN-WORLD: Charcoal content, slightly lighter navigation and composer surfaces,
quiet gray selection and thin icons. Light mode uses corresponding neutral whites.
System UI type at regular weight; headings and selected labels use modest medium
weight. Green is the established identity, with semantic colors reserved for state.

STORY: Select a project, describe a task, and inspect the resulting conversation
or project evidence. Keep all existing factual text and task controls.

FIRST VIEWPORT: A compact left project/chat rail and a subtly framed content area.
Empty-chat title and 680 px composer form one centered group, with existing
project/file actions below. During a conversation the same composer rests at the
bottom. The optional file workspace retains its own job and minimum-width behavior.

FORM: User-pinned desktop reference; no speculative direction tournament or new
image comp. Code follows the provided reference's type, palette, and density.
Signature: the same familiar input moves from centered arrival to ongoing chat.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
