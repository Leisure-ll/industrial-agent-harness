# Chip Pack: EDA Harness 0.6.1

This is a separate, no UI domain release. It contains the full EDA Harness MCP server (25 tools), its `eda-core` Skill, a project-bound Kimi adapter generator, and a Dockerfile for the EDA tool image. Industrial Agent Harness Desktop and CLI now register it through their shared scoped gateway; standalone usage remains supported.

## Linux single-command install

A public preview installer includes the Chip-only CLI archive with the native Linux UID/GID fix. On native x86-64 Linux, download and run the complete entry point:

```bash
wget -O install-chip-linux.sh https://github.com/Zhiman-BJ/industrial-agent-harness/releases/download/chip-linux-installer-v0.1.0-preview.1/install-chip-linux.sh && bash install-chip-linux.sh
```

The host needs bash, wget, tar, sha256sum, awk and flock. On Ubuntu 22.04/24.04/26.04 or Debian 12/13 systemd hosts, the entry point installs missing curl and Docker Engine from official apt repositories, requesting sudo when needed. An accessible existing Docker is reused without upgrading it. Conflicting containerd/runc or Docker distribution packages are rejected rather than removed. If the local Docker socket requires group access, the intended user is added to the docker group and a private `sg docker` helper also works within the current login session. Run the entry point as the intended user; do not prepend sudo to the whole installer.

The entry point checks the downloaded self-extracting installer's SHA-256 before any system provisioning. The installer verifies its bundled archive and pinned official Node 24.12.0 / uv 0.11.6 downloads, installs private Python 3.13 and Kimi CLI 1.51.0 environments, checks the real 25-tool MCP, builds the fixed native EDA image, checks its inventory and creates `~/.local/bin/industrial-harness-chip`. Missing Docker Buildx is installed privately for a local Unix-socket daemon. System Node/Python, shell profiles, model credentials and projects are unchanged. Default package/runtime directory is `~/.local/share/industrial-harness/chip-linux-20261004`, with `install-receipt.json` and logs. Repeated installation reuses this managed directory; unmanaged directories/launchers and a different existing package are rejected. The first image build downloads large upstream images.

Use `--prefix /absolute/path --bin-dir /absolute/bin` for another location, or `--skip-image` to install CLI/MCP without Docker or the tool image. Skipping the image does not make engineering actions ready. Set model credentials before Agent use and set project `eda.yaml` to image `eda-harness-tools:chip-linux-20261004` with `require_native: true`. Project RTL, constraints, PDK and verification rules are still required. Installation/MCP/inventory success is not engineering acceptance.

Build this local installation artifact from an already packaged Chip CLI archive:

```bash
node scripts/package-linux-chip-installer.cjs /absolute/chip-cli.tar.gz /absolute/industrial-harness-chip-linux-install.run
```

The builder rejects Chip archives lacking the Linux UID/GID fix and writes adjacent SHA-256 files and a pinned `install-chip-linux.sh` entry point. This path was exercised on Ubuntu 22.04 / x86-64 for full installation and a repeated install. The public assets and actual validation scope are recorded in [the installer release](../../releases/chip-linux-installer-v0.1.0-preview.1.md). Its payload deliberately freezes the previously tested package, whose metadata records a dirty build based on `7b1cb84`; its hash is the acceptance identity. The existing preview.5 release archive lacks this Linux patch and cannot be used as its payload. This installer covers Chip; PCB/Godot setup is separate.

## Standalone pack install

Download the `industrial-agent-harness-chip-<tag>.tar.gz` asset and matching `.sha256` file from the Chip Pack GitHub Release. Verify with `sha256sum -c` (or `shasum -a 256 -c` on macOS), then:

```bash
tar -xzf industrial-agent-harness-chip-<tag>.tar.gz
cd chip-pack
sh ./install.sh
```

Installation needs `uv`, network access to the pinned Python dependencies, and Python 3.13 managed by uv. It creates separate environments for EDA Harness 0.6.1 and Kimi CLI 1.51.0 inside this directory; it does not modify global Kimi settings. Check the live MCP surface with `./eda-harness/.venv/bin/python scripts/mcp-smoke.py`.

The archive itself contains the EDA MCP source and Skill, not prebuilt Python environments. The installer downloads Python packages, including Kimi CLI; the installed environments occupy substantially more disk space than the archive. This keeps the Release portable across supported Python platforms while preserving the EDA dependency lock.

## Bind a project to Kimi

An existing EDA project needs `eda.yaml`. To create one, first prepare the EDA tool image (below), then use `./chip-harness.sh --project /absolute/project init --top TOP`. For an existing project:

```bash
./bind-kimi.sh /absolute/project /absolute/new-adapter-dir
./.venv-kimi/bin/kimi --work-dir /absolute/project \
  --mcp-config-file /absolute/new-adapter-dir/mcp.project.json \
  --skills-dir /absolute/new-adapter-dir/kimi-code/skills \
  --prompt 'Inspect the EDA project status'
```

The adapter binds the project to the installed Python environment. Recreate it if the Chip Pack is moved or reinstalled. Model configuration and credentials are still required by Kimi. The MCP server itself can be started with `./chip-harness.sh --project /absolute/project mcp`; no model key is needed for the MCP smoke test.

## EDA executables

The 25 MCP tools are installed, but actual lint/simulation/synthesis/physical actions require Docker and the EDA tool image. Build and inspect the image from this pack:

```bash
docker build --platform linux/amd64 -f eda-harness/Dockerfile.tools -t eda-harness-tools:dev eda-harness
./chip-harness.sh --project /absolute/project tools --image eda-harness-tools:dev
./chip-harness.sh --project /absolute/project doctor --target rtl.lint
```

The image contains Verilator, Yosys, OpenROAD, KLayout, Magic, Netgen LVS, and GTKWave. Building it downloads large upstream images and may require platform emulation outside Linux/amd64. Project inputs, PDK, constraints, and acceptance rules are supplied by the project. MCP `run_action`/`run_until` submit work through EDA Harness's persistent runtime; `get_run` and acceptance evidence must be checked separately.

This patch defaults to one managed action per Docker daemon and serial compilation,
checks actual VM capacity, preserves Docker OOM/exit evidence, and confirms container
cleanup after client failure or timeout. The rebuilt image fixes the ORFS CTS LEC
callback and IHP export; Python updates alone do not fix an existing tool image.
Use `eda-harness-tools:cli-fix-20261003` for the locally validated image, or rebuild
the recipe as `:dev` before using a project configured for that tag. Structured
mapped-memory equivalence supports Yosys/EQY with bounded strategies and complete
proof requirements. Native-memory SMT remains a project-specific verified script.
Migration, scope and limits are in [runtime reliability](eda-harness/docs/runtime-reliability.md).

## Boundary with Core

Standalone EDA Harness/Kimi usage retains its own execution policy. Desktop and CLI use a project-bound scoped Gateway over this same MCP/Runtime, as documented in [Core MCP integration](../../doc/domain-mcp-integration.md). Do not register the raw 25-tool server directly with Core Kimi sessions. This connection does not complete Core's Industrial Vertical Slice or convert Core file observations into engineering verification.
