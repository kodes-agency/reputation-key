# Phase PRE17C — Scale, Observability, and Closure Plan

**Status:** Ready after PRE17A; read-model work also requires PRE17B property time zones  
**Parent:** [Phase PRE17 master plan](phase-pre17-master-plan.md)  
**Estimate:** 8–12 engineering days  
**Primary gate:** The system proves target-scale performance and failure recovery with useful, content-safe operational signals and blocking delivery gates.

## 1. Purpose and boundaries

PRE17C turns the preceding architecture into production evidence. It removes dead materialized-view infrastructure, introduces only the read models the current product is permitted to keep, wires bounded cache behavior, adds vendor-neutral telemetry/health, establishes realistic CI suites, and proves the 5,000-property/500,000-review monthly target under burst and failure conditions.

This plan does not implement the Phase 18 AI dashboard. It provides its property-local calendar, read-model pattern, cache seam, SLOs, and test harness. Google's [written response](google-business-profile-ai-policy-response-2026-07-14.md) permits independently generated per-property sentiment/theme/priority/trend metadata, but PRE17C still does not create those Phase 17/18 projections.

## 2. Measured risks and decisions

### 2.1 Scale is a burst/recovery problem

The stated average is approximately:

- 16,667 reviews/day;
- 694 reviews/hour;
- 11.6 reviews/minute;
- 0.193 reviews/second;
- 100 new reviews/property/month on average.

PostgreSQL and BullMQ can handle this without Kafka, Elasticsearch, a workflow engine, or automatic table partitioning. Risk comes from missed-webhook reconciliation, reconnect/import bursts, fleet-wide schedules, Redis/provider outages, and inefficient per-review queries.

PRE17 therefore tests 20 reviews/second sustained and 100 reviews/second for 60 seconds, plus backlogs and reconnects. Partition only after measured table/index size, memory, retention, and query plans justify it; PostgreSQL's own [partitioning guidance](https://www.postgresql.org/docs/current/ddl-partitioning.html) recommends it for genuinely large tables and suitable pruning/retention patterns.

### 2.2 Do not accelerate unused or prohibited reads

The current materialized views are refreshed but the dashboard adapters query raw tables. `REFRESH MATERIALIZED VIEW` replaces contents, and concurrent refresh requires a suitable unique index and still allows only one refresh per view. Keeping unused full refreshes creates write/IO cost without read value. See the official [materialized-view](https://www.postgresql.org/docs/current/rules-materializedviews.html) and [refresh](https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html) documentation.

Replace the metric views with a normal incrementally maintained metric rollup. Remove the unused weekly and inbox views after proving no reads depend on them. Any later Google-derived property rollup requires `SourceContentPolicy.mayAggregatePerProperty = true`, a permitted derived schema, and completed ADR 0031. Cross-property aggregation remains false.

During PRE17C:

- recent-review/detail views may load canonical, unexpired review records;
- existing review aggregate sections must be classified as raw-content views, permitted property derivatives, or review-solicitation-ineligible metrics; unknown classifications fail closed rather than being silently cached/materialized;
- first-party operational metrics such as portal scans can use long-lived rollups under their own retention policy;
- Phase 18 property reports and sentiment charts remain runtime-disabled because they are not implemented until Phase 18, not because general Google permission is pending.

### 2.3 Property-region routing is not full data residency

PRE17B's processing profile guarantees how a future model endpoint is selected and prevents silent cross-region fallback. By itself it does **not** prove that the application database, queues, logs, backups, support access, or web runtime reside in that property region.

Before making a residency claim, create a data-flow record for each supported cell covering source storage, transit, model execution, telemetry, backup, subprocessors, deletion, and support access. If customers require end-to-end regional storage/compute isolation rather than regional model processing, treat that as a separate infrastructure program and revise the estimate before Phase 17 launch.

## 3. Service objectives and budgets

These are initial internal objectives, not contractual SLAs. Validate them during PRE17C and adjust with recorded evidence rather than weakening tests to match an incident.

| Signal                                                 | Initial objective under healthy dependencies                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Outbox commit → BullMQ accepted                        | p99 ≤ 10 seconds; oldest unpublished age alert at 30 seconds, page at 5 minutes.                     |
| Domain event accepted → consumer terminal success      | p99 ≤ 30 seconds for near-real-time projections.                                                     |
| GBP notification accepted → canonical review committed | p95 ≤ 60 seconds.                                                                                    |
| Property dashboard server time                         | p95 ≤ 500 ms warm cache; p95 ≤ 1 second cold at target dataset.                                      |
| Dashboard cache                                        | ≥80% hit rate for eligible stable sections after warm-up; correctness takes precedence.              |
| Worker heartbeat                                       | Updated at least every 30 seconds; alert after 90 seconds.                                           |
| Review sync freshness                                  | Per-property status visible; alert on missed configured reconciliation window.                       |
| Deletion backlog                                       | Oldest normal expiry/deletion <24 hours; disconnect/erasure follows its stricter workflow objective. |
| Burst recovery                                         | Drain the 6,000-review burst backlog within 10 minutes after input returns to normal.                |
| Data loss/duplicate visible effects                    | Zero in all fault-injection scenarios.                                                               |

Measure p50/p95/p99 and queue age; averages alone are not acceptance evidence.

## 4. Incremental read-model design

Write ADR 0029 before implementation.

### 4.1 `daily_metric_rollups`

Create an ordinary table owned by the metric context:

| Column                           | Requirement                                                            |
| -------------------------------- | ---------------------------------------------------------------------- |
| `organization_id`, `property_id` | Mandatory tenant/property scope.                                       |
| `scope_type`, `scope_id`         | `property` or `portal`; avoid a magic zero UUID for null portal scope. |
| `metric_key`                     | Existing validated metric identity.                                    |
| `local_date`                     | Property-local calendar date, not server/UTC truncation.               |
| `reading_count`, `value_sum`     | Sufficient to derive count/sum/average without lossy stored averages.  |
| `updated_at`                     | Projection freshness.                                                  |

Primary/unique key: `(organization_id, property_id, scope_type, scope_id, metric_key, local_date)`.

When an immutable metric reading is committed, its durable event consumer computes `local_date` through the property calendar port and atomically inserts/updates the rollup with its consumer receipt. Replays therefore apply once. Property- and portal-scope contributions may be written together if both are required by measured queries.

If metric readings later become editable/deletable, introduce a per-reading contribution ledger or compensating event before supporting that mutation. Never subtract based on reconstructed guesses.

### 4.2 Calendar correctness

- `local_date` uses the property's validated IANA zone at event time.
- Record the effective zone/routing-policy version needed to explain historical bucketing.
- A later property time-zone correction does not silently rewrite history. Run an explicit bounded rebuild for the affected date range if product policy requires it.
- Tests cover daylight-saving gaps/overlaps, date-line zones, and non-hour offsets.
- Weekly/monthly queries aggregate daily rows at read time; do not maintain redundant weekly views until query evidence requires them.

### 4.3 Reconciliation

Incremental projection is the primary path; a repair job verifies it:

1. Select property/date ranges with cursors, defaulting to the most recent 35 local days.
2. Recompute from canonical metric readings into a temporary/result set.
3. Compare counts/sums, emit mismatch metrics, and repair through idempotent upserts.
4. Bound properties, dates, runtime, and database concurrency per attempt.
5. Support an authorized on-demand property/date rebuild without a fleet scan.

Reconciliation exists for recovery, not as the normal dashboard refresh engine.

### 4.4 Review-derived data

Do not create `daily_review_rollups`, sentiment rollups, theme tables, or trend reports in PRE17. Define a documented extension rule instead:

- the source policy must permit the operation;
- the row must be property-scoped and source-lineage linked;
- deletion/expiry participants must exist before writes are enabled;
- local date, analysis version, region, and freshness must be explicit;
- organization summaries remain out of scope;
- rebuild and reconciliation must be bounded and idempotent.

### C1 — Build and cut over metric read models (2–3 days)

1. Move any still-required view/index DDL into the migration journal if PRE17A has not already done so.
2. Add `daily_metric_rollups` and its constraints/indexes.
3. Add property-local calendar lookup and the idempotent metric projection consumer.
4. Backfill with property/date cursor batches and checkpoints, not one `INSERT … SELECT` over the entire history during deploy.
5. Run raw-vs-rollup shadow queries for at least representative 1/7/30/90-day ranges, property and portal scopes, empty data, and DST boundaries.
6. Record `EXPLAIN (ANALYZE, BUFFERS)` for the slowest target queries against production-shaped staging data.
7. Switch metric dashboard ports to the rollup adapter behind `ENABLE_INCREMENTAL_METRIC_ROLLUPS`.
8. Stop old refresh schedules, verify no dependencies, then drop all three unused materialized views and refresh job definitions in a later deployment.
9. Remove the temporary flag after the observation window.

## 5. Dashboard cache as a deep module

The cache must hide serialization, key versioning, tenancy, request coalescing, TTL jitter, invalidation, telemetry, and failure behavior behind one interface:

```ts
type DashboardCache = Readonly<{
  getOrLoad<T>(request: CacheRequest<T>, load: () => Promise<T>): Promise<T>
  invalidateProperty(
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<void>
}>
```

Cache key inputs include schema/version, organization, property, authorization scope, portal selection, normalized date range, locale/time-zone behavior, and a property cache generation. Never rely on a client-provided key string.

Rules:

- Cache only sections whose source policy permits the copy. Do not cache recent review text/reviewer identity.
- Maximum TTL is 5 minutes with randomized jitter; a generation bump makes old entries unreachable immediately.
- Use request coalescing/single-flight to prevent a cold-key stampede.
- Redis failure degrades to bounded database reads; it must not fail the whole dashboard unless the database path is unsafe.
- Prevent caching errors, partial authorization results, or one role's richer response for another role.
- Invalidation is property scoped and triggered after relevant durable projection commits.
- Limit response size and serialization time. Compression is evidence-driven.

### C2 — Wire cache and query budgets (1–2 days)

1. Inventory each dashboard section, its source, authorization scope, policy class, expected cardinality, and invalidation event.
2. Split the dashboard use case so independently cacheable content-free sections do not force caching recent review content.
3. Implement versioned keys, coalescing, jitter, fail-open-to-DB behavior, and size limits.
4. Add cross-organization/property/role/portal negative tests and concurrent cold-key tests.
5. Measure cold/warm p95 and database statement counts. Set per-request query and row budgets.
6. Remove any unused cache abstractions or routes after the real module is active.

## 6. Observability and content safety

Write ADR 0030 before implementation. Use OpenTelemetry/OTLP interfaces so the application is not coupled to one observability vendor. Pin the semantic-convention version because messaging and GenAI conventions are still evolving.

### 6.1 Trace model

Propagate W3C trace context through:

1. HTTP/webhook/request acceptance;
2. business transaction and outbox append;
3. relay claim and BullMQ send;
4. BullMQ receive and consumer processing;
5. synchronization/provider HTTP reads;
6. projection/lifecycle completion.

Create separate producer/send and consumer/process spans where useful, following official [OpenTelemetry messaging conventions](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/).

Never put review text, prompt text, reply text, reviewer data, tokens, authorization headers, upstream bodies, or cache values in span names/attributes/events. Future content-capturing GenAI attributes remain disabled. Metrics never use organization/property/user/event/job IDs as labels.

### 6.2 Metrics

Required low-cardinality metrics:

- HTTP request duration/error by route template and status class;
- database pool use/wait and bounded query duration classification;
- outbox unpublished count and oldest age;
- relay attempts/failures and dispatch duration;
- queue waiting/active/delayed/failed counts, oldest waiting age, processing duration, retry/stall rate;
- sync accepted-to-commit latency, property freshness, API error class, pages/items, and stale-source no-ops;
- lifecycle runs/steps/backlog/oldest age/failure class;
- read-model projection lag, reconciliation mismatch, repair count;
- dashboard duration, query count, cache hit/miss/coalesce/error, response-size class;
- process heartbeat and graceful-shutdown outcome.

Track provider/model/token/cost metrics only in Phase 17, with the same no-content and bounded-cardinality rules.

### 6.3 Logging

1. Configure Pino redaction for authorization/cookies/tokens/secrets and known content field names, including nested request/response/error objects.
2. Replace raw `err` serialization and stack output in production logs with error class, safe message/code, operation, attempt, and correlation ID. Secure error aggregation may capture stacks only under a separately reviewed scrubber/access/retention policy.
3. Do not interpolate untrusted error messages into log message strings.
4. Define a `SafeError`/error-classification boundary for Google, Redis, PostgreSQL, webhook, and job failures.
5. Add automated sentinel tests that pass distinctive review/reviewer/reply/token values through failure paths and assert they are absent from captured logs/spans/metrics.
6. Set retention/access controls by environment and document support lookup from event/run IDs to access-controlled records.

### C3 — Instrument runtime and application seams (2–3 days)

1. Add an internal telemetry port plus OTLP adapter and no-op/test adapters.
2. Instrument HTTP, database pool/query classes, outbox, messaging, sync, lifecycle, read models, and dashboard cache at their module boundaries.
3. Preserve trace context in the outbox envelope; do not require all events to originate in an HTTP trace.
4. Add dashboards for delivery, review freshness, lifecycle, database/cache, worker capacity, and user-facing latency.
5. Add alerts tied to the objectives in section 3, with runbook links and a severity/owner.
6. Run the leakage suite before enabling `ENABLE_OTEL` in staging and production.

## 7. Health, readiness, and operational recovery

### 7.1 Endpoints and heartbeats

Split health semantics:

- `/health/live`: process event loop is responsive; it does not query dependencies.
- `/health/ready`: role-specific startup/config/migration/dependency requirements are satisfied.
- Web readiness requires database and security-critical dependencies. Optional dashboard cache failure is reported as degraded but does not necessarily remove the web process from service.
- Worker/relay readiness requires database, queue Redis, valid job/schedule registry, and no migration mismatch.

Add `service_heartbeats` or an equivalent content-free operational record for worker roles/instances: role, instance ID, deployment version, started/last-seen times, status, and sanitized last shutdown. Do not make “process can ping Redis” the proof that delivery is progressing; alert on outbox/queue/sync/lifecycle age too.

### 7.2 Redis topology

Production BullMQ Redis must use `maxmemory-policy noeviction`, as recommended by [BullMQ production guidance](https://docs.bullmq.io/guide/going-to-production). Cache eviction and queue correctness have incompatible requirements, so use separate production Redis instances/clusters for BullMQ and disposable application cache. Separate Redis database numbers are not resource/failure isolation.

Document:

- TLS/auth/network restrictions and secret rotation;
- persistence/failover policy appropriate to the queue's role, recognizing PostgreSQL outbox can republish;
- connection/timeouts/retry behavior by web, relay, worker, and cache client;
- max connections and memory alarms;
- restore/restart procedure and expected replay behavior.

### 7.3 PostgreSQL operations

- Create a connection budget across web replicas, workers, relay, migrations, observability, and support, leaving headroom below server maximum.
- Bound job concurrency by the database pool, not only CPU or Redis throughput.
- Add statement/lock timeouts by workload class and inspect slow queries.
- Enable managed backups/PITR and perform a staging restore drill. Verify outbox/receipt/review lifecycle consistency after restore.
- Record table/index sizes, vacuum/analyze health, dead tuples, and long transactions before deciding on partitioning.
- Migration deploys have an owner, preflight, observed lock impact, rollback/roll-forward procedure, and post-deploy schema check.

### 7.4 Runbooks

Create concise runbooks for:

- Redis unavailable/restarted;
- outbox age rising;
- consumer poison event or retry storm;
- GBP auth revoked/429/5xx;
- synchronization freshness breach;
- deletion backlog breach;
- database saturation/slow query;
- cache stampede/failure;
- region unavailable/misconfigured;
- rollback during expand/backfill/contract;
- replaying one consumer/event range safely.

Every alert links to a runbook, owner, diagnostic query/dashboard, safe mitigation, and escalation threshold.

## 8. Test and CI architecture

### 8.1 Test layers

| Layer                    | Dependencies                   | Purpose                                                                                      |
| ------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------- |
| Pure unit                | None                           | Domain rules, routing, cursors, hashes, calendars, retry math, cache keys.                   |
| Component/Storybook      | Browser DOM/mocks              | Inbox/property states, policy-disabled states, unresolved-region UI, accessibility.          |
| PostgreSQL integration   | Real PostgreSQL                | Transactions, constraints, outbox receipts, cursors, backfills, rollups, lifecycle.          |
| Redis/BullMQ integration | Real Redis with queue settings | Schedulers, retries, stalls, duplicate job IDs, graceful shutdown, restart recovery.         |
| Contract                 | Mock HTTP server               | Google schemas/error behavior/timeouts; later provider adapters.                             |
| Critical E2E             | Built app + PostgreSQL + Redis | Connect/import fixture, review arrival, inbox projection, reply workflow, disconnect/delete. |
| Migration                | Clean and pre-PRE17 database   | Exact production migration path and schema assertions.                                       |
| Load                     | Production-shaped seed/runtime | Throughput, latency, query/pool/queue behavior.                                              |
| Fault/chaos              | Integration/staging            | Crash and dependency failure boundaries.                                                     |

Do not label a mocked repository test “integration.” Pure tests run parallel. Tests sharing schema/database state use isolated databases/schemas or deterministic serial groups; avoid file-level concurrency bugs disguised as flakes.

### 8.2 Blocking CI graph

1. Install with frozen lockfile and cache keyed by lockfile/runtime.
2. Static gates in parallel: formatting, lint, typecheck, architecture/dependency rules, migration-history check.
3. Build gates in parallel: web, worker, Storybook.
4. Pure unit and component tests in parallel.
5. PostgreSQL migration/integration job using `migrate`, never `db:push`.
6. Redis/BullMQ integration job with an actual Redis service.
7. Critical E2E against built artifacts with deterministic seed accounts/data.
8. Dependency/secret scanning appropriate to the repository and generated SBOM/container process if deployed as containers.

Remove `continue-on-error` from repaired Storybook and critical E2E jobs. Quarantining a test requires an owner, issue, reason, expiry date, and a smaller blocking replacement; deleting interactions merely to make a suite green is not completion.

Keep load, restore, and destructive fault suites scheduled/on-demand in production-like staging rather than every small PR, but require a recorded passing run for PRE17 and major runtime changes.

### C4 — Repair and promote delivery gates (1–2 days)

1. Split current test commands/layers and document their ownership/dependencies.
2. Add Redis to the relevant CI job and migration-based schema setup to all DB jobs.
3. Repair registration/seed issues blocking E2E and restore meaningful Storybook interactions.
4. Build the exact deployable web/worker artifacts in CI.
5. Set practical job timeouts and upload content-safe test/build reports on failure.
6. Add a CI assertion that production source files cannot import test adapters and routes do not accidentally include test files.

## 9. Load and fault-evidence plan

### 9.1 Production-shaped dataset

Use a deterministic generator with no real personal data:

- 100 organizations and 5,000 properties with US/Europe/global/time-zone distribution;
- 500,000 active review records across realistic skew, including a few high-volume properties;
- matching inbox/reply states without copying source content;
- representative portal metric history and daily rollups;
- outbox/receipt/sync/lifecycle operational history at retained sizes;
- enough historical content-free rows to expose index/table growth.

Record database version/size/CPU/memory/storage, Redis topology, replica/worker counts, pool sizes, seed commit, and application commit with every result.

### 9.2 Scenarios

| Scenario              | Workload                                                   | Required evidence                                            |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| Steady arrival        | 20 review facts/sec for at least 30 minutes                | No loss, bounded DB/queue/pool use, objectives met.          |
| Burst                 | 100/sec for 60 seconds                                     | 6,000 accepted, no duplicates, drain ≤10 minutes.            |
| Single-property burst | Concentrated updates/timestamp ties                        | Cursor/order/unique contention remains safe.                 |
| Reconnect/import      | At least 100 properties with paged histories, staggered    | Live/interactive work protected; resumable progress.         |
| Fleet dispatch        | 5,000 due properties over four hours                       | No scheduler herd or excessive Redis entries.                |
| Dashboard mix         | Warm/cold 1/7/30/90-day property views by authorized roles | p95 budgets, no tenant/cache leakage, bounded statements.    |
| Retention/deletion    | Expire and disconnect large properties during arrival      | Eventual complete purge, no resurrection, backlog objective. |
| Reconciliation        | Recent 35-day rollup repair while traffic continues        | Bounded DB impact and exact repair.                          |

### 9.3 Fault injection

Run at least:

- database failure before/after source commit;
- relay crash after claim and after Redis add;
- Redis unavailable/restart/failover;
- worker SIGTERM and forced termination during handler execution;
- duplicate/out-of-order events and poison payload;
- GBP 429 with retry delay, 5xx, timeout, malformed response, revoked auth, and 404;
- cache outage and stampede;
- lifecycle purge racing sync/reconnect;
- region capability missing and attempted cross-region fallback;
- database restore with published/unpublished outbox rows.

For each, capture expected invariant, trigger, measured impact, recovery time, final row/receipt counts, and telemetry/alert behavior. “The process restarted” is not proof; assert business outcomes.

### C5 — Execute closure tests and tune (2–3 days)

1. Establish a baseline before tuning.
2. Capture slow query plans with buffers and table/index statistics.
3. Tune indexes, batch sizes, queue concurrency, pools, cache, and dispatch windows one variable at a time.
4. Repeat scenarios from a clean deterministic seed and compare results.
5. Store a content-free Markdown result report under `docs/performance/` with commands/configuration/raw artifact links and pass/fail against objectives.
6. File remaining capacity risks with owners; a failed correctness or recovery invariant blocks PRE17 closure.

## 10. Rollout and rollback

- Instrumentation: no-op locally by default, leakage-tested in staging, then `ENABLE_OTEL` in production. Telemetry export failure never blocks business work; bounded buffers/drop metrics prevent memory growth.
- Read model: expand/backfill/shadow/cut over/observe/drop views. Rollback switches reads to raw queries while retaining rollups for diagnosis; do not refresh dropped views as a hidden fallback.
- Cache: enable per dashboard section. A kill switch bypasses cache and loads bounded DB queries; cache writes are never required for correctness.
- Health: deploy liveness before changing orchestrator probes; verify grace periods and termination timing in staging.
- Redis separation: migrate queue/cache one role at a time, verify keys/workers, and keep PostgreSQL outbox replayable.
- CI: fix the suite before making it blocking in the same change; do not leave “temporary” non-blocking gates without dated ownership.

## 11. Suggested commit sequence

1. `docs: record read-model and telemetry ADRs`
2. `db: add property-local daily metric rollups`
3. `feat: project and reconcile metric rollups idempotently`
4. `feat: cut dashboard metrics to incremental read models`
5. `db: remove unused dashboard materialized views`
6. `refactor: deepen and wire the dashboard cache`
7. `feat: add content-safe OpenTelemetry adapter and propagation`
8. `feat: add process readiness and worker heartbeats`
9. `test: add telemetry leakage and operational recovery coverage`
10. `ci: split and enforce migration, integration, build, component, and e2e gates`
11. `perf: add deterministic target-scale and failure harnesses`
12. `docs: record PRE17 scale and chaos evidence`

## 12. Definition of done

PRE17C is done when:

- Dashboard metric reads use verified property-local incremental rollups; dead materialized views/jobs are removed.
- No Google-derived read model is created unless ADR 0031 classifies it as permitted per-property derivative metadata; cross-property and review-solicitation gamification models remain prohibited.
- Cache keys and results cannot cross organization/property/role/portal boundaries, cache contains no review content, and failure safely falls back.
- OpenTelemetry traces/metrics and structured logs expose delivery, sync, lifecycle, cache, query, and worker health without sensitive content or high-cardinality metric labels.
- Liveness, role-specific readiness, heartbeats, SLO alerts, and runbooks work in staging fault tests.
- Queue and cache Redis have production-appropriate isolation/settings; database connection, backup, restore, and migration practices are documented and exercised.
- All static, migration, unit, PostgreSQL, Redis/BullMQ, build, Storybook, and critical E2E gates are blocking and green.
- Target dataset, steady/burst/reconnect/dashboard/deletion loads, and the required fault matrix pass with a reproducible evidence report.
- No unbounded scans, fixed maintenance caps, fleet-wide cron herd, or unjustified partitioning remains.
- The final PRE17 acceptance matrix in the master plan is signed off before Phase 17 implementation starts.

## 13. Primary references

- [PostgreSQL materialized views](https://www.postgresql.org/docs/current/rules-materializedviews.html)
- [PostgreSQL `REFRESH MATERIALIZED VIEW`](https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html)
- [PostgreSQL partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- [PostgreSQL index-only scans](https://www.postgresql.org/docs/current/indexes-index-only-scans.html)
- [BullMQ production guidance](https://docs.bullmq.io/guide/going-to-production)
- [BullMQ telemetry](https://docs.bullmq.io/guide/telemetry)
- [OpenTelemetry messaging metrics](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-metrics/)
- [OpenTelemetry GenAI metrics](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-metrics.md)
- [PRE17 primary-source findings](pre17-ai-readiness-primary-research-2026-07-14.md)
