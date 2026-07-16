# BQR-6.4 — Staging load and fault checklist

**Status:** Procedure ready — **execution blocked on staging credentials/env**  
**Owner:** Engineering (ops)  
**Related:** [PRE17C scale evidence](../performance/pre17c-scale-evidence.md), [load harness](../../scripts/perf/load-test.ts), [runbooks](runbooks.md), [ADR 0038](../adr/0038-beta-service-objectives-and-recovery.md)

## Preconditions

- [ ] Staging Postgres + Redis available (not production)
- [ ] `DATABASE_URL` / `REDIS_URL` point at staging
- [ ] Web + worker deployed from the **same release candidate SHA**
- [ ] `OUTBOX_DISPATCHER_ENABLED` still **default-off** unless this exercise explicitly enables it under a ticketed window
- [ ] Synthetic data only (`pnpm exec tsx scripts/perf/seed-scale.ts …`)
- [ ] Evidence pack directory: `docs/release-evidence/beta/<release-id>/`
- [ ] Health probes green: `/api/health/live`, `/api/health/ready`, `/api/health/metrics`

## Load scenarios (§9.2)

Record pass/fail + metrics in `scale-and-recovery.md` (regenerate inventory with `pnpm perf:evidence -- --release-id=<id>`).

| #   | Scenario id           | Procedure sketch                       | Pass criteria                                 |
| --- | --------------------- | -------------------------------------- | --------------------------------------------- |
| 1   | `steady`              | 20 reviews/s × 30 min into ingest path | No loss; queue depth bounded                  |
| 2   | `burst`               | 100/s × 60s then drain                 | Drain ≤ 10 min; no duplicate external effects |
| 3   | `singlePropertyBurst` | Concentrated updates on one property   | Cursor/order safe                             |
| 4   | `reconnect`           | 100 properties staggered import        | Resumable; interactive path protected         |
| 5   | `fleetDispatch`       | 5k due properties over 4h window       | No herd; Redis entries bounded                |
| 6   | `dashboardMix`        | Warm/cold 1/7/30/90d views             | p95 warm ≤ 500ms; cold ≤ 2s                   |
| 7   | `retention`           | Expire/disconnect during arrival       | Complete purge; no resurrection               |
| 8   | `reconciliation`      | 35-day rollup repair under traffic     | Bounded impact; exact repair                  |

## Fault injections (§9.3)

| #   | Fault id               | Procedure sketch              | Invariant                       |
| --- | ---------------------- | ----------------------------- | ------------------------------- |
| 1   | `dbFailurePreCommit`   | Kill DB mid-transaction       | Atomic; no orphan outbox        |
| 2   | `dbFailurePostCommit`  | Kill after commit pre-publish | Relay catch-up; RPO ≤ 15m       |
| 3   | `relayCrashAfterClaim` | SIGKILL after outbox claim    | Lease re-claim                  |
| 4   | `relayCrashAfterRedis` | SIGKILL after BullMQ add      | Receipt dedup                   |
| 5   | `redisUnavailable`     | Block Redis 30s               | Outbox accumulates; web healthy |
| 6   | `workerSigterm`        | SIGTERM during handler        | Clean drain                     |
| 7   | `workerForceKill`      | SIGKILL during handler        | Idempotent retry                |
| 8   | `duplicateEvents`      | Double-send event             | Exactly-once side effects       |
| 9   | `poisonPayload`        | Malformed payload             | DLQ; pipeline continues         |
| 10  | `gbpRateLimit`         | Mock 429                      | Backoff                         |
| 11  | `cacheOutage`          | Flush cache under burst       | Fallback to DB                  |
| 12  | `lifecyclePurgeRace`   | Expiry during sync            | No resurrection                 |

## Probes during runs

```bash
curl -sS "$BASE/api/health/live"
curl -sS "$BASE/api/health/ready"
curl -sS "$BASE/api/health/metrics" | jq '.outbox, .queues, .workers.heartbeat'
```

Alert if: readiness 503 for > 2 min without intentional fault; heartbeat `stale: true` with workers expected up; `outbox.unpublishedCount` unbounded growth post-recovery.

## After execution

1. Paste results into `docs/release-evidence/beta/<release-id>/scale-and-recovery.md`
2. File exceptions with owner + expiry for any skipped scenario
3. Link CI SHA + deploy artifacts in `manifest.md`
