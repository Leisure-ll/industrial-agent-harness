# Security reporting and supported execution boundary

Report a reproducible vulnerability privately through this repository's GitHub Security Advisory page (`Security` → `Report a vulnerability`) when private reporting is enabled. If that option is unavailable, contact the repository maintainer through an existing private channel. Do not put credentials, customer designs, or an exploitable private reproduction in a public issue. No private inbox address or response-time commitment is invented here.

Include the affected commit/release, operating system, relevant Pack/runtime identity, minimal reproduction, impact, and a redacted event log. Runtime logs can contain customer source, paths and tool output; review them before sharing. Scope bypasses, cross-project artifact access, unsigned Pack activation, malicious Viewer input and evidence corruption are security-relevant.

The exercised industrial execution boundary is macOS Seatbelt (`sandbox-exec`) on Apple Silicon (arm64). Every real Kimi process, including native Shell/WriteFile and child MCP processes, can write only its isolated session/scratch directories. Project files, runtime sources and industrial metadata remain read-only in that process. Industrial mutations use a host `industrial_action_call` callback; the host Runtime checks bound project/domain, current state, the Broker allowlist and caller approval, then persists Action and engineering evidence.

| Platform / path | Current behavior |
| --- | --- |
| macOS Apple Silicon protected Kimi + registered RTL Core runtime | Supported boundary; real descendant writes are tested as denied, and a real Verilator assertion/VCD run is tested through the host Runtime. |
| Intel Mac | Temporarily unsupported; excluded from desktop CI, installers and release Pack catalog targets. No installation or runtime qualification is claimed. |
| macOS legacy Domain MCP | Child process inherits the read-only boundary; direct mutations fail visibly. A provider that creates `.eda` during startup may also fail before read-only calls. Existing registered artifact inspection remains available through the host. A legacy Domain Pack is not silently promoted to the Core execution path. |
| External MCP host services / Computer Use | Protected sessions refuse these configurations with an explicit product error. They can mutate applications outside a child-process sandbox and have not been integrated into the industrial Action/evidence boundary. |
| Linux / Windows real industrial Kimi execution | Fails before starting Kimi: no equivalent process boundary has been exercised and shipped. Source/schema/Broker-only operations do not establish runtime support. |
| Runtime executables and testbench | Trusted installed Pack code executes in the host runtime. Project RTL/testbench and runtime scripts are not a general untrusted-code containment service. Use disposable environments for untrusted projects. |

The boundary prevents native agent writes from bypassing Runtime; it does not claim complete OS isolation, secret-read protection, outbound-network isolation or a sandbox for arbitrary trusted-Pack code. Only one project Runtime may own the durable store at a time. An interrupted Action is recovered as failed with insufficient evidence, never engineering acceptance. Acceptance establishes the declared verifier's bounded claim, not a production signoff. See `doc/p0-industrial-runtime.md` for the actual exercised slice and remaining limits.
