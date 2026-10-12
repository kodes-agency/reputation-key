---
status: accepted
date: 2026-07-15
---

# 0038 — Beta recovery objectives and stop conditions

These are internal engineering objectives, never a customer SLA. They become
operational when a production database exists and are verified by provider
backup state plus a timed restore drill.

## Recovery objectives

| Objective | Target       | Verification                                  |
| --------- | ------------ | --------------------------------------------- |
| RPO       | ≤ 15 minutes | PITR backup interval plus restore drill       |
| RTO       | ≤ 4 hours    | Full restore from backup to operational state |

## Beta stop conditions

Any one condition stops all external effects while preserving canonical data:

1. Tenant isolation breach detected.
2. Unauthorized Google action observed.
3. Unexplained data loss from committed state.
4. Duplicate externally visible reply or email.
5. Leaked token or secret in logs or responses.
6. Inability to restore from backup within the RTO.
7. Privacy or policy violation, including content retained past its deadline or
   prohibited cross-Property AI processing.

Set `BETA_CAPABILITIES_OFF`, stop schedulers, preserve canonical data, and drain
or quarantine queued work. Recovery follows the incident runbook; no capability
is restored before the violated boundary is reconciled and verified.

## Consequences

- Repository tests can prove the stop mechanism, not a live backup or restore.
- RPO and RTO evidence records the exact release, migration head, source,
  target, elapsed time, and operator decision without tenant content.
- Availability, latency, severity taxonomy, and exception ceremonies are
  operating details rather than architectural decisions.

## Amendment 2026-10-12 — recovery is forward-only

Owner decision, 2026-10-12. Until then the runbooks named "roll back to the last
signed image" as a containment step, while the predeploy runner and the readiness
probe had refused such an image since 2026-07-29 as a side effect of requiring
the applied migration count to equal the image's journal. Nobody had decided
which of the two was right, and the runner told the operator that a rerun would
converge when it never could.

1. **A bad release is never repaired by an earlier image.** It is contained
   with the stop controls above (`docs/BETA.md` §7) and repaired by a fix
   deployed forward. The fix is a new commit on `main`, built and proved by CI
   and promoted as an immutable image like any other release (ADR 0051
   decision 6). It keeps every migration file and journal entry the production
   database has applied. A commit that touched `drizzle/` is therefore never
   plainly reverted: the revert deletes its migration, and the gate of
   decision 2 then refuses the fix itself. The code is reverted with `drizzle/`
   and the schema model left in place, or the schema change is undone by a new
   migration.
2. **An image older than the applied migrations is refused on purpose.** Web's
   predeploy runner (`scripts/migrate-deploy.ts`) and the readiness probe
   (`src/shared/health/readiness.ts`) keep requiring equality. When the database
   has applied more migrations than the image's journal holds, the image is
   older than the database and must not serve: migrations only go forward, and
   older code is not tested against a newer schema. ADR 0061, ADR 0064 and
   ADR 0066 each record a release below which an older image would refuse or
   corrupt real work. The count cannot tell an earlier release from an image
   built from a commit whose journal lost an applied migration; both are
   refused, and the runner's message names both.
3. **The two directions of a mismatch are told apart**
   (`src/shared/db/migration-journal-state.ts`). Database behind: the image
   carries migrations the database has not applied, the runner says the state is
   incomplete, and a rerun converges. Database ahead: the runner says the image
   is older than the database and refused by design, and readiness logs the same
   reason, because no rerun converges.
4. **The only way back in time is a restore.** Point-in-time restore stays
   reserved for data loss (`docs/operations/backup-and-lifecycle.md` §1). It is
   not a release rollback.

### Consequences of the amendment

- Repairing a bad release takes at least one CI run and one deploy. The stop
  controls, not the deploy, bound how long external effects keep flowing, so an
  incident starts with them.
- Where no migration landed between two releases, the gates have nothing to
  compare and do not refuse the older image. The rule is the same; it is then
  procedure, not mechanism.
- The gate is web's. Nothing checks a worker or provider Redis image against
  the applied migrations: neither runs the predeploy runner or the journal
  check, so an older worker image starts, and ADR 0066 records what it can do to
  a month with its own target. For those services the rule is procedure too.
  `pnpm ops deploy-ci-images` is the only supported deploy path; it moves web
  first and stops when web is refused. Railway's own Rollback, and its Redeploy
  of an earlier deployment, fall under the rule for every service.
- CI does not catch a journal that got shorter. It migrates an empty database
  from the same checkout, so a fix whose revert deleted an applied migration is
  green and is first refused by web's predeploy. Runbook §28 gives the check to
  run before deploying a fix.
- A release whose predeploy applied its migrations and which then did not
  activate leaves the serving web container older than the database until a
  release with the full journal activates. That container cannot be deployed
  again, and a variable set on web reaches no container unless the failed
  release then activates. Containment uses what needs no web deployment:
  `BETA_CAPABILITIES_OFF` on the worker, a queue pause, and the database-held
  Google and AI controls (runbook §28).
- Rollback procedures written before this amendment are withdrawn: the two
  containment passages of runbook §16, runbook §26 "Rolling back below this
  release", `roll_back_to_last_signed_release` in the after-hours support
  contract, and the rollback steps in ADR 0064 and ADR 0066. Their accounts of
  why an older image is unsafe stand as reasons for the rule. Runbook §28 is the
  operator procedure.
- An image built before this amendment still prints "Migration state incomplete
  … the rerun converges" when it meets a newer database. Read the counts in the
  state line above it.
- Proof: `src/shared/db/migration-journal-state.test.ts`,
  `src/shared/health/readiness-migration-journal.test.ts`, and the real runner
  against a database one migration ahead in
  `src/composition/declared-capability-posture.deploy.integration.test.ts`.
