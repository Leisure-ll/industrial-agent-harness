# Core product mark

These runtime assets derive from the user-supplied green Industrial Harness mark.
The unchanged original, image-edit masters, and complete built-in `imagegen`
prompts are retained in [branding](../branding/README.md).

- `product-mark.png`: 64 × 64 transparent mark used by the sidebar and favicon.
- `app-icon.png`: 1024 × 1024 rounded-square native application icon with inner
  whitespace and transparent outer margins.
- `app-icon.ico`: application/installer icon with native Windows sizes from
  16 through 256 px.

The Dock/window and native application packaging use the same application icon.
NSIS installer/uninstaller/header icons use the ICO. Domain, Viewer, tool, and
action icons retain their distinct meanings.

To regenerate the packaging formats on macOS, run
`node scripts/generate-product-icons.cjs` from the repository root. It resizes the
selected masters with native `sips` and assembles the ICO container. Committed
outputs are consumed by macOS and Windows packaging; Windows builds do not need
`sips` or image generation.
