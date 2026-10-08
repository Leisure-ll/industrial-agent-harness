# Industrial Harness identity assets

The user supplied `product-mark-source.png` on 2026-10-08 and requested that all
Core product icons use this mark. The original 200 × 200 PNG is retained without
changes (SHA-256
`80edc0d15022f304d047992d9555ead3d3b9eb081788bb8ff4fc7855e35bcff8`).

After reviewing the first presentation, the user requested improvements to both
message controls and the icon presentation. The built-in `imagegen` tool created
two bitmap derivatives using the original as an edit target:

- `product-mark-transparent.png`: transparent-background mark for the sidebar
  and favicon, avoiding a white tile in either theme.
- `app-icon-master.png`: centered green mark on a pale rounded-square backing,
  with inner whitespace and transparent outer margins for native app packaging.

These are image-edit derivatives, not a claim of pixel-identical extraction.
The original stays available for identity comparison. Domain and tool icons
keep their functional meanings. The generator converts these selected masters
into committed runtime sizes; it never generates images during a build.

## Built-in imagegen prompts

Transparent mark:

> Use case: background-extraction. Edit target: the attached original Industrial Harness green brand mark. Remove ONLY the pure white background to genuine transparency. Keep the green mark IDENTICAL: the three diagonal angular linked ribbon segments, every edge, aperture, relative offset, flat solid green color, proportions and orientation must remain exactly as supplied. Do not redesign, reinterpret, round, thicken, simplify or add elements. Keep the same square canvas and relative size/margins as the original. No shadow, text, border, badge, glow or texture. This will be the exact mark on light and dark UI. Produce a crisp transparent PNG with clean alpha edges.

Application icon:

> Use case: compositing. Edit target: the attached exact green Industrial Harness brand mark. Create a polished flat macOS application icon by placing THIS IDENTICAL green mark centered on a plain very pale cool white rounded-square/squircle backing. The logo must remain identical to the supplied image: the three diagonal angular linked ribbon segments, every edge and aperture, proportions, orientation, offsets, and solid green color, no reinterpretation. Use an orderly 1024 square icon canvas. Rounded-square backing occupies about 82% of the full canvas, with balanced transparent outer margins. The green mark occupies about 60% of the full canvas, optically centered within the backing with generous even inner whitespace. Corner curvature should feel like a native macOS app icon, not a circular badge. Flat precise product identity. Genuine transparency outside backing. No lettering, gradients, gloss, shadows, extrusions, border, glow, extra symbols, or texture. Only improve native-icon framing; do not redesign the mark.
