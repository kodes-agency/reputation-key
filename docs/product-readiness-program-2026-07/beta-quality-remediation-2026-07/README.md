# Beta Quality Remediation Program — July 2026

**Status:** Proposed; implementation has not started  
**Purpose:** Bring the current codebase to an evidence-backed internal beta standard after the July 2026 implementation review  
**Applies before:** Any real-property pilot, Phase 17, Phase 18, or post-beta capability activation

This program corrects the gap between code that has been added and capabilities that are demonstrably working. It does not discard the useful PRE17, beta, or post-beta work. It consolidates that work behind the repository's clean-architecture rules and replaces completion-by-file-count with completion-by-runtime evidence.

## Reading order

1. [Primary-source research](primary-source-research.md)
2. [Master plan](master-plan.md)
3. [BQR-0 — contain, inventory, and rebaseline](phase-bqr0-containment-and-rebaseline.md)
4. [BQR-1 — restore architectural and schema coherence](phase-bqr1-architecture-and-schema.md)
5. [BQR-2 — durable commands, events, jobs, and external workflows](phase-bqr2-durable-runtime.md)
6. [BQR-3 — Google review lifecycle and property-region routing](phase-bqr3-review-and-region.md)
7. [BQR-4 — authorization, security, privacy, and context activation](phase-bqr4-security-and-capabilities.md)
8. [BQR-5 — experience, accessibility, performance, and test gates](phase-bqr5-experience-and-verification.md)
9. [BQR-6 — production topology, observability, recovery, and scale](phase-bqr6-operations-and-scale.md)
10. [BQR-7 — real-property pilot and beta acceptance](phase-bqr7-pilot-and-acceptance.md)

## Authority and relationship to earlier plans

- Accepted ADRs and verified production behavior remain authoritative.
- Repository `CONTEXT.md` files remain authoritative where they are internally consistent. BQR-1 resolves the current contradiction around domain errors before broad refactoring.
- This program supersedes any statement that PRE17 or internal beta is already complete. It does not replace the product intent in the existing PRE17, beta-readiness, AI-governance, or post-beta plans.
- The post-beta plans remain future product programs. Their currently unwired domain prototypes and migration must not be treated as active beta behavior.
- Google's written response remains the authority for Google-source processing, together with the conservative executable interpretation recorded in ADR 0031 and the AI-governance standards.

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
