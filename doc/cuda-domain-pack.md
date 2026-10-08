# CUDA Domain Pack

Harness consumes the CUDA implementation from Domain Packs 0.4.0, pinned to
`d705340b5a86358ba7fda07cc95d99a1c5ccd510`. The owner supplies two distinct remote
MCP identities (Compiler and Evaluator), the optimization Skill, source client,
StateProvider and aggregate Verifier. Kimi, Broker, approvals and canonical
Actions/Artifacts/States/Checkpoints use the existing shared application path.

This is a developer configuration. Set both trusted host environment groups:
`INDUSTRIAL_HARNESS_CUDA_COMPILER_MCP_{URL,TOKEN,IDENTITY}` and
`INDUSTRIAL_HARNESS_CUDA_EVALUATOR_MCP_{URL,TOKEN,IDENTITY}`. Each IDENTITY is the
SHA-256 of that reviewed role's exact JSON identity. Use HTTPS or a loopback SSH
tunnel. Keep tokens in trusted host configuration. Bind the Project to `cuda`
and a matching `model.py` / `model_new.py` task workspace. Without both endpoints
the plugin exposes no execution tools; a changed reference, image, source release
or Verifier fails closed. The shared Runtime and Broker select the tools and Skill.

The first exercised native scope is AXPBY on RTX 4090 SM 8.9, driver 595.71.05.
Compiler receives bounded source and returns a private project-bound ticket.
Evaluator accepts that ticket and performs correctness and exclusive profiling.
The Runtime refuses stale local tickets, collects remote receipts into canonical
artifacts, and waits for durable cleanup status when cancelled. Correctness,
measurement validity and the 5% optimization target remain separate results.

The private upstream, worker image, administrator GPU allocation and credentials
are external dependencies. This release supplies no H200/task-corpus qualification,
public remote endpoint, desktop bundle or real-model optimization trajectory.
The CUDA declaration's empty qualifiedBundlePlatforms keeps automatic distribution
from advertising a package that has not been exercised.

The owner's [setup](https://github.com/Zhiman-BJ/industrial-domain-packs/blob/d705340b5a86358ba7fda07cc95d99a1c5ccd510/packs/cuda/README.md)
and [native qualification](https://github.com/Zhiman-BJ/industrial-domain-packs/blob/d705340b5a86358ba7fda07cc95d99a1c5ccd510/packs/cuda/QUALIFICATION.md)
record exact worker identities and limits. The production shared factory/Runtime and Broker exercised actual remote compilation, correctness, profiling, scope, approval, artifacts, persistent checkpoints and cancellation. The pinned consumer then repeated the complete native flow using normal release discovery, without an injected CUDA registration. Consumer regression tests cover registration, Skill materialization and both real MCP transports. Local validation passed 318 portable tests, all 24 architecture tests and all 17 release checks; source tests do not grant GPU qualification.
