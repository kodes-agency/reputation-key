# Beta Quality Completion Program

**Program code:** BQC  
**Status:** Proposed — ready for implementation sequencing  
**Created:** 2026-07-17  
**Target:** evidence-backed internal beta with real, allowlisted properties  
**Capacity model:** 5,000 properties and 500,000 new reviews/month  
**Regional model:** property-owned routing with no silent fallback  
**AI posture:** Phase 17/18 remains dark until BQC acceptance

## Purpose

This program closes every finding in the [2026-07-16 BQR implementation validation](../bqr-implementation-validation-report-2026-07-16.md), plus findings discovered while executing BQC, and raises the repository's engineering standard before the real-property pilot.

The existing BQR plans remain useful historical records of intent and implementation. BQC is the authoritative **completion plan** for the gaps that remain after those changes. It does not retroactively rewrite merge history or accepted ADRs.

## Live status (authoritative)

- **Machine source of truth:** [`status/bqc-status.json`](status/bqc-status.json)
- **Generated human view:** [`STATUS.md`](STATUS.md) (`pnpm bqc:generate-status`)
- **Validate:** `pnpm bqc:validate-status`
- Historical BQR phase docs are **not** live completion status.

## Reading order

1. [Master plan](master-plan.md)
2. [Execution ownership model](execution-ownership-model.md)
3. [Finding traceability matrix](finding-traceability-matrix.md)
4. [BQC-0 — truthful rebaseline and containment](phase-bqc0-truth-and-containment.md)
5. [BQC-1 — Google source-data governance](phase-bqc1-source-data-governance.md)
6. [BQC-2 — authoritative authorization and capabilities](phase-bqc2-authorization-and-capabilities.md)
7. [BQC-3 — durable commands, consumers, and jobs](phase-bqc3-durable-runtime.md)
8. [BQC-4 — enforced regional execution](phase-bqc4-regional-execution.md)
9. [BQC-5 — clean architecture and context quality](phase-bqc5-architecture-and-context-quality.md)
10. [BQC-6 — trustworthy verification and experience gates](phase-bqc6-verification-and-experience.md)
11. [BQC-7 — production operations, security, and observability](phase-bqc7-operations-security-observability.md)
12. [BQC-8 — scale, recovery, and release evidence](phase-bqc8-scale-recovery-release.md)
13. [BQC-9 — controlled pilot and AI-readiness handoff](phase-bqc9-pilot-and-handoff.md)

## Phase summary

| Phase | Outcome                                                                        |                                   Estimate | Hard dependencies                                  |
| ----- | ------------------------------------------------------------------------------ | -----------------------------------------: | -------------------------------------------------- |
| BQC-0 | One truthful baseline; unsafe controls closed                                  |                                   2–3 days | None                                               |
| BQC-1 | Raw Google content refreshes or disappears everywhere                          |                                  8–12 days | BQC-0                                              |
| BQC-2 | One fail-closed policy module, persisted grants, and interactive cutover       |                                  7–10 days | BQC-0                                              |
| BQC-3 | Atomic runtime plus delayed execution-policy integration                       |                                 13–19 days | BQC-0; BQC-1 contracts; BQC-2 policy interface     |
| BQC-4 | Property region controls actual execution resources                            |                                   6–9 days | BQC-1, BQC-2; selected BQC-3 runtime primitives    |
| BQC-5 | Architecture guardrails plus residual non-runtime context cleanup              |                                  8–13 days | Early guardrails after BQC-0; residual after BQC-4 |
| BQC-6 | Hermetic harness plus promotion of existing behavior into blocking gates       |                                  7–11 days | Minimum harness after BQC-0; promotion after BQC-5 |
| BQC-7 | Deployable topology, private diagnostics, security gates, alerts, and runbooks |                                  8–13 days | BQC-3 through BQC-6                                |
| BQC-8 | Target-scale, fault, restore, and immutable release evidence pass              |                                  6–10 days | BQC-6 and BQC-7                                    |
| BQC-9 | Staged real-property pilot accepted; Phase 17/18 receives a clean baseline     | 3–5 engineering days plus 14 observed days | BQC-0 through BQC-8                                |

## Status vocabulary

Every phase and slice uses exactly one of these states:

- `not_started`
- `implementation_in_progress`
- `implementation_complete`
- `evidence_pending`
- `accepted`
- `blocked` — only with an identified external dependency, owner, and next review date

`Merged`, `code complete`, and `docs complete` are evidence fields, not completion states.

## Stop-lines

- Synthetic/disposable data only until BQC-1 through BQC-8 are accepted for one immutable release candidate.
- Durable dispatch remains off until BQC-3 is accepted.
- No dark capability may be opened for convenience during another phase.
- No real European property is admitted until the Europe execution cell passes BQC-4 and the privacy/data-flow review.
- Phase 17/18 implementation remains disabled until BQC-9 hands off an accepted baseline.

## Supporting evidence

- [Implementation validation report](../bqr-implementation-validation-report-2026-07-16.md)
- [BQR validation primary sources](../bqr-validation-primary-sources-2026-07-16.md)
- [Google response and disposition](../../google-business-profile-ai-policy-response-2026-07-14.md)
- [ADR 0030 — identifier-only events](../../../adr/0030-identifier-only-domain-events-and-outbox.md)
- [ADR 0031 — Google source content and AI boundary](../../../adr/0031-google-source-content-and-ai-processing-boundary.md)
- [ADR 0032 — beta capabilities](../../../adr/0032-beta-capability-and-cohort-controls.md)
- [ADR 0033 — authorization policy](../../../adr/0033-authorization-policy.md)
