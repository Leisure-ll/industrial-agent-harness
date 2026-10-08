## What changed


## Module boundaries and contracts

- Architecture contract: IH-ARCH-001. Identify the owning repository/layer and any coordinated consumer change.
- State whether a frozen compatibility snapshot or adapter orchestration exception is retired. Do not add/rebaseline exceptions in a feature PR.
- For Pack/backend changes, record the immutable Pack, contract, Tool/Verifier and qualified profile identities.

## Verification

- Include `test:architecture-contract` and the relevant real-path/failure evidence.

## Platform impact

