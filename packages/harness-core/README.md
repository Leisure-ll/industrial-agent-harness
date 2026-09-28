# Harness core

Shared project-domain Broker resolution and resource enablement policy for Desktop and CLI. Global defaults and project overrides store only stable resource IDs; an absent project override inherits the global default. Scope and capability detail use the same effective disabled lists before Kimi materializes Skills or selects scoped MCP providers.

`ResourceSettings` reads and atomically writes `~/.industrial-agent-harness/resource-settings.json` (0600), or the directory supplied by `INDUSTRIAL_HARNESS_CONFIG_DIR`. Projects are keyed by their canonical filesystem directory. Legacy desktop disabled IDs migrate once to explicit project overrides. Corrupt settings fail explicitly rather than silently replacing policy. This package does not implement an agent loop, industrial execution, or MCP Gateway.
