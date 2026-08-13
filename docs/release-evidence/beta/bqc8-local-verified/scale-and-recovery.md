# Scale and recovery evidence

**Release id:** bqc8-local-verified  
**Release sha:** f46d2cd690899eace479e6ec9e08d5bbb3fece4c  
**Policy versions:** capability=bqc-0.3 · policyStore=-1 · routing=1 · sourceContent=1  
**Dataset hash:** 39db063cb1d6c4399c62100054aa62fd9be5d6c0114bcdfadb686ee969c5b00d  
**Dataset:** seed `perf-lifecycle-v1` — 100 orgs / 5000 properties / 500000 reviews  
**Owner:** bozhidardenev  
**Generated at:** 2026-08-08T15:09:08.441Z  
**Generator:** `scripts/perf/write-scale-evidence.ts` (BQC-8.1 — measured ingestion, no templated results)

## Executed runs (measured)

Environment: `local` (harness: scripts/perf/load-test.ts; raw identifier-only data under `raw/`, ADR 0030).

| Scenario              | Result | Duration | Samples       | Monitoring points | Key metrics                                                                                 | Assertions |
| --------------------- | ------ | -------- | ------------- | ----------------- | ------------------------------------------------------------------------------------------- | ---------- |
| `burst`               | PASS   | 60.6s    | 6000 (0 err)  | 60                | achievedRatePerSec=99.01/s · targetRatePerSec=100/s · enqueued=6000                         | 5/5        |
| `dashboardCold`       | PASS   | 0.3s     | 20 (0 err)    | 2                 | reads=20 · readP95=4ms                                                                      | 4/4        |
| `dashboardMix`        | PASS   | 15.6s    | 17544 (0 err) | 14                | reads=17544 · readP95=4.81ms                                                                | 4/4        |
| `drain`               | PASS   | 20.2s    | 100 (0 err)   | 18                | backlogSize=100 · drainMs=20167.9ms · remainingWaiting=0                                    | 4/4        |
| `fleetDispatch`       | PASS   | 5.1s     | 5000 (0 err)  | 4                 | dispatchRatePerSec=39910.61/s · projectedWindowS=0.1s                                       | 4/4        |
| `reconnect`           | PASS   | 288.2s   | 1200 (0 err)  | 250               | remainingWaiting=0 · catchUpDrainMs=222140.2ms                                              | 7/7        |
| `replyBurst`          | PASS   | 5.2s     | 50 (0 err)    | 1                 | publishP95=4927.34ms · published=25                                                         | 5/5        |
| `retention`           | PASS   | 220.1s   | 1 (0 err)     | 2                 | —                                                                                           | 4/4        |
| `singlePropertyBurst` | PASS   | 60.7s    | 7200 (0 err)  | 60                | backgroundAchievedRatePerSec=19.76/s · hotAchievedRatePerSec=98.78/s · maxQueueWaiting=6642 | 6/6        |
| `steady`              | PASS   | 30.2s    | 600 (0 err)   | 30                | achievedRatePerSec=19.85/s · targetRatePerSec=20/s · enqueued=600                           | 4/4        |

## Scenario matrix (§9.2)

| Id                    | Name                    | Description                                                                                        | Status                              |
| --------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `steady`              | Steady arrival          | 20 review facts/sec for 30 minutes                                                                 | PASS (measured — see Executed runs) |
| `burst`               | Burst                   | 100 reviews/sec for 60 seconds                                                                     | PASS (measured — see Executed runs) |
| `drain`               | Backlog drain           | Inject a backlog, stop injection, measure time-to-empty                                            | PASS (measured — see Executed runs) |
| `singlePropertyBurst` | Single-property burst   | Burst concentrated on ONE hot property while steady background arrival continues on the fleet      | PASS (measured — see Executed runs) |
| `reconnect`           | Reconnect/import        | Simulated provider outage (injection paused, worker live), then reconnect catch-up burst and drain | PASS (measured — see Executed runs) |
| `fleetDispatch`       | Fleet dispatch          | Dispatch refresh-due work for the whole seeded fleet; measured rate + LABELED 4h-window projection | PASS (measured — see Executed runs) |
| `dashboardMix`        | Dashboard mix           | Warm/cold 1/7/30/90-day property views                                                             | PASS (measured — see Executed runs) |
| `dashboardCold`       | Dashboard cold start    | First-N reads through a freshly restarted read path (cache cold start)                             | PASS (measured — see Executed runs) |
| `replyBurst`          | Reply publication burst | A human-use burst of reply publications; publish → terminal p95 (ADR 0038)                         | PASS (measured — see Executed runs) |
| `retention`           | Retention/deletion      | Expire and disconnect large properties during arrival                                              | PASS (measured — see Executed runs) |
| `reconciliation`      | Reconciliation          | 35-day rollup repair while traffic continues                                                       | not executed in this environment    |

## Fault matrix (§9.3)

| Id                     | Name                                  | Invariant                                       | Status                           |
| ---------------------- | ------------------------------------- | ----------------------------------------------- | -------------------------------- |
| `dbFailurePreCommit`   | Database failure before source commit | No orphan outbox rows; all commits are atomic   | not executed in this environment |
| `dbFailurePostCommit`  | Database failure after source commit  | Outbox relay catches up on restart              | not executed in this environment |
| `relayCrashAfterClaim` | Relay crash after claim               | Lease expires; rows re-claimed by next relay    | not executed in this environment |
| `relayCrashAfterRedis` | Relay crash after Redis add           | Duplicate possible but receipt dedup handles it | not executed in this environment |
| `redisUnavailable`     | Redis unavailable                     | Outbox accumulates; web stays healthy           | not executed in this environment |
| `workerSigterm`        | Worker SIGTERM during handler         | Job re-queued; outbox intact                    | not executed in this environment |
| `workerForceKill`      | Worker forced termination             | Outbox row unclaimed; job retried               | not executed in this environment |
| `duplicateEvents`      | Duplicate/out-of-order events         | Receipt dedup prevents duplicate processing     | not executed in this environment |
| `poisonPayload`        | Poison payload                        | Dead-lettered; other events unaffected          | not executed in this environment |
| `gbpRateLimit`         | GBP 429 rate limit                    | Backoff; no hammering                           | not executed in this environment |
| `cacheOutage`          | Cache outage and stampede             | Fallback to DB; bounded query load              | not executed in this environment |
| `lifecyclePurgeRace`   | Lifecycle purge racing sync           | No resurrection of purged content               | not executed in this environment |

## SLOs (from harness catalogue)

| Key                       | Value |
| ------------------------- | ----- |
| `steadyReviewRate`        | 20    |
| `burstReviewRate`         | 100   |
| `burstDuration`           | 60    |
| `drainTimeout`            | 600   |
| `rpoTarget`               | 900   |
| `rtoTarget`               | 14400 |
| `dashboardP95`            | 500   |
| `dashboardColdP95`        | 2000  |
| `maxQueueDepth`           | 10000 |
| `outboxLagP95`            | 5000  |
| `fleetProperties`         | 5000  |
| `fleetWindow`             | 4     |
| `replyPublishTerminalP95` | 10000 |
| `replyBurstSize`          | 25    |
| `reconnectOutage`         | 30    |
| `hotPropertyBurstRate`    | 100   |
| `backgroundRateFloor`     | 0.8   |

## Health probes (BQR-6.1 / 6.2)

| Probe     | URL                       | Expected                                                              |
| --------- | ------------------------- | --------------------------------------------------------------------- |
| Liveness  | `GET /api/health/live`    | 200 `{ status: "ok" }`                                                |
| Readiness | `GET /api/health/ready`   | 200 when DB+Redis up; 503 degraded                                    |
| Combined  | `GET /api/health`         | Same as readiness (compat)                                            |
| Metrics   | `GET /api/health/metrics` | Outbox lag, queue depths, worker heartbeat (ops-token gated, BQC-7.2) |

## RPO / RTO

| Metric | Target             | Result                           | Evidence |
| ------ | ------------------ | -------------------------------- | -------- |
| RPO    | ≤ 900s (15 min)    | not executed in this environment | BQC-8.6  |
| RTO    | ≤ 14400s (4 hours) | not executed in this environment | BQC-8.6  |

## Raw data

Identifier-only performance data (ADR 0030 — no review text, PII, or tenant identifiers as content; probe/job ids are synthetic):

- `raw/burst.result.json`
- `raw/burst.raw.json`
- `raw/dashboardCold.result.json`
- `raw/dashboardCold.raw.json`
- `raw/dashboardMix.result.json`
- `raw/dashboardMix.raw.json`
- `raw/drain.result.json`
- `raw/drain.raw.json`
- `raw/fleetDispatch.result.json`
- `raw/fleetDispatch.raw.json`
- `raw/reconnect.result.json`
- `raw/reconnect.raw.json`
- `raw/replyBurst.result.json`
- `raw/replyBurst.raw.json`
- `raw/retention.result.json`
- `raw/retention.raw.json`
- `raw/singlePropertyBurst.result.json`
- `raw/singlePropertyBurst.raw.json`
- `raw/steady.result.json`
- `raw/steady.raw.json`

## Sign-off

- [x] Local harness execution recorded (10 scenario(s) measured)
- [ ] Full §9.2 scenario matrix executed at target scale (BQC-8.2/8.3)
- [ ] Fault matrix executed (BQC-8.4/8.5)
- [ ] RPO/RTO verified (BQC-8.6)
