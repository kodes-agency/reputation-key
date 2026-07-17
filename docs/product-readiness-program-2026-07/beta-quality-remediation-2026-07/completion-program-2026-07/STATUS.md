# BQC live program status

> **Generated file.** Do not edit by hand. Source: `status/bqc-status.json`.
> Regenerate: `pnpm bqc:generate-status`. Schema: `src/shared/bqc/status-schema.ts`.

**Program:** BQC  
**Manifest updated:** 2026-07-17T00:00:00.000Z  
**Validation report:** docs/product-readiness-program-2026-07/beta-quality-remediation-2026-07/bqr-implementation-validation-report-2026-07-16.md  
**Validation baseline SHA:** `29b021875c145a7f8827f0ee70fc20935fc5dc79`  
**Working tree SHA (status describes):** `7cd383e9fba8d56bc653b31145f6202772efe195`  
**Lockfile SHA-256:** `948a751d725fd8668b4ef734a28eea10392fd89890608f453998786a2b197287`

BQR work is implementation history only. No BQR phase is `accepted` under BQC rules. Open findings remain from the 2026-07-16 validation report until closed by BQC evidence.

## Status vocabulary

Only these states are valid: `not_started`, `implementation_in_progress`, `implementation_complete`, `evidence_pending`, `accepted`, `blocked`.

`Merged` / `code complete` / `docs complete` are **not** completion states.

## Phases

| ID    | Kind  | Title                                              | State                        | Owner       | PR        | Open findings                                                                          | Blocked                                                                                 |
| ----- | ----- | -------------------------------------------------- | ---------------------------- | ----------- | --------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| BQR-0 | phase | Containment and rebaseline (historical BQR)        | `implementation_complete`    | engineering | #188      | STD-P0-01, SPEC-P0-03                                                                  | —                                                                                       |
| BQR-1 | phase | Architecture and schema (historical BQR)           | `implementation_complete`    | engineering | #189-#192 | STD-P1-01, STD-P1-06, STD-P2-02                                                        | —                                                                                       |
| BQR-2 | phase | Durable runtime (historical BQR)                   | `implementation_complete`    | engineering | #193-#197 | STD-P0-02, SPEC-P0-01, SPEC-P1-02                                                      | —                                                                                       |
| BQR-3 | phase | Source lifecycle and region (historical BQR)       | `implementation_complete`    | engineering | #199      | SPEC-P0-02, SPEC-P1-01                                                                 | —                                                                                       |
| BQR-4 | phase | Auth privacy containment (historical BQR)          | `implementation_complete`    | engineering | #201      | STD-P1-02, SPEC-P0-03                                                                  | —                                                                                       |
| BQR-5 | phase | Experience verification (historical BQR)           | `implementation_complete`    | engineering | #202-#204 | STD-P1-05, SPEC-P1-03                                                                  | —                                                                                       |
| BQR-6 | phase | Ops and scale (historical BQR)                     | `implementation_complete`    | engineering | #205-#208 | STD-P1-04, SPEC-P1-04, SPEC-P1-05, SPEC-P1-06                                          | —                                                                                       |
| BQR-7 | phase | Pilot (historical BQR)                             | `blocked`                    | product     | —         | —                                                                                      | human pilot + real properties; BQC-0 through BQC-8 acceptance first (review 2026-08-15) |
| BQC-0 | phase | Truthful rebaseline and containment                | `implementation_in_progress` | engineering | —         | STD-P0-01, SPEC-P2-01, SPEC-P0-03                                                      | —                                                                                       |
| BQC-1 | phase | Google source-data governance                      | `not_started`                | engineering | —         | SPEC-P0-02, STD-P1-03                                                                  | —                                                                                       |
| BQC-2 | phase | Authoritative authorization and capabilities       | `not_started`                | engineering | —         | SPEC-P0-03, STD-P1-02                                                                  | —                                                                                       |
| BQC-3 | phase | Durable commands, consumers, and jobs              | `not_started`                | engineering | —         | STD-P0-02, SPEC-P0-01, SPEC-P1-02                                                      | —                                                                                       |
| BQC-4 | phase | Enforced regional execution                        | `not_started`                | engineering | —         | SPEC-P1-01                                                                             | —                                                                                       |
| BQC-5 | phase | Clean architecture and context quality             | `not_started`                | engineering | —         | STD-P1-01, STD-P1-04, STD-P1-06, STD-P2-01, STD-P2-02, STD-P2-03, STD-P2-04, STD-P2-05 | —                                                                                       |
| BQC-6 | phase | Trustworthy verification and experience gates      | `not_started`                | engineering | —         | STD-P1-05, SPEC-P1-03, STD-P2-06                                                       | —                                                                                       |
| BQC-7 | phase | Production operations, security, and observability | `not_started`                | engineering | —         | SPEC-P1-05, SPEC-P1-06                                                                 | —                                                                                       |
| BQC-8 | phase | Scale, recovery, and release evidence              | `not_started`                | engineering | —         | SPEC-P1-04, SPEC-P2-02                                                                 | —                                                                                       |
| BQC-9 | phase | Controlled pilot and AI-readiness handoff          | `blocked`                    | product     | —         | —                                                                                      | BQC-0 through BQC-8 accepted + human pilot authorization (review 2026-09-01)            |

## Slices

| ID      | Kind  | Title                                   | State                        | Owner       | PR  | Open findings | Blocked |
| ------- | ----- | --------------------------------------- | ---------------------------- | ----------- | --- | ------------- | ------- |
| BQC-0.1 | slice | Machine-readable program status         | `implementation_in_progress` | engineering | —   | SPEC-P2-01    | —       |
| BQC-0.2 | slice | Correct portal capability taxonomy      | `not_started`                | engineering | —   | STD-P0-01     | —       |
| BQC-0.3 | slice | Restrict test-only capability overrides | `not_started`                | engineering | —   | SPEC-P0-03    | —       |
| BQC-0.4 | slice | Confirm operational stop controls       | `not_started`                | engineering | —   | —             | —       |
| BQC-0.5 | slice | Re-run and pin the baseline             | `not_started`                | engineering | —   | —             | —       |

## Historical BQR work

BQR phase documents remain historical intent/implementation records. Live completion truth for beta is this file and `status/bqc-status.json` only.
