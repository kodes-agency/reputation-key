# Identity invitation fact privacy cutover

This runbook moves `identity.member.invited` from the rolling v1 contract to
the identifier-only v2 contract in each Railway Data Cell. It is an
**expand → report/backfill → verify → cut over → later contract** migration.
The already-published migration 0105 performs a best-effort PostgreSQL scrub
and is immutable. Migration 0106 adds the rolling contract and must also never
be folded back into 0105: Railway may apply both while old replicas and
retained jobs still exist, so only the post-deploy operator lifecycle can
provide the complete cross-store guarantee.

## Contracts and safety properties

- The canonical invitation email remains only in Better Auth's Identity-owned
  `invitation` row for the invitation lifecycle.
- The domain event, new producer, new Activity job, logs, metrics, and Sentry
  carry no invitee address.
- During expand, v1 outbox/queue envelopes retain the old parser's `email`
  field only as the literal `[redacted]`; the relay also enforces that sentinel
  for a row claimed across the cutover boundary.
- The database trigger is the issuance authority. Its row lock serializes fact
  inserts with the operator transition. After v2 cutover, a stale producer
  that supplies a real email is rejected before the invitation transaction
  commits and before its post-commit Activity handler can run.
- The scrub is report-first, bounded by `--batch-size`, idempotent, and safely
  restartable. The remaining target predicates in PostgreSQL/Redis are the
  durable checkpoint: repeat the same command after any interruption.
- The scrub covers `outbox_events`, `recent_activity_entries`, every retained state of the
  `default` and `domain-events` queues, and the failure `quarantine` queue. For
  each targeted BullMQ job it also inspects/redacts `failedReason`, stack
  traces, job logs, and the quarantine envelope's own failure reason.
- During the migration-0160 rolling window, queue inspection and redaction treat
  both `project-recent-activity` and the drain-only `insert-activity-log` name as
  the same privacy target. Do not contract this recognition before the legacy
  queue-depth proof in the Recent Activity identifier-cutover runbook.
- Reports distinguish `privacyDirty` (a retained address/private detail) from
  `compatibilityV1` (a content-free sentinel envelope). `verifiedAt` seals the
  former privacy guarantee. It deliberately does not claim the later v1
  schema contraction is complete.
- The compatible worker awaits a terminal-attempt quarantine write before its
  handler rejects. The copy is staged as `pending_failure` and cannot be
  redriven until BullMQ's post-transition `failed` event confirms it. Every
  invitation payload (including the pre-BQR bare-payload shape) and its failure
  reason is sanitized before the add. A suspended process may outlive its
  BullMQ lock, so the privacy proof deliberately remains safe even if that
  content-free copy lands after `active: 0` and the operator scan.
- The worker-owned quarantine publisher has no client command timeout. A
  bounded ioredis timeout rejects only the caller promise and cannot cancel an
  already buffered command, so it is intentionally reserved for request/relay
  producers and is never used for this publication barrier.
- Generic quarantine redrive re-sanitizes invitation events and invitation
  Activity jobs before adding them to the target queue. Verification is
  therefore safe even if an operator redrive overlaps the independent queue
  scans: no scan ordering can move a private invitation fact past the seal.

## Railway rollout, one Data Cell at a time

Use the exact promoted image digest and the cell-local PostgreSQL and Queue
Redis bindings. Never point one invocation at another cell's resources.

1. Promote the expand release while issuance remains v1. Migration 0105 keeps
   its previously published scrub and migration 0106 creates the contract
   row/guard. The new release understands v1 and v2; old v1 dispatchers still
   accept the structural sentinel.
2. Verify the exact release SHA/digest and readiness for every web and worker
   replica in the cell. Confirm Railway has no old replica and allow the normal
   drain budget to expire. Do not switch merely because the deployment command
   returned successfully.
3. Inspect and preserve the report:

   ```text
   pnpm ops:identity-invitation-facts inspect --operator <id>
   ```

4. Pause both processing queues and wait for `active: 0`. Pausing preserves all
   jobs; producers may continue adding clean work. This drains normally owned
   attempts but is not treated as proof that a suspended, lost-lock process can
   never resume. The verified expand release instead enforces content-free
   invitation quarantine fields and Activity persistence at their write
   boundaries. A `pending_failure` entry is inert evidence. The generic redrive
   command may repair it only by reading the original queue and proving the
   original BullMQ job is still `failed`; every other state is refused.

   ```text
   pnpm ops:queue pause default --operator <id> --reason "invitation fact v2 cutover" --apply
   pnpm ops:queue pause domain-events --operator <id> --reason "invitation fact v2 cutover" --apply
   pnpm ops:queue status default --operator <id>
   pnpm ops:queue status domain-events --operator <id>
   ```

5. Preview, then atomically switch issuance. The operator command refuses an
   unpaused or active queue.

   ```text
   pnpm ops:identity-invitation-facts switch-v2 --operator <id>
   pnpm ops:identity-invitation-facts switch-v2 --operator <id> --reason "all cell replicas accept invitation fact v2" --apply --yes ops:identity-invitation-facts
   ```

6. Preview a bounded scrub, then apply batches until an applied batch reports
   `changedTotal: 0`. A crash requires no cursor recovery: rerun the command;
   clean targets no longer match and already-redacted jobs are unchanged.

   ```text
   pnpm ops:identity-invitation-facts scrub --operator <id> --batch-size 100
   pnpm ops:identity-invitation-facts scrub --operator <id> --batch-size 100 --reason "remove retained invitation addresses" --apply --yes ops:identity-invitation-facts
   ```

7. Run the read-only full verification. It must report `privacyDirty: 0`.
   Normally the completed scrub also reports `totalDirty: 0`; however, a relay
   that claimed a v1 row before the switch may publish a late `[redacted]`
   sentinel. That increments `totalDirty`/`compatibilityV1` without reopening
   the privacy risk. Seal the verified state; sealing repeats the privacy
   check and refuses any retained private value in payloads or error metadata.
   Archive any non-zero `compatibilityV1` count for the later contraction.

   ```text
   pnpm ops:identity-invitation-facts verify --operator <id>
   pnpm ops:identity-invitation-facts complete --operator <id> --reason "PostgreSQL and Redis invitation fact verification passed" --apply --yes ops:identity-invitation-facts
   ```

8. Resume both queues and verify readiness, quarantine counts, invitation
   creation, and Activity display with a synthetic invitation. Archive the
   redacted command outputs and policy-decision audit correlation IDs beside
   the release evidence.

   ```text
   pnpm ops:queue resume domain-events --operator <id> --reason "invitation fact v2 verified" --apply
   pnpm ops:queue resume default --operator <id> --reason "invitation fact v2 verified" --apply
   ```

For beta, run steps 1–8 once against `cell-us` and seal its contract row. If a
future Data Cell is approved, it must run this cutover independently before it
can accept traffic; dormant cell identifiers create no beta work.

## Rollback and forward recovery

- Before `complete`, pause both queues and use `rollback-v1` only when the
  expand release itself must be rolled back. Keep the expanded schema and
  redeploy the previously recorded compatible image digest; never reverse
  migrations 0105 or 0106. v1 facts from a new producer remain address-free
  sentinels.
- After `complete`, rollback to v1 is deliberately refused. Fix forward with a
  release that still reads v1/v2. The destructive contraction that removes v1
  schema/trigger/tooling is a later migration after the observation window,
  backup/restore proof, and independent review.
- If a batch fails, leave queues paused, preserve the output, correct the
  fault, and rerun. A batch returns completed per-store counts plus a
  content-free `errorCount`, target, and exception class even after a partial
  queue mutation; a non-zero error count exits unsuccessfully. Do not
  hand-edit BullMQ keys or run an unbounded SQL update.
- If verification finds a new raw address after switch, treat it as a privacy
  incident: keep queues paused, preserve evidence, identify the unapproved
  producer/release, and fix forward before resuming.
- Contracting away the v1 schema, trigger, and tool is a separate deployment.
  It requires a producer/relay publication barrier (for Railway, stop the
  relevant web/worker replicas or introduce an equivalent generation fence),
  `compatibilityV1: 0` after that barrier, the observation window, and the
  documented restore proof. The privacy seal alone does not authorize it.

## Executable evidence map

| Surface                                                                          | Evidence                                                                                                                          |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Domain event/new producer                                                        | `contexts/identity/domain/events.test.ts`, `application/use-cases/invite-member.test.ts`                                          |
| v1/v2 database guard and row-lock race                                           | `shared/db/identity-invitation-fact-contract.integration.test.ts`                                                                 |
| Relay/in-memory claim race                                                       | `shared/outbox/envelope.test.ts`                                                                                                  |
| New Activity payload                                                             | `contexts/activity/infrastructure/outbox-consumers.test.ts`                                                                       |
| PostgreSQL plus live/default/domain/quarantine Redis copies and bounded restart  | `shared/jobs/infrastructure/repositories/identity-invitation-fact-contract.integration.test.ts`                                   |
| Delayed terminal-attempt quarantine publication and failure-confirmation barrier | `shared/jobs/worker-observability.test.ts`, `shared/jobs/failure-quarantine.test.ts`                                              |
| Worker barrier queue has no ambiguous client command timeout                     | `shared/jobs/queue.test.ts`                                                                                                       |
| Redrive sanitization and proof-based pending recovery                            | `shared/jobs/failure-quarantine.test.ts`                                                                                          |
| Pre-BQR bare payload and late Activity persistence defense                       | `shared/ops/identity-invitation-fact-contract.test.ts`, `contexts/activity/application/use-cases/project-recent-activity.test.ts` |
| Sentry email/user scrubbing                                                      | `shared/observability/telemetry.test.ts`                                                                                          |
| Content-free log/metric vocabulary                                               | `shared/architecture/observability-schema.test.ts`, `shared/observability/metrics-schema.test.ts`                                 |

All markers in these proofs are synthetic. Evidence artifacts record counts,
versions, queue states, and correlation IDs only—never the marker value.
