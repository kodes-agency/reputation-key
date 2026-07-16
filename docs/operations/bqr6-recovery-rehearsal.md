# BQR-6.5 — Recovery rehearsal (RPO / RTO)

**Status:** Procedure ready — **execution blocked on backup/restore access**  
**Targets (ADR 0038):** RPO ≤ 15 minutes · RTO ≤ 4 hours  
**Related:** [runbooks § DB](runbooks.md), [staging checklist](bqr6-staging-load-fault-checklist.md)

## Goals

Prove that a beta release candidate can be restored without exceeding RPO/RTO, and that outbox/queue state is consistent after restore.

## Preconditions

- [ ] Provider PITR / backup enabled on staging Postgres (e.g. Neon PITR)
- [ ] Redis is disposable or restore policy documented (queues rebuild from outbox)
- [ ] Documented restore contact / provider console access
- [ ] Release candidate SHA known

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

1. Restore DB per provider docs.
2. Redeploy or restart web + worker at the same SHA.
3. Verify `/api/health/ready` → 200.
4. Allow outbox relay (if enabled under ticketed window) or document that dispatcher remains off and backlog is observed only.

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
