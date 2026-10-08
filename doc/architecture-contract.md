# IH-ARCH-001: Harness, Domain Packs and application boundaries

Status: accepted by the product owner on 2026-10-08. This contract governs subsequent work in Industrial Agent Harness, Industrial Domain Packs and the remote service. It supersedes instructions that continue developing domain implementations inside Harness.

## Ownership

| Owner | Responsibility |
| --- | --- |
| Industrial Agent Harness | Canonical Project/State/Run/Action/Artifact/Verification/Checkpoint contracts, generic Runtime, Broker, resource policy, shared task orchestration, Pack loading and Kimi integration |
| industrial-domain-packs | Domain StateProviders, capabilities, Skills, native tool implementations, input rules, Verifiers, dependency locks, image recipes and qualified execution profiles |
| CLI | Arguments, input/output, process signals and batch submission to the shared Harness task API |
| Desktop | User interaction, project selection, approval/question presentation and read-only evidence/Viewer presentation through the same task API |
| Execution backends | Native process/container/sandbox start, resource limits, cancellation and confirmed cleanup; remote service additionally owns authentication, snapshots, grants and bounded scheduling |
| Kimi Code | Native agent loop, conversation context, compaction, persistence and subtask lifecycle; Harness integrates the pinned upstream kernel |

CLI/Desktop are application adapters. Local/remote is an independent execution choice. MCP is a transport and disclosure interface. Pack tool CLIs are domain-level entry points; integrated engineering mutations still enter the canonical Runtime. Rendering an artifact, completing an agent turn or receiving a successful MCP/process response does not establish engineering acceptance.

Domain changes are maintained once in industrial-domain-packs. Harness consumes immutable, reviewed releases; a bundled/cache copy is never a second editable source. One manifest must bind Pack ID, version, content digest, Core contract compatibility, Tool/Verifier identity, dependencies and qualified platform/profile. A source-only archive is not an installed runtime qualification.

## Enforced now

`architecture/policy.json` declares this repository's role and bounded legacy exceptions. `node scripts/check-architecture-contract.cjs` rejects:

- New adapter-to-adapter imports, CLI dependencies on Electron/Viewer UI, or app-level industrial process execution.
- Agent/application dependencies in generic Core or in Domain Pack/backend code.
- New concrete domain IDs in generic/application code, beyond the enumerated historical occurrences.
- New adapter-local session/Broker/chat orchestration call sites beyond the recorded legacy counts.
- Edits/additions/rebaselining in the frozen Harness domain source, domain Skill/manifest copies and legacy Pack publishers. Removal is permitted for consumer migration.
- A remote service's unpinned Pack dependency, lock mismatch, local domain Verifier or edits to its canonical vendor snapshot.

The canonical checker is maintained here. Satellite copies carry the same bytes and revision, with their provenance and hashes in policy. CI uses the base branch's checker and policy when available, so editing a feature's exception ledger/checker cannot authorize that feature's violation. The architecture workflow also checks a candidate without executing its code from a trusted `pull_request_target` run after this policy is on main.

Architecture machinery is itself hash-protected. Changing the contract, checker or CI enforcement requires a separate owner-approved architecture revision, rationale, migration and passing positive/negative acceptance. Ordinary feature work cannot regenerate or expand a baseline. An administrator's deliberate policy transition must retain the approved decision and evidence; it is never an automatic fallback.

## Current migration debt

The main Harness still contains historical domain source and separate Desktop/CLI orchestration. FreeCAD fixes already verified in Harness must be reconciled into the maintained Pack before replacing those copies. The remote service retains a bounded canonical Runtime vendor patch pending upstream consumption. Frozen exceptions keep these consumers running and cannot be interpreted as completed migration.

The next implementation sequence is:

1. Reconcile verified domain fixes into the maintained repository and publish one compatible, immutable Pack identity.
2. Migrate Harness loading and packaging to that identity, retiring source-copy exceptions and legacy publishers.
3. Provide one Harness task API for prepare/start/approve/answer/cancel/resume/evidence. Desktop and CLI translate interaction into that API; neither drives the other adapter.
4. Exercise supported GUI/CLI and local/remote combinations with the same input/Pack/profile identity, checking authorization, failure, cancellation/recovery and canonical evidence. Compare domain semantics, not byte-identical logs or native run IDs.

Static gates constrain dependency direction and exception growth. Complete behavioral parity remains an integration milestone. Existing CI/native qualification gates remain required; this checker does not certify unsupported domains/platforms or model reasoning quality.

## Contributor procedure

Read this contract before implementation. Identify the owning repository and the contract/profile being changed. Changes crossing owners include coordinated consumer PRs and compatibility evidence. A rejected boundary must be resolved by moving work to its owner or an explicitly approved architecture revision. Do not disable tests, relabel source-only artifacts as qualified or enlarge legacy exceptions to make a feature pass.

Run the architecture checker and its negative regression tests before the relevant existing suites. Main branch protection must require the `Architecture contract` check and retain existing required checks. The workflow/branch rules are separate deployment layers: an unmerged PR does not activate the code contract on main.
