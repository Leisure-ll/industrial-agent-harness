# Domain Pack Manager

Shared installation store for Desktop and CLI. It verifies an Ed25519 signed HTTPS catalog, checks the archive SHA-256 and every extracted file, and atomically activates a Domain version. A task lease prevents changing or removing a Domain while it is in use. A broken installed manifest or missing Skill/provider is isolated from other Domains.

`INDUSTRIAL_HARNESS_PACK_STORE` overrides the default `~/.industrial-agent-harness/packs` store. `scripts/build-domain-packs.cjs` generates Chip, PCB and Godot archives from the current repository; production catalogs require `HARNESS_PACK_SIGNING_KEY_FILE` and `HARNESS_PACK_SIGNING_KEY_ID`.

Pack installation does not execute scripts from the archive. Domain resources continue to pass through Broker Scope and project authorization at runtime.
