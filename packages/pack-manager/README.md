# Domain Pack Manager

Shared installation store for Desktop and CLI. It verifies Ed25519 signed HTTPS catalogs,
archive SHA-256, every file and required Skill/provider/runtime entry before atomically activating
a Domain version. A task lease prevents changing or removing a Domain while in use. Failed,
corrupt and unsupported updates preserve the previous active version.

New installs retain an integrity receipt; scanning checks the complete resource inventory,
content hashes and ordinary file boundaries, isolating damaged Domains. Older API 1 installs
without receipts remain readable and receive a receipt on reinstall. The local owner can edit
both the store and receipts; these checks detect damaged resources, not a malicious local owner.

`INDUSTRIAL_HARNESS_PACK_STORE` overrides `~/.industrial-agent-harness/packs`.
`scripts/build-domain-packs.cjs` builds the repository-owned public bundles, including license
materials. PCB's private source and complete Skill remain external; the public bridge records
fixed resource provenance and loads authorized local resources only when selected.
Production catalogs require `HARNESS_PACK_SIGNING_KEY_FILE` and `HARNESS_PACK_SIGNING_KEY_ID`.

Installation does not execute archive scripts. Registered runtime modules execute later as
trusted code, through shared runtime execution and verification boundaries. Broker disclosure
and archive signatures do not provide a generic sandbox for arbitrary third-party code.

See [Pack format](../../doc/domain-pack.md) and the [independent authoring tutorial](../../doc/pack-authoring.md).
The owned `examples/review-pack` demonstrates dynamic Skill-only installation without changing Core.
Validation: `node scripts/check-pack-release.cjs`.
