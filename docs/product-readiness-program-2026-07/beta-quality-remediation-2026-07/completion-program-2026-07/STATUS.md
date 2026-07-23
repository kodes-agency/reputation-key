# BQC live program status

> **Generated file.** Do not edit by hand. Source: `status/bqc-status.json`.
> Regenerate: `pnpm bqc:generate-status`. Schema: `src/shared/bqc/status-schema.ts`.

**Program:** BQC  
**Manifest updated:** 2026-07-23T18:46:52Z  
**Validation report:** docs/product-readiness-program-2026-07/beta-quality-remediation-2026-07/bqr-implementation-validation-report-2026-07-16.md  
**Validation baseline SHA:** `29b021875c145a7f8827f0ee70fc20935fc5dc79`  
**Working tree SHA (status describes):** `927614bce728f8c42d922720f149b6ea1b046354`  
**Lockfile SHA-256:** `948a751d725fd8668b4ef734a28eea10392fd89890608f453998786a2b197287`  
**Migration version:** 0011_people-access-and-attribution  

BQR work is implementation history only. No BQR phase is `accepted` under BQC rules. Open findings remain from the 2026-07-16 validation report until closed by BQC evidence.

## Status vocabulary

Only these states are valid: `not_started`, `implementation_in_progress`, `implementation_complete`, `evidence_pending`, `accepted`, `blocked`.

`Merged` / `code complete` / `docs complete` are **not** completion states.

## Phases

| ID | Kind | Title | State | Owner | PR | Open findings | Blocked |
| -- | ---- | ----- | ----- | ----- | -- | ------------- | ------- |
| BQR-0 | phase | Containment and rebaseline (historical BQR) | `implementation_complete` | engineering | #188 | STD-P0-01, SPEC-P0-03 | — |
| BQR-1 | phase | Architecture and schema (historical BQR) | `implementation_complete` | engineering | #189-#192 | STD-P1-01, STD-P1-06, STD-P2-02 | — |
| BQR-2 | phase | Durable runtime (historical BQR) | `implementation_complete` | engineering | #193-#197 | STD-P0-02, SPEC-P0-01, SPEC-P1-02 | — |
| BQR-3 | phase | Source lifecycle and region (historical BQR) | `implementation_complete` | engineering | #199 | SPEC-P0-02, SPEC-P1-01 | — |
| BQR-4 | phase | Auth privacy containment (historical BQR) | `implementation_complete` | engineering | #201 | STD-P1-02, SPEC-P0-03 | — |
| BQR-5 | phase | Experience verification (historical BQR) | `implementation_complete` | engineering | #202-#204 | STD-P1-05, SPEC-P1-03 | — |
| BQR-6 | phase | Ops and scale (historical BQR) | `implementation_complete` | engineering | #205-#208 | STD-P1-04, SPEC-P1-04, SPEC-P1-05, SPEC-P1-06 | — |
| BQR-7 | phase | Pilot (historical BQR) | `blocked` | product | — | — | human pilot + real properties; BQC-0 through BQC-8 acceptance first (review 2026-08-15) |
| BQC-0 | phase | Truthful rebaseline and containment | `evidence_pending` | engineering | — | STD-P0-01, SPEC-P2-01, SPEC-P0-03 | — |
| BQC-1 | phase | Google source-data governance | `evidence_pending` | engineering | — | SPEC-P0-02, STD-P1-03 | — |
| BQC-2 | phase | Authoritative authorization and capabilities | `evidence_pending` | engineering | — | SPEC-P0-03, STD-P1-02 | — |
| BQC-3 | phase | Durable commands, consumers, and jobs | `evidence_pending` | engineering | — | STD-P0-02, SPEC-P0-01, SPEC-P1-02 | — |
| BQC-4 | phase | Enforced regional execution | `evidence_pending` | engineering | — | SPEC-P1-01 | — |
| BQC-5 | phase | Clean architecture and context quality | `implementation_in_progress` | engineering | — | STD-P1-01, STD-P1-04, STD-P1-06, STD-P2-01, STD-P2-02, STD-P2-03, STD-P2-04, STD-P2-05 | — |
| BQC-6 | phase | Trustworthy verification and experience gates | `not_started` | engineering | — | STD-P1-05, SPEC-P1-03, STD-P2-06 | — |
| BQC-7 | phase | Production operations, security, and observability | `not_started` | engineering | — | SPEC-P1-05, SPEC-P1-06, STD-P1-07 | — |
| BQC-8 | phase | Scale, recovery, and release evidence | `not_started` | engineering | — | SPEC-P1-04, SPEC-P2-02 | — |
| BQC-9 | phase | Controlled pilot and AI-readiness handoff | `blocked` | product | — | — | BQC-0 through BQC-8 accepted + human pilot authorization (review 2026-09-01) |

## Slices

| ID | Kind | Title | State | Owner | PR | Open findings | Blocked |
| -- | ---- | ----- | ----- | ----- | -- | ------------- | ------- |
| BQC-0.1 | slice | Machine-readable program status | `implementation_complete` | engineering | #209 | SPEC-P2-01 | — |
| BQC-0.2 | slice | Correct portal capability taxonomy | `implementation_complete` | engineering | — | — | — |
| BQC-0.3 | slice | Restrict test-only capability overrides | `implementation_complete` | engineering | — | — | — |
| BQC-0.4 | slice | Confirm operational stop controls | `implementation_complete` | engineering | — | — | — |
| BQC-0.5 | slice | Re-run and pin the baseline | `implementation_complete` | engineering | — | — | — |
| BQC-1.7 | slice | Disconnect/property/org purge | `implementation_complete` | engineering | — | — | — |
| BQC-1.6 | slice | Safe erasure and valid retention SQL | `implementation_complete` | engineering | — | — | — |
| BQC-1.5 | slice | Bounded refresh with progress and backpressure | `implementation_complete` | engineering | — | — | — |
| BQC-1.4 | slice | Centralize eligible reads | `implementation_complete` | engineering | — | — | — |
| BQC-1.3 | slice | Correct successful-refetch persistence | `implementation_complete` | engineering | — | — | — |
| BQC-1.2 | slice | Remove raw inbox/activity/transport copies | `implementation_complete` | engineering | — | — | — |
| BQC-1.1 | slice | Complete field-and-copy inventory | `implementation_complete` | engineering | — | — | — |
| BQC-2.7 | slice | Policy operations | `implementation_complete` | engineering | — | — | — |
| BQC-2.6 | slice | Dark-context policy and interactive containment | `implementation_complete` | engineering | — | — | — |
| BQC-2.5 | slice | Delayed/system policy contract | `implementation_complete` | engineering | — | — | — |
| BQC-2.4 | slice | Interactive production cutover | `implementation_complete` | engineering | — | — | — |
| BQC-2.3 | slice | Wire PropertyAccessGrant | `implementation_complete` | engineering | — | — | — |
| BQC-2.2 | slice | Persisted policy state | `implementation_complete` | engineering | — | — | — |
| BQC-2.1 | slice | Canonical action/resource catalogue | `implementation_complete` | engineering | — | — | — |
| BQC-3.9 | slice | Durable cutover and in-process retirement | `implementation_complete` | engineering | — | — | — |
| BQC-3.8 | slice | External workflow reliability | `implementation_complete` | engineering | — | — | — |
| BQC-3.7 | slice | Relay, lease, ordering, and retention hardening | `implementation_complete` | engineering | — | — | — |
| BQC-3.6 | slice | Correct dispatcher and unknown-work behavior | `implementation_complete` | engineering | — | — | — |
| BQC-3.5 | slice | Migrate remaining enabled families | `implementation_complete` | engineering | — | — | — |
| BQC-3.4 | slice | Deepen inbox projections and commands | `implementation_complete` | engineering | — | — | — |
| BQC-3.3 | slice | Deepen the review/reply command family | `implementation_complete` | engineering | — | — | — |
| BQC-3.2 | slice | Integrate delayed/system execution policy | `implementation_complete` | engineering | — | — | — |
| BQC-3.1 | slice | Inventory and register enabled event/job families | `implementation_complete` | engineering | — | — | — |
| BQC-4.6 | slice | No-fallback fault proof | `implementation_complete` | engineering | — | — | — |
| BQC-4.5 | slice | Region move workflow | `implementation_complete` | engineering | — | — | — |
| BQC-4.4 | slice | Regional reads and operations | `implementation_complete` | engineering | — | — | — |
| BQC-4.3 | slice | Data and provider execution | `implementation_complete` | engineering | — | — | — |
| BQC-4.2 | slice | Regional job envelope and queues | `implementation_complete` | engineering | — | — | — |
| BQC-4.1 | slice | Active-property region reconciliation | `implementation_complete` | engineering | — | — | — |
| BQC-5.2 | slice | Non-worker context composition cleanup | `implementation_complete` | engineering | — | — | — |
| BQC-5.1 | slice | Make architecture policy executable | `implementation_complete` | engineering | — | — | — |

## Historical BQR work

BQR phase documents remain historical intent/implementation records. Live completion truth for beta is this file and `status/bqc-status.json` only.

