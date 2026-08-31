# BQR-6.5 — Recovery rehearsal (RPO / RTO)

**Status:** Sealed local apply procedure and strict candidate-bound result
schema implemented; report-first Railway orchestration, independently reviewed
execution, and timed live evidence remain open and block customer beta data.
**Targets (ADR 0038):** RPO ≤ 15 minutes · RTO ≤ 4 hours  
**Related:** [runbooks § DB](runbooks.md), [backup-and-lifecycle](backup-and-lifecycle.md) (BQC-7.8 — the configuration + procedure this rehearsal times), [staging checklist](bqr6-staging-load-fault-checklist.md)

> **Current decision (2026-08-28):** The earlier internal-beta deferral is
> superseded by REG-04/Gate E in the comprehensive beta implementation program.
> Local tests are not a substitute for this exact `cell-us` drill. RPO/RTO stay
> internal operating targets and are not represented as a customer SLA.

## Goals

Prove that a beta release candidate can be restored without exceeding RPO/RTO, and that outbox/queue state is consistent after restore.

## Preconditions

- [ ] Provider PITR / backup enabled on the target Postgres (Railway — configuration documented in backup-and-lifecycle.md §1; console verification at drill time, BQC-8)
- [ ] Backup-age, WAL/PITR-health, restore-range, and logical-export-success monitors route a controlled alert to the named owner
- [ ] Approved encrypted logical export exists outside the source project/account and passes an isolated read/restore check
- [x] Redis is disposable or restore policy documented (queues rebuild from outbox — backup-and-lifecycle.md §2, BQC-7.8)
- [x] Documented restore contact / provider console access (platform owner: Bozhidar Denev — backup-and-lifecycle.md §7, BQC-7.8)
- [ ] Release candidate SHA known
- [x] Isolated restore boot + inspection surface (`RESTORE_MODE=isolated`, target attestation, `ops:restore-preflight`, report-first `ops:restore-verify`; local refusal proof)
- [x] Restore-only executor validates an exact signed Review lifecycle request, uses a durable one-shot receipt, and remains absent from ordinary serving/recurring composition (local disposable-PostgreSQL proof)
- [ ] All four retained sidecars expose external post-boot readiness on a distinct non-mTLS health port and retain dependency-loss alert evidence
- [ ] Independent approver signs the actual sibling report/request and the full Railway apply/cutover/rollback rehearsal produces external evidence

## Rehearsal steps

### 1. Baseline

1. Note wall-clock time \(T0\) and latest committed synthetic row id.
2. Capture `GET /api/health/metrics` snapshot.
3. Confirm readiness 200.

### 2. Inject loss window

1. Write a marker row (or synthetic review) at \(T1\).
2. Optionally stop workers / web to simulate outage.
3. Restore database to a PITR point **before** \(T1\) (worst-case data loss ≈ \(T1 - T\_{\text{restore point}}\)).

### 3. Restore

1. Contain the cell, then restore by Railway PITR to the generated sibling Postgres service; the source remains live but must receive no recovering-cell effects. Record the exact service name and restore point.
2. Tunnel to that sibling, run target preflight, apply migration parity, and run
   `ops:restore-verify` dry-run. Preserve and independently review the canonical
   report/request from `review-lifecycle-recovery-approval.md`.
3. Stop unless the exact current signed bundle and trusted public keyring are
   configured only on the isolated verifier. Through that sealed executor, run
   the verifier apply path;
   require a cell recovery generation, zero overdue retention/import backlog,
   zero restored authority, and proof that recovery-fenced outbox rows cannot
   publish.
4. Boot a no-domain signed-image web verifier in isolated mode. The worker refuses to boot; target admission and capabilities fail closed. Verify tenant isolation and critical reads.
5. Switch all cell consumers to the sibling plus fresh, distinct cache/queue/provider Redis resources while routing/effects remain stopped. Retain the three new Redis service identities, creation times, empty key/queue proofs, and exact consumer configuration read-back. Configure the `RECOVERY_CUTOVER_RUN_ID` and `RECOVERY_CUTOVER_GENERATION` printed by verification, UNSET `RESTORE_MODE`, redeploy web + worker, and verify `/api/health/ready` → 200. Normal PITR sibling boot must refuse a missing or stale tuple.
6. Rehearse a read-only routing cutover to the sibling, run tenant-isolated critical reads, then apply the previously saved non-destructive routing plan back to the untouched source and prove its readiness/reads. Keep customer traffic, mutations, workers, and provider effects stopped throughout this rollback proof, so the two databases cannot diverge. Retain both configuration read-backs and the elapsed cutover/rollback times. If the sibling is selected for final recovery, perform that separately through a freshly verified saved plan; do not treat the rehearsal flip as authorization to resume traffic.
7. After the final recovery decision, reauthorize providers and reconcile/rebuild as new work; never redrive recovery-fenced outbox rows or restore BullMQ state.

### 4. Measure

| Metric      | How                                                          | Target    |
| ----------- | ------------------------------------------------------------ | --------- |
| RPO         | Time from restore point to last known committed work         | ≤ 15 min  |
| RTO         | Wall time from restore start to readiness 200 + canary query | ≤ 4 hours |
| Consistency | No orphan outbox requiring manual fix; queues drain or empty | Pass      |

### 5. Record

Write into `docs/release-evidence/beta/<release-id>/scale-and-recovery.md`:

- Start/end timestamps
- Provider restore point id
- Exact source/sibling Postgres and fresh cache/queue/provider Redis service identities
- Measured RPO / RTO
- Cutover and rollback configuration read-backs and elapsed times
- Backup/PITR/logical-export, sidecar-readiness, release/config-drift, and alert-injection receipts
- Metrics before/after
- Any manual steps or exceptions

The first `promotion.restore_rollback` Gate F reference must additionally be
canonical `repkey-recovery-rehearsal-1` JSON. It selects exactly one of
`compatible_image_rollback` or `incompatible_data_restore`, binds the release
candidate and all dependency digests, and cannot encode reverse DDL. Every
dependency digest must be a retained sibling Gate F reference. This schema is
the result envelope; it does not replace the platform operation, independent
review pause, or external receipts above.

## Pass / fail

- **Pass:** RPO ≤ 15m, RTO ≤ 4h, readiness green, canary read succeeds,
  fresh Redis is evidenced, cutover and rollback both verify, no duplicate
  effect occurs, and every required alert reaches the named owner.
- **Fail:** Any target/evidence is missing, or restore loses committed
  outbox/source integrity. A written explanation is incident evidence, not a
  passing exception.

## Stop-the-line (master plan §9)

If restore cannot meet RTO, or unexplained committed data loss occurs → halt rollout; return to BQR-6 owner.
