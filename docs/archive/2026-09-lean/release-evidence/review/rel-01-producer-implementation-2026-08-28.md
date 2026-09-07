# REL-01 Gate F producer implementation — 2026-08-28

Status: **repository machinery only; no live-readiness claim**

Scope: REL-01-T5 … T11 — the remainder of the Gate F evidence chain

Live actions performed: **none**

## What changed

Before this wave, three of the eighteen `GATE_F_REQUIRED_GATE_IDS` had a typed
producer. The other fifteen accepted any opaque file whose digest matched the
index, so the strongest clause in REL-01 — "a successful deploy without this
complete evidence join cannot substitute for Gate F" — was unenforceable for
83% of the join. `approverIdentity` was an unverified string. The legal binding
checked that a file existed, not that counsel had decided anything.

All eighteen keys now have a producer, approvals are cryptographically
verified, and the legal approval must be complete and current.

## Producer per Gate F key

| Gate F key                                       | Producer                                                                           | Command                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `candidate.clean_ci`                             | `src/shared/release/live-evidence/clean-ci-run.ts`                                 | `release:import-live-evidence`                                              |
| `candidate.independent_review`                   | `live-evidence/independent-review.ts`                                              | `release:import-live-evidence`                                              |
| `candidate.defect_disposition`                   | `live-evidence/defect-disposition.ts`                                              | `release:import-live-evidence`                                              |
| `preproduction.isolated_restore_migration`       | `live-evidence/isolated-restore-migration.ts`                                      | `release:import-live-evidence`                                              |
| `preproduction.provider_stub_journeys`           | `live-evidence/preproduction-journey-evidence.ts` (`journeyClass: provider_stub`)  | `release:import-live-evidence`                                              |
| `preproduction.live_provider_journeys`           | `live-evidence/live-provider-matrix.ts` (`providerMode: live`)                     | `release:import-live-evidence`                                              |
| `preproduction.portal_privacy`                   | `live-evidence/preproduction-journey-evidence.ts` (`journeyClass: portal_privacy`) | `release:import-live-evidence`                                              |
| `preproduction.manager_journeys`                 | `live-evidence/preproduction-journey-evidence.ts` (`journeyClass: manager`)        | `release:import-live-evidence`                                              |
| `preproduction.observability_content_inspection` | `live-evidence/telemetry-content-inspection.ts`                                    | `release:import-live-evidence`                                              |
| `promotion.railway_no_drift`                     | `promotion-readback-evidence.ts` (`gate: railway_no_drift`)                        | `release:beta --verify-only --readback-output` / `release:capture-readback` |
| `promotion.backup_pitr`                          | `live-evidence/backup-pitr-receipt.ts`                                             | `release:import-live-evidence`                                              |
| `promotion.migration_integrity`                  | `promotion-readback-evidence.ts` (`gate: migration_integrity`)                     | `release:beta --verify-only --readback-output` / `release:capture-readback` |
| `promotion.release_identity_health_controls`     | `promotion-readback-evidence.ts` (`gate: release_identity_health_controls`)        | `release:beta --verify-only --readback-output` / `release:capture-readback` |
| `promotion.deployed_critical_journeys`           | `deployed-critical-journey-evidence.ts` (wave 2)                                   | `release:deployed-journeys`                                                 |
| `promotion.canary_window`                        | `canary-window-evidence.ts` (wave 2)                                               | `release:observe-canary`                                                    |
| `promotion.restore_rollback`                     | `recovery-rehearsal-evidence.ts` (wave 2)                                          | `release:rehearse-recovery`                                                 |
| `promotion.dormant_cell_denial`                  | `promotion-readback-evidence.ts` (`gate: dormant_cell_denial`)                     | `release:beta --verify-only --readback-output` / `release:capture-readback` |
| `opening.cohort_readiness`                       | `live-evidence/cohort-readiness.ts`                                                | `release:import-live-evidence`                                              |

Two release-level references are also typed:

| Reference                        | Producer                                  | Command                                                       |
| -------------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| `release.legalRevisionSet`       | `legal-revision-set-evidence.ts` (wave 2) | `release:create-legal-revision-set`                           |
| `release.legalApprovalChecklist` | `legal-approval-checklist.ts`             | authored by counsel, validated by `release:validate-evidence` |

## Design rules held

- **The approval envelope never touches a private key.** There is no signing
  function in `src/shared/release/gate-f-approval-envelope.ts` and no code path
  in this repository that reads, writes, derives or generates one.
  `release:prepare-approval` prints the bytes; the human signs elsewhere.
  `security/gate-f-approval-roles.json` holds public keys only and its test
  scans the bytes for `PRIVATE KEY` and for any 32-byte seed.
- **No verifier means closed, not skipped.** `validateGateFEvidenceBundle`
  rejects a bundle when no signature verifier is supplied, when a role has no
  enrolled key, when the signing key is not that role's key, and when the
  signature does not check out — each with a distinct code.
- **Nothing self-approves.** The role is inside the signed payload, so an
  engineering key cannot produce a counsel signature. The legal checklist fails
  closed when the approval is absent, undecided, or expired before Gate F
  completed.
- **Stub evidence can never be presented as live evidence.**
  `live-provider-matrix.ts` pins `providerMode: 'live'` and
  `preproduction-journey-evidence.ts` pins `providerMode: 'stub'`. The two
  schemas cannot parse each other's bytes.
- **Importers never default a missing field.** `release:import-live-evidence`
  canonicalizes the raw capture and hands it to the schema unchanged; a missing
  required field is a non-zero exit naming the field, never a synthesized zero.
  Every artifact is written with `wx`.
- **A failing read-back still emits.** `release:beta --verify-only
--readback-output` writes all four artifacts even when a check failed, with
  `outcome: "failed"` and the failure named. Writing nothing on failure would
  let an operator re-run until the environment looked right and file only the
  passing capture.
- **The freeze pins one SHA.** `release:freeze-candidate` refuses a dirty
  worktree, an unmerged SHA, generated-artifact drift, an existing freeze file,
  and a source edit that raced the write.
- **Beta stays one logical US Data Cell.** The freeze record's `cells` is the
  exact tuple `["us"]`, and `dormant_cell_denial` requires an explicit refusal
  observation for every other catalogue id.

## Coverage

`src/shared/release/gate-f-complete-evidence.test.ts` builds a full eighteen-gate
bundle from the REAL producer functions — not hand-written literals — and
asserts:

- the complete bundle validates;
- replacing any single gate's first artifact with `{"status":"passed"}` fails
  and names that gate id (18 negative controls);
- removing any of the six approval signatures fails and names that role;
- a legal approval expiring before `completedAt` fails;
- a canary artifact produced against `reputation-key-us-beta-rehearsal` fails.

`scripts/release/validate-bundle.test.ts` asserts the CLI exits 1, not 0, for
each of those and prints the offending gate id.

## What this does NOT claim

Nothing here proves a Railway, provider, backup, or counsel fact. Today
`security/gate-f-approval-roles.json` enrols no key and the shipped legal
document registry still carries counsel drafts, so `release:validate-evidence`
cannot pass on any bundle. That is the intended state: the machinery is
fail-closed, and the remaining work is external evidence, not code.
