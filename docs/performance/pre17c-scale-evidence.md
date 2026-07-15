# PRE17C Scale and Recovery Evidence

**Status:** Harness ready — execution requires staging environment
**Date:** 2026-07-14

## Overview

This document records the test harness, SLO definitions, and execution plan for
PRE17C §9 (Load and fault-evidence plan). The harness is committed as code;
actual execution against a seeded staging database is a prerequisite for
PRE17 closure sign-off.

## Test artifacts

| Artifact           | Location                                    | Purpose                               |
| ------------------ | ------------------------------------------- | ------------------------------------- |
| Dataset generator  | `scripts/perf/seed-scale.ts`                | 100 orgs, 5K properties, 500K reviews |
| Load/fault harness | `scripts/perf/load-test.ts`                 | 8 scenarios + 12 fault injections     |
| This report        | `docs/performance/pre17c-scale-evidence.md` | Evidence template                     |

## SLOs (from PRE17C §2.1, §9.2)

| Metric                    | Target                        |
| ------------------------- | ----------------------------- |
| Steady review rate        | 20/sec for 30 min             |
| Burst rate                | 100/sec for 60 sec            |
| Expected burst accepted   | 6,000                         |
| Post-burst drain          | ≤ 10 minutes                  |
| RPO (data loss tolerance) | ≤ 15 minutes                  |
| RTO (recovery time)       | ≤ 4 hours                     |
| Dashboard warm p95        | ≤ 500ms                       |
| Dashboard cold p95        | ≤ 2000ms                      |
| Queue depth alert         | > 10,000                      |
| Outbox lag p95            | ≤ 5000ms                      |
| Fleet dispatch window     | 5,000 properties over 4 hours |

## Dataset profile

- **Organizations:** 100 with country distribution (60% US, 25% Europe, 15% global)
- **Properties:** 5,000 with realistic skew (80% small, 20% large portfolios)
- **Reviews:** 500,000 with volume skew (top 5% properties hold 30% of reviews)
- **Content:** Synthetic only — no real PII or review text
- **Lifecycle:** Reviews distributed across 0-180 days with 30-day content expiry

## Scenarios to execute (§9.2)

1. **Steady arrival** — 20 reviews/sec × 30 min → no loss, bounded resources
2. **Burst** — 100/sec × 60s → 6,000 accepted, drain ≤ 10 min
3. **Single-property burst** — cursor/order/unique contention safe
4. **Reconnect/import** — 100 properties, staggered, interactive work protected
5. **Fleet dispatch** — 5K properties over 4 hours, no scheduler herd
6. **Dashboard mix** — warm/cold views, p95 budgets, no tenant leakage
7. **Retention/deletion** — expire + disconnect during arrival, complete purge
8. **Reconciliation** — 35-day rollup repair while traffic continues

## Fault injections to execute (§9.3)

1. Database failure pre/post commit
2. Relay crash after claim / after Redis add
3. Redis unavailable / restart / failover
4. Worker SIGTERM / forced termination
5. Duplicate/out-of-order events + poison payload
6. GBP 429 / 5xx / timeout / malformed / revoked auth / 404
7. Cache outage and stampede
8. Lifecycle purge racing sync
9. Region capability missing
10. Database restore with published/unpublished outbox rows

## Execution prerequisites

- [ ] Staging PostgreSQL provisioned at target capacity
- [ ] Staging Redis (separate instances for queue + cache)
- [ ] Dataset seeded via `tsx scripts/perf/seed-scale.ts`
- [ ] Web + worker deployed from main
- [ ] OpenTelemetry collector running for trace/metric capture
- [ ] Database monitoring (pg_stat_statements, slow query log)

## Evidence capture template

Each scenario result should record:

```
### <Scenario Name>
- **Started:** ISO timestamp
- **Duration:** seconds
- **Result:** PASS / FAIL
- **Metrics:**
  - throughput: N reviews/sec
  - p50 latency: Nms
  - p95 latency: Nms
  - queue depth: N
  - DB connections: N
  - error count: N
- **Assertions:**
  - [✓/✗] No data loss
  - [✓/✗] Bounded resource usage
  - [✓/✗] SLO targets met
- **Notes:** observations, tuning applied
```

## Tuning protocol (C5)

1. Establish baseline before any tuning
2. Capture slow query plans with `EXPLAIN (ANALYZE, BUFFERS)`
3. Tune one variable at a time (index → batch size → concurrency → pool → cache)
4. Re-run from clean seed after each change
5. Record results in this document
6. File remaining capacity risks with owners

## Sign-off

PRE17C closure requires:

- [ ] All 8 scenarios pass against the target-scale dataset
- [ ] All fault injections demonstrate correct invariant preservation
- [ ] RPO ≤ 15 min verified under worst-case fault
- [ ] RTO ≤ 4 hr verified from backup restore
- [ ] No unbounded scans or missing maintenance caps
- [ ] Final PRE17 acceptance matrix signed
