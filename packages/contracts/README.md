# Contracts

Canonical, domain-independent industrial fact schemas with Zod validation and TypeScript declarations.

Version `'1'` defines Project, Artifact, DomainState, Run, Action, Verification, Checkpoint,
ToolDescriptor and ActionRequest. Industrial writes use the strict `Industrial*` schemas.
The Runtime consumes their content identities, tool versions, evidence and metrics; the Broker
consumes DomainState without creating facts from user intent. Verification distinguishes missing
evidence from failure and never treats a successful process as engineering acceptance.

Existing Observed schemas and unversioned Action journals remain readable. Historical file
observations retain `not_run` and are not promoted into verified industrial facts.

See [versioning and compatibility](../../doc/contracts-versioning.md) for fields, migration rules,
and the difference between industrial schema version `'1'` and Pack container API version `1`.

Validation: `node --test packages/contracts/tests/*.test.cjs`.
