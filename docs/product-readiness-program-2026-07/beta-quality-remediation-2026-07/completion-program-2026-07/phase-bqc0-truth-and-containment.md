# BQC-0 — Truthful Rebaseline and Containment

**Status:** `implementation_in_progress` (see live [`status/bqc-status.json`](status/bqc-status.json))  
**Estimate:** 2–3 engineering days  
**Dependencies:** none  
**Unlocks:** every later BQC phase

## 1. Outcome

Establish one machine-verifiable program status and close immediate containment defects before deeper work begins. After BQC-0, nobody can mistake merged scaffolding for accepted behavior, accidentally enable a non-core capability in production, or open portal writes through a read gate.

## 2. Findings owned

- STD-P0-01 — portal writes authorized by `portal.read`.
- SPEC-P2-01 — status documents contradict one another.
- Containment portion of SPEC-P0-03 — environment overrides and dark-path ambiguity.

## 3. Entry conditions

- Pin a fresh implementation baseline SHA, migration version, lockfile hash, and CI state.
- Preserve the 2026-07-16 validation report as immutable starting evidence.
- Keep durable dispatch, real Google ingestion, and Phase 17/18 disabled.

## 4. Slices

### BQC-0.1 — Machine-readable program status

Create a schema-validated status manifest containing:

- phase and slice identifier;
- state from the BQC vocabulary;
- implementation PR/SHA;
- required evidence IDs;
- evidence environment and release identity;
- owner and independent reviewer;
- open findings/exceptions;
- blocked dependency and next review date;
- accepted timestamp.

Generate human-readable status tables from the manifest. Historical phase documents retain their prose/status as historical records but link to the live manifest. CI rejects invalid transitions such as `accepted` without evidence or reviewer.

### BQC-0.2 — Correct portal capability taxonomy

- Add/confirm independent `portal.read`, `portal.write`, and `portal.upload` capabilities.
- Map create/update/delete/group/link/category mutations to `portal.write`.
- Map media processing/finalization to `portal.upload` and, where necessary, `portal.write`.
- Keep all three non-core and denied for beta.
- Remove direct mutation assertions of `portal.read`.
- Ensure a permission cannot override a blocked capability.

### BQC-0.3 — Restrict test-only capability overrides

- Refuse process startup when `BETA_E2E_GLOBAL_CAPABILITIES` is non-empty outside an explicit test/CI execution identity.
- Prefer dependency-injected test policy adapters over environment backdoors where practical.
- Record capability-policy version and effective beta manifest at startup without tenant/content data.
- Add a production boot assertion for every blocked capability.

### BQC-0.4 — Confirm operational stop controls

Document and exercise safe controls for:

- disabling Google sync/import/publish;
- disabling durable relay/dispatcher/schedules;
- denying new property activation;
- quarantining a queue without deleting jobs;
- denying all Phase 17/18 work;
- preserving evidence and canonical state during containment.

Controls must use the same authoritative policy intended for BQC-2, or be explicit temporary boot-time containment with a removal slice.

### BQC-0.5 — Re-run and pin the baseline

Capture clean results/failures for format, types, lint, unit, integration, Storybook, critical/full E2E, builds, dependency audit, Fallow health/dead-code/duplication, and migration verification. Store command, environment, duration, result, and artifact path. Do not reinterpret existing failures as expected passes.

## 5. Tests

- Capability table test proves read enablement cannot enable write/upload.
- Route/server/job/worker negative tests cover representative portal read, write, delete, and upload paths.
- Production-mode configuration test rejects E2E overrides.
- Status-schema tests reject missing evidence, invalid transitions, duplicate phase IDs, and acceptance without independent review.
- A generated status document round-trips without manual drift.

## 6. Cutover and rollback

- Capability corrections are default-deny and can deploy before any data migration.
- If an internal fixture depends on portal write, update the fixture/test adapter; do not weaken production policy.
- The status manifest becomes authoritative after its first reviewed generation. Rollback restores the previous generated view, not manually edited completion claims.

## 7. Evidence

- Baseline manifest bound to SHA/migration/lockfile.
- Portal negative matrix.
- Production-configuration rejection output.
- Stop-control rehearsal notes.
- Generated program status with all existing BQR work classified using the new states.

## 8. Exit matrix

| Criterion                                           | Required result |
| --------------------------------------------------- | --------------- |
| Portal read/write/upload are independent            | Pass            |
| Portal remains dark through every tested path       | Pass            |
| Test-only overrides cannot boot in production       | Pass            |
| One status manifest generates all live status views | Pass            |
| BQR-0…7 historical work is reclassified truthfully  | Reviewed        |
| Baseline evidence is pinned and reproducible        | Pass            |
| Real-data and AI stop-lines remain active           | Verified        |

## 9. Out of scope

- Persisted organization/property capability policy (BQC-2).
- Fixing the baseline failures (owning later phases).
- Enabling portal, guest, team, recognition, or AI features.
