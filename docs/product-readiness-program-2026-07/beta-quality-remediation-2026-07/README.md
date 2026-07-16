# Beta Quality Remediation Program — July 2026

**Status:** BQR-0…1 complete on main; BQR-2.1 in progress  
**Purpose:** Bring the current codebase to an evidence-backed internal beta standard after the July 2026 implementation review  
**Applies before:** Any real-property pilot, Phase 17, Phase 18, or post-beta capability activation

This program corrects the gap between code that has been added and capabilities that are demonstrably working. It does not discard the useful PRE17, beta, or post-beta work. It consolidates that work behind the repository's clean-architecture rules and replaces completion-by-file-count with completion-by-runtime evidence.

## Reading order

1. [Master plan](master-plan.md) — program outcomes, principles, phases, gates
2. [BQR-0 phase plan + exit matrix](phase-bqr0-containment-and-rebaseline.md)
3. [BQR-0 truthful baseline](bqr0-truthful-baseline.md) — inventory and open P0/P1 findings
4. [BQR-1 architecture and schema](phase-bqr1-architecture-and-schema.md)
5. [BQR-2 durable runtime](phase-bqr2-durable-runtime.md) — atomic outbox, envelope, consumers
6. Later phases (detailed docs when each phase starts): BQR-3…BQR-7

Primary-source research for this program may be added as `primary-source-research.md` when external citations are re-gathered; until then the July PRE17/beta research under the parent folder remains the reference set.

## Progress

| Phase | Status                                                                                                                                     | Notes                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| BQR-0 | **Merged** [#188](https://github.com/kodes-agency/reputation-key/pull/188)                                                                 | Outbox dispatch off; dark paths contained; baseline inventory         |
| BQR-1 | **Merged** [#189](https://github.com/kodes-agency/reputation-key/pull/189)–[#192](https://github.com/kodes-agency/reputation-key/pull/192) | Schema, errors, outbox boundaries, ADR 0030 + health schema consumers |
| BQR-2 | **2.1 in progress**                                                                                                                        | Envelope first; then consumers, atomic TX, no-op fix                  |
| BQR-3 | Not started                                                                                                                                | Source lifecycle, region routing                                      |
| BQR-4 | Not started                                                                                                                                | Authoritative authorize(), tenancy, privacy                           |
| BQR-5 | Not started                                                                                                                                | Blocking a11y/E2E/Storybook                                           |
| BQR-6 | Not started                                                                                                                                | Topology, recovery, scale proof                                       |
| BQR-7 | Not started                                                                                                                                | Real-property pilot                                                   |

## Authority and relationship to earlier plans

- Accepted ADRs and verified production behavior remain authoritative where not superseded.
- BQR master plan §4 beta capability posture supersedes ADR 0032’s listing of `portal.read` as core until ADR 0032 is revised (tracked residual in BQR-0 exit matrix).
- Repository `CONTEXT.md` files remain authoritative where internally consistent. BQR-1 resolves domain-error contradictions before broad refactoring.
- This program supersedes any statement that PRE17 or internal beta is already complete. It does not replace product intent in existing PRE17, beta-readiness, AI-governance, or post-beta plans.
- Post-beta plans remain future product programs. Unwired domain prototypes and migrations must not be treated as active beta behavior.
- Google's written response remains the authority for Google-source processing, with ADR 0031 and AI-governance standards.

## Definition of “working”

A beta capability is working only when all of the following are true:

1. Its owning context has one authoritative domain model and one authoritative persistence model.
2. The production route, use case, repository, job, consumer, schedule, and external adapter paths use that model.
3. Expected failures are represented and visible to users or operators; they are not swallowed.
4. Retry, duplicate, concurrency, restart, deployment, and dependency-outage behavior is tested at the real seam.
5. Authorization, capability, tenant, property, source-policy, and regional checks run at every applicable execution path.
6. Disabled paths are server-disabled and cannot run through a direct URL, server function, job, event, schedule, or operator command.
7. CI and staging evidence are blocking and retained with the release identity.
8. Remaining TODOs or stubs do not sit on an enabled path.

Passing unit tests, compiling an unused module, creating a migration, writing a runbook, or rendering a demo does not independently satisfy this definition.
