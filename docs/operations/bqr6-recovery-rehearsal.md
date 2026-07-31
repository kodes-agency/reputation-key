# BQR-6.5 — Recovery rehearsal (RPO / RTO)

**Status:** Procedure ready — **timed execution is BQC-8's** (configuration + app-side restore surface delivered by BQC-7.8)  
**Targets (ADR 0038):** RPO ≤ 15 minutes · RTO ≤ 4 hours  
**Related:** [runbooks § DB](runbooks.md), [backup-and-lifecycle](backup-and-lifecycle.md) (BQC-7.8 — the configuration + procedure this rehearsal times), [staging checklist](bqr6-staging-load-fault-checklist.md)

## Goals

Prove that a beta release candidate can be restored without exceeding RPO/RTO, and that outbox/queue state is consistent after restore.

## Preconditions

- [ ] Provider PITR / backup enabled on the target Postgres (Railway — configuration documented in backup-and-lifecycle.md §1; console verification at drill time, BQC-8)
- [x] Redis is disposable or restore policy documented (queues rebuild from outbox — backup-and-lifecycle.md §2, BQC-7.8)
- [x] Documented restore contact / provider console access (platform owner: Bozhidar Denev — backup-and-lifecycle.md §7, BQC-7.8)
- [ ] Release candidate SHA known
- [x] Isolated restore boot + purge-before-serving verification surface (`RESTORE_MODE=isolated`, `ops:restore-preflight`, `ops:restore-verify` — BQC-7.8; locally drilled)

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

1. Restore DB per provider docs (Railway PITR to an ISOLATED project — platform owner; `ops:restore-preflight` first).
2. Migration parity, then boot ISOLATED at the same SHA with `RESTORE_MODE=isolated` (worker refuses to boot by design; web capabilities deny fail-closed).
3. Run `ops:restore-verify --apply` (source-policy purge in-process; zero expired-content proof; `retention_runs` evidence).
4. Cut over (UNSET `RESTORE_MODE`, redeploy web + worker) and verify `/api/health/ready` → 200.
5. Allow outbox relay (if enabled under ticketed window) or document that dispatcher remains off and backlog is observed only.

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
