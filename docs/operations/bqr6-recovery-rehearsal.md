# BQR-6.5 — Recovery rehearsal (RPO / RTO)

**Status:** Procedure ready — **timed execution is BQC-8's** (configuration + app-side restore surface delivered by BQC-7.8)  
**Targets (ADR 0038):** RPO ≤ 15 minutes · RTO ≤ 4 hours  
**Related:** [runbooks § DB](runbooks.md), [backup-and-lifecycle](backup-and-lifecycle.md) (BQC-7.8 — the configuration + procedure this rehearsal times), [staging checklist](bqr6-staging-load-fault-checklist.md)

> **Deferred (2026-08-22):** not a closed-beta release blocker. The timed drill
> runs when the beta has external users (see the deferral note in ADR 0038).

## Goals

Prove that a beta release candidate can be restored without exceeding RPO/RTO, and that outbox/queue state is consistent after restore.

## Preconditions

- [ ] Provider PITR / backup enabled on the target Postgres (Railway — configuration documented in backup-and-lifecycle.md §1; console verification at drill time, BQC-8)
- [x] Redis is disposable or restore policy documented (queues rebuild from outbox — backup-and-lifecycle.md §2, BQC-7.8)
- [x] Documented restore contact / provider console access (platform owner: Bozhidar Denev — backup-and-lifecycle.md §7, BQC-7.8)
- [ ] Release candidate SHA known
- [x] Isolated restore boot + retention/recovery-fence verification surface (`RESTORE_MODE=isolated`, target attestation, `ops:restore-preflight`, `ops:restore-verify`; real-PostgreSQL integration drilled)

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
2. Tunnel to that sibling, run target preflight, apply migration parity, and run `ops:restore-verify` dry-run.
3. Run `ops:restore-verify --apply`; require a cell recovery generation, zero overdue retention/import backlog, zero restored authority, and proof that recovery-fenced outbox rows cannot publish.
4. Boot a no-domain signed-image web verifier in isolated mode. The worker refuses to boot; target admission and capabilities fail closed. Verify tenant isolation and critical reads.
5. Switch all cell consumers to the sibling plus fresh, distinct cache/queue/provider Redis resources while routing/effects remain stopped. Configure the `RECOVERY_CUTOVER_RUN_ID` and `RECOVERY_CUTOVER_GENERATION` printed by verification, UNSET `RESTORE_MODE`, redeploy web + worker, and verify `/api/health/ready` → 200 before resuming traffic. Normal PITR sibling boot must refuse a missing or stale tuple.
6. Reauthorize providers and reconcile/rebuild as new work; never redrive recovery-fenced outbox rows or restore BullMQ state.

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
- Measured RPO / RTO
- Metrics before/after
- Any manual steps or exceptions

## Pass / fail

- **Pass:** RPO ≤ 15m, RTO ≤ 4h, readiness green, canary read succeeds.
- **Fail:** Exceed targets, or restore loses committed outbox/source integrity without documented recovery.

## Stop-the-line (master plan §9)

If restore cannot meet RTO, or unexplained committed data loss occurs → halt rollout; return to BQR-6 owner.
