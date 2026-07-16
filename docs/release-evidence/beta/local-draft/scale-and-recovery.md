# Scale and recovery evidence

**Release id:** local-draft  
**Generated at:** 2026-07-16T20:17:26.931Z  
**Generator:** `scripts/perf/write-scale-evidence.ts` (BQR-6.3)

## Local scale (required)

Source of truth: [`docs/performance/pre17c-scale-evidence.md`](../../../performance/pre17c-scale-evidence.md)

| Dimension               | Target  | Local proof (2026-07-14)   |
| ----------------------- | ------- | -------------------------- |
| Organizations           | 100     | 100                        |
| Properties              | 5,000   | 5,000                      |
| Reviews                 | 500,000 | 500,000                    |
| Dashboard warm (rollup) | ≤ 500ms | 2.6ms                      |
| Insert throughput       | ≥ 20/s  | ~34k reviews/s (bulk seed) |

Commands:

```bash
DATABASE_URL=... pnpm exec tsx scripts/perf/seed-scale.ts --orgs=100 --properties=5000 --reviews=500000
pnpm exec tsx scripts/perf/load-test.ts   # catalog of scenarios/faults
```

## SLOs (from harness)

| Key                | Value |
| ------------------ | ----- |
| `steadyReviewRate` | 20    |
| `burstReviewRate`  | 100   |
| `burstDuration`    | 60    |
| `drainTimeout`     | 600   |
| `rpoTarget`        | 900   |
| `rtoTarget`        | 14400 |
| `dashboardP95`     | 500   |
| `dashboardColdP95` | 2000  |
| `maxQueueDepth`    | 10000 |
| `outboxLagP95`     | 5000  |
| `fleetProperties`  | 5000  |
| `fleetWindow`      | 4     |

## Health probes (BQR-6.1 / 6.2)

| Probe     | URL                       | Expected                                   |
| --------- | ------------------------- | ------------------------------------------ |
| Liveness  | `GET /api/health/live`    | 200 `{ status: "ok" }`                     |
| Readiness | `GET /api/health/ready`   | 200 when DB+Redis up; 503 degraded         |
| Combined  | `GET /api/health`         | Same as readiness (compat)                 |
| Metrics   | `GET /api/health/metrics` | Outbox lag, queue depths, worker heartbeat |

## Scenarios (§9.2) — staging execution matrix

| Id                    | Name                  | Description                                           | Status          |
| --------------------- | --------------------- | ----------------------------------------------------- | --------------- |
| `steady`              | Steady arrival        | 20 review facts/sec for 30 minutes                    | pending staging |
| `burst`               | Burst                 | 100 reviews/sec for 60 seconds                        | pending staging |
| `singlePropertyBurst` | Single-property burst | Concentrated updates with timestamp ties              | pending staging |
| `reconnect`           | Reconnect/import      | 100 properties with paged histories, staggered        | pending staging |
| `fleetDispatch`       | Fleet dispatch        | 5,000 due properties over 4 hours                     | pending staging |
| `dashboardMix`        | Dashboard mix         | Warm/cold 1/7/30/90-day property views                | pending staging |
| `retention`           | Retention/deletion    | Expire and disconnect large properties during arrival | pending staging |
| `reconciliation`      | Reconciliation        | 35-day rollup repair while traffic continues          | pending staging |

## Fault injections (§9.3) — staging execution matrix

| Id                     | Name                                  | Invariant                                       | Status          |
| ---------------------- | ------------------------------------- | ----------------------------------------------- | --------------- |
| `dbFailurePreCommit`   | Database failure before source commit | No orphan outbox rows; all commits are atomic   | pending staging |
| `dbFailurePostCommit`  | Database failure after source commit  | Outbox relay catches up on restart              | pending staging |
| `relayCrashAfterClaim` | Relay crash after claim               | Lease expires; rows re-claimed by next relay    | pending staging |
| `relayCrashAfterRedis` | Relay crash after Redis add           | Duplicate possible but receipt dedup handles it | pending staging |
| `redisUnavailable`     | Redis unavailable                     | Outbox accumulates; web stays healthy           | pending staging |
| `workerSigterm`        | Worker SIGTERM during handler         | Job re-queued; outbox intact                    | pending staging |
| `workerForceKill`      | Worker forced termination             | Outbox row unclaimed; job retried               | pending staging |
| `duplicateEvents`      | Duplicate/out-of-order events         | Receipt dedup prevents duplicate processing     | pending staging |
| `poisonPayload`        | Poison payload                        | Dead-lettered; other events unaffected          | pending staging |
| `gbpRateLimit`         | GBP 429 rate limit                    | Backoff; no hammering                           | pending staging |
| `cacheOutage`          | Cache outage and stampede             | Fallback to DB; bounded query load              | pending staging |
| `lifecyclePurgeRace`   | Lifecycle purge racing sync           | No resurrection of purged content               | pending staging |

## RPO / RTO

| Metric | Target             | Result          | Evidence |
| ------ | ------------------ | --------------- | -------- |
| RPO    | ≤ 900s (15 min)    | pending staging |          |
| RTO    | ≤ 14400s (4 hours) | pending staging |          |

## Exceptions

- Staging load/fault execution requires environment credentials (human/env).
- Local scale proof satisfies volume/query tractability only — not full PRE17C sign-off.
- `OUTBOX_DISPATCHER_ENABLED` remains default-off until explicit exit.

## Sign-off

- [x] Local volume/query proof linked
- [x] Scenario + fault inventory frozen in evidence pack
- [ ] Staging scenarios executed
- [ ] Fault injections executed
- [ ] RPO/RTO verified
