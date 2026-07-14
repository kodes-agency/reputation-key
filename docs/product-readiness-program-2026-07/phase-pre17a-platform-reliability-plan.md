# Phase PRE17A — Platform Reliability Plan

**Status:** Ready for implementation after the current inbox/goal redesign is committed  
**Parent:** [Phase PRE17 master plan](phase-pre17-master-plan.md)  
**Estimate:** 12–18 engineering days  
**Primary gate:** A committed business change cannot lose its cross-context work, and every blocking build/test/migration check is green.

## 1. Purpose and boundaries

PRE17A creates the reliable execution substrate that review ingestion and future review intelligence will use. It fixes the current baseline, makes database migrations reproducible, gives jobs one owned runtime, and replaces persistence-followed-by-in-memory-event emission with an atomic PostgreSQL outbox and idempotent consumers.

This plan does not change review retention semantics, redesign Google synchronization, add regional routing, introduce AI concepts, or optimize dashboard queries. Those changes belong to PRE17B and PRE17C.

## 2. Current problems this plan must remove

- `src/shared/events/event-bus.ts` runs handlers in-process with `Promise.allSettled`, logs failures, and returns success. A process exit or handler failure can permanently lose a projection.
- Use cases commonly persist state and then call `events.emit`. Those two operations are not atomic.
- Some handlers emit secondary events. A retry can repeat downstream work, and failures are not durably visible.
- The worker entry point owns queue creation, job dispatch, schedule installation, and shutdown in one file. Contexts cannot add jobs without editing the monolith.
- Recurring work uses the legacy repeatable-job API rather than BullMQ Job Schedulers.
- The web process is documented as not needing a queue, but durable API-originated events require an outbox relay path that does not depend on a web request waiting for Redis.
- Production documentation requires generated Drizzle migrations, while CI creates business schema with `db:push`; materialized-view SQL has a separate, partially invisible lifecycle.
- The measured baseline has five deterministic recurring-goal test failures, a broken web build under Vite 8/Rolldown, and a repository-wide formatting gate that includes files it should not own.

## 3. Decisions and invariants

Write ADR 0024, ADR 0025, and ADR 0028 before implementation.

### 3.1 Reliability boundary

PostgreSQL is authoritative for both committed business state and the obligation to notify other contexts. Redis and BullMQ are delivery infrastructure, not the source of truth.

Every cross-context flow follows these rules:

1. A source context commits its state and an outbox event in one database transaction.
2. A relay claims committed outbox rows and adds identifier-only jobs to BullMQ.
3. A consumer applies its projection and inserts its consumer receipt in one database transaction.
4. Delivery is at least once. Duplicate handling is a normal path, not an exceptional path.
5. Job IDs reduce unnecessary duplicate execution but never establish correctness.
6. Network calls are not made inside a business-state or receipt transaction. An external action requires its own durable command/delivery record.
7. A handler failure is thrown and retried or moved to an operator-visible terminal state. It is never swallowed.

This follows the official [transactional-outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) and BullMQ's [idempotent-job guidance](https://docs.bullmq.io/patterns/idempotent-jobs).

### 3.2 Deep module seams

Do not expose Drizzle transactions through application ports. Each source context gets a narrow command-store method that hides the atomic state write and outbox append. Each consuming context gets a narrow projection command that hides the projection write and receipt insert.

Proposed shared contracts:

```ts
type EventEnvelope<TType extends string, TPayload> = Readonly<{
  eventId: string
  eventType: TType
  eventVersion: number
  aggregateType: string
  aggregateId: string
  organizationId: string | null
  occurredAt: Date
  payload: TPayload
  traceparent?: string
}>

type DurableEventHandler<TEvent> = Readonly<{
  consumerName: string
  eventType: TEvent['eventType']
  handle(event: TEvent): Promise<'processed' | 'duplicate' | 'obsolete'>
}>
```

The public surface must not expose `outbox_events`, receipt tables, BullMQ `Job`, Redis, or Drizzle types. Payload schemas live with the source context and are runtime-validated at the dispatcher boundary.

### 3.3 Event contracts

- Use stable dot-separated names and a positive integer version, for example `review.received.v1`.
- Event IDs are UUIDs allocated before the business transaction.
- Payloads contain identifiers and immutable routing facts only. They never contain review text, reviewer name/photo, reply text, feedback text, tokens, or upstream response bodies.
- Changes that alter meaning create a new event version. Additive optional fields alone do not require a new handler if old payloads remain valid.
- `occurredAt` is the business transaction time unless the event explicitly names a source timestamp.
- Events are facts in past tense. Requests to perform work are jobs/commands and have separate names.
- Organization identity is included when known for authorization/routing, but it is not used as a telemetry label.

## 4. Data model

Add the following objects through generated, journaled Drizzle migrations. Exact names may change during ADR review, but the behavior may not.

### 4.1 `outbox_events`

| Column                           | Requirement                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `id`                             | UUID primary key; also the logical delivery/job ID.                                                                   |
| `event_type`, `event_version`    | Indexed contract identity.                                                                                            |
| `aggregate_type`, `aggregate_id` | Source aggregate identity; no polymorphic FK.                                                                         |
| `organization_id`                | Nullable UUID/varchar matching the current organization key type; indexed for controlled erasure and support queries. |
| `occurred_at`                    | Source commit/business time.                                                                                          |
| `payload`                        | JSONB validated before insertion and again before dispatch. Identifier-only.                                          |
| `traceparent`                    | Nullable W3C trace context, bounded length.                                                                           |
| `available_at`                   | Earliest relay attempt; supports retry backoff.                                                                       |
| `claimed_by`, `claimed_until`    | Lease rather than a permanent processing flag.                                                                        |
| `delivery_attempts`              | Incremented atomically on claim.                                                                                      |
| `published_at`                   | Set after BullMQ accepts the job.                                                                                     |
| `last_error_code`                | Sanitized bounded classification; never raw errors/content.                                                           |
| `created_at`                     | Operational/audit timestamp.                                                                                          |

Indexes:

- A partial relay index over `(available_at, occurred_at, id)` where `published_at IS NULL`.
- An index over `(organization_id, created_at)` for bounded erasure/support scans.
- No index includes `payload`.

Relay claims use a short PostgreSQL transaction with `FOR UPDATE SKIP LOCKED`, a lease token, and a bounded batch. The Redis call occurs after the claim transaction. A crashed relay leaves an expiring lease, not an abandoned row. PostgreSQL documents `SKIP LOCKED` as appropriate for queue-like multi-consumer access; it is not used for user-facing consistent reads.

### 4.2 `event_consumer_receipts`

| Column                        | Requirement                                                       |
| ----------------------------- | ----------------------------------------------------------------- |
| `event_id`, `consumer_name`   | Composite primary key; this is the authoritative idempotency key. |
| `event_type`, `event_version` | Debuggable contract identity.                                     |
| `organization_id`             | Optional erasure/support index.                                   |
| `outcome`                     | `processed` or `obsolete`; duplicates do not create another row.  |
| `processed_at`                | Completion time.                                                  |

The receipt must commit in the same transaction as the consuming context's state change. A generic dispatcher cannot insert the receipt first and then invoke the handler.

Retain published outbox rows for 7 days and receipts for 90 days. Purge with bounded cursor batches. Retention values are configuration with these production defaults, not magic constants.

### 4.3 Optional operational tables

Do not add a database-backed dead-letter table merely to mirror BullMQ failures. PRE17C adds operator views and heartbeats. Add a dedicated delivery table only for a real external side effect whose business status cannot be represented by an existing context.

## 5. Target modules

Proposed layout:

```text
src/shared/events/
  contract.ts                 # envelope primitives only
  schema-registry.ts          # event type/version -> Zod parser
src/shared/outbox/
  application/               # relay and retention services
  infrastructure/            # PostgreSQL repo, BullMQ publisher
src/shared/jobs/
  contracts.ts               # JobDefinition, ScheduleDefinition
  runtime.ts                 # queues, workers, schedulers, lifecycle
  registry.ts                # validates unique job/schedule ownership
  policies.ts                # named retry/timeout/concurrency policies
```

Each context exposes a `buildXContext(dependencies)` result with only its public commands, queries, event handlers, job definitions, and schedule definitions. `src/composition.ts` assembles contexts; it must stop exposing repositories as a flattened service locator. `src/bootstrap.ts` validates registrations. `src/worker/index.ts` becomes a small process entry point that starts the runtime and closes it on signals.

Job definitions declare:

- owner context, queue class, name, payload schema, and handler;
- timeout behavior and retry policy by named profile;
- concurrency and rate-limiting requirements;
- whether absence of Redis is fatal for that process;
- content classification; PRE17 jobs should be identifier-only;
- an optional schedule definition installed with the current [BullMQ Job Scheduler API](https://docs.bullmq.io/guide/job-schedulers).

Initial queue classes:

| Queue           | Purpose                                                | Initial concurrency policy                                                 |
| --------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `domain-events` | Durable cross-context event dispatch                   | High enough to drain bursts; handler-level DB limits remain authoritative. |
| `interactive`   | Existing user-triggered asynchronous actions           | Protected from maintenance work.                                           |
| `background`    | Reconciliation, retention, imports, and scheduled work | Lower concurrency and staggered dispatch.                                  |

Do not add AI queues yet. PRE17 only makes the runtime able to add them without changing the worker entry point.

## 6. Implementation tracks

### A0 — Freeze and restore the baseline (1–2 days)

1. Commit or isolate the current inbox/goal redesign and migration `0003`; record its commit as the PRE17 upgrade-test baseline.
2. Fix the five recurring-goal tests by injecting/controlling time at the use-case/job boundary. Do not loosen assertions around calendar behavior.
3. Update Vite 8 configuration to supported `build.rolldownOptions` and function-form chunking, following the official [Vite build options](https://vite.dev/config/build-options.html).
4. Ensure route test files are excluded with the supported TanStack Router ignore convention or a deliberate route-generator ignore configuration.
5. Add a `.prettierignore` limited to generated artifacts, external skill/tooling caches, output artifacts, and vendored files. Format repository-owned source/docs once in an isolated commit after confirming it does not conceal functional changes.
6. Make web build and worker build blocking locally and in CI.

Exit proof: the current feature baseline passes typecheck, lint, format, unit tests, web build, and worker build before reliability refactoring starts.

### A1 — Make migration history authoritative (1–2 days)

1. Inventory every table, constraint, index, view, function, and extension in a representative upgraded database.
2. Move required sidecar DDL into ordered custom Drizzle migrations without rewriting already-applied files.
3. Document one production command path: `drizzle-kit generate`/custom migration creation, review generated SQL, `drizzle-kit check`, and `drizzle-kit migrate`.
4. Replace CI `db:push` for business schema with migrations.
5. Add two migration tests:
   - empty database → latest;
   - committed pre-PRE17 baseline → latest.
6. Compare expected schema objects after both paths. Fail for an unjournaled business object.
7. Set per-migration lock and statement-timeout guidance. Data backfills run as retryable application/admin jobs, not one unbounded deployment transaction.

Exit proof: local, CI, staging, and production use the same ordered migration history, consistent with official [Drizzle migration guidance](https://orm.drizzle.team/docs/migrations).

### A2 — Deepen composition and the job runtime (2–3 days)

1. Define context build results and job/schedule contracts.
2. Move queue names, defaults, Redis connections, handler lookup, completion/failure hooks, and graceful shutdown behind `JobRuntime`.
3. Make duplicate job names, duplicate scheduler IDs, missing handlers, and invalid payload schemas fail at startup.
4. Migrate repeatable jobs to `upsertJobScheduler` with stable IDs. Start with existing health, review retention, metric, goal, recognition, and notification schedules.
5. Apply stagger/jitter to fleet work. Do not enqueue all property work at the same instant.
6. Use a fail-fast queue connection for API-originated enqueue operations; background workers use BullMQ's required blocking connection behavior. The durable outbox means the web request never waits indefinitely for Redis.
7. Add bounded shutdown: stop accepting new work, close schedulers/relays, wait for active jobs up to a configured deadline, then exit non-zero if drain failed.
8. Remove direct queue construction from contexts and the worker entry point.

Exit proof: adding a new job or schedule requires changing only the owning context manifest and composition registration, not `src/worker/index.ts`.

### A3 — Add the outbox and durable dispatcher (3–4 days)

1. Create and test `outbox_events` and `event_consumer_receipts` migrations.
2. Add an event schema registry. Reject an unknown type/version or invalid payload before enqueue and before consumption.
3. Implement bounded lease claiming with `SKIP LOCKED`, exponential backoff with jitter, maximum retry delay, and sanitized error classifications.
4. Publish to `domain-events` with the event UUID as BullMQ job ID.
5. Mark `published_at` only after BullMQ accepts the add. Treat “job already exists” as accepted for that ID.
6. Implement a dispatcher that resolves handlers by event type/version and invokes each consumer independently. One consumer's terminal failure must not prevent other consumers from receiving the event.
7. Give every consumer command store an atomic `applyOnce(eventId, mutation)` behavior. A duplicate returns `duplicate`; a missing/deleted/obsolete source commits an `obsolete` receipt.
8. Add a reconciliation schedule for unpublished expired leases and a bounded retention schedule.
9. Preserve trace context, but never payload content, through relay and dispatch.

Required crash tests:

| Injection point                                      | Expected result                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| Before business commit                               | No state and no outbox row.                                           |
| After business commit, before Redis add              | State and unpublished outbox row; relay eventually enqueues.          |
| After Redis add, before `published_at`               | Relay may enqueue again; consumer applies once.                       |
| After consumer state mutation, before receipt commit | Both roll back; retry applies once.                                   |
| After consumer commit, before BullMQ acknowledgement | Retry sees receipt and no-ops.                                        |
| Worker termination during a handler                  | Lock/stall recovery retries; receipt remains authoritative.           |
| Redis unavailable                                    | Business command still commits; outbox age rises; recovery drains it. |

### A4 — Migrate event producers and consumers (4–6 days)

Migrate by vertical slice, not by replacing the event bus globally in one commit.

Recommended order:

1. Review → inbox/activity/metric/notification paths, because PRE17B depends on them.
2. Metric → goal/badge/leaderboard paths.
3. Property lifecycle and integration/import paths.
4. Inbox and reply lifecycle paths.
5. Portal, guest, staff, team, identity, and remaining recognition paths.

For each event family:

1. Inventory producers, consumers, payload content, current transactional boundary, and expected duplicate behavior.
2. Define a versioned identifier-only event schema.
3. Add a source-context command-store method that persists state and the event atomically.
4. Add per-consumer atomic projection + receipt behavior.
5. Add duplicate, reorder, missing-source, and handler-failure tests.
6. Run in `record_only` mode: outbox rows are written and validated, but the relay does not dispatch them.
7. Compare recorded events with legacy emissions using counts and IDs, without logging content.
8. Stop legacy consumption for that event family, enable durable dispatch, and verify backlog/receipts.
9. Remove the legacy producer call and shadow comparison for that family.

Secondary events are allowed only when the consuming context commits its state and new outbox event together. If one handler currently writes several contexts, split it into independently idempotent consumers rather than recreating a distributed transaction.

Testing scenario builders must call application commands or seed source state plus explicit outbox records. They must not directly invoke a production in-memory bus to simulate persistence.

### A5 — Remove the legacy path and harden CI (1–2 days)

1. Add an architecture test that fails when an application use case imports or calls the legacy `EventBus` after a repository write.
2. Remove production registrations for the in-process event bus. A minimal synchronous test event collector may remain under `src/shared/testing` only.
3. Remove temporary `record_only`/legacy flags after at least one staging fault-test window and the agreed production observation window.
4. Make the following CI jobs blocking:
   - formatting, lint, typecheck;
   - pure unit tests;
   - PostgreSQL migration + integration tests;
   - Redis/BullMQ integration tests;
   - web build and worker build.
5. PRE17C will add/promote Storybook, critical E2E, load, and chaos gates; PRE17A must provide stable commands and services for them.

## 7. Producer and consumer completion checklist

Every migrated event family must answer all of these in its PR description:

- What transaction commits the fact and outbox row?
- Is the payload identifier-only and runtime-validated?
- What consumers exist, and what unique `consumerName` does each own?
- What state mutation commits with each receipt?
- What happens if the source no longer exists?
- Can events arrive twice or out of order without regressing state?
- Does any handler call a network service? If so, where is its durable delivery record?
- Which metric exposes a stuck or terminal failure?
- How is organization/property deletion prevented from resurrecting work?

## 8. Rollout and rollback

Use an enum-valued control internally even if exposed through `ENABLE_DURABLE_EVENTS`:

1. `legacy`: baseline only; allowed before the outbox migration.
2. `record_only`: atomic outbox writes, no relay; validate event parity.
3. `durable`: relay/consumers active and legacy consumers off for migrated families.

Never run legacy and durable consumers against the same side effect merely to compare them. Shadow comparison observes contracts/counts, not duplicate writes.

Rollback from `durable` stops relay dispatch and returns only an event family whose legacy producer is still deployable. Already committed outbox rows are retained. Do not delete or mark them published during rollback. After the legacy code is removed, rollback is roll-forward only: fix the consumer and replay its failed/unreceipted events.

## 9. Operational gates

- Relay batch size, lease, concurrency, and retry delays are configuration with safe bounds.
- Alerting inputs exist for oldest unpublished event, unpublished count, relay errors, dispatch age, consumer failures, and receipt rate.
- Queue job retention is long enough for diagnosis but is not the source of historical truth.
- No raw payload appears in logs, job names, error messages, traces, or metrics.
- One event type cannot starve all others; dispatch concurrency and database pool use are bounded.
- The system drains a 60-second 100 events/second burst without loss. Final drain-time SLO is set and proven in PRE17C.

## 10. Suggested commit sequence

Keep each commit independently reviewable and green:

1. `docs: record PRE17 durable delivery and job runtime ADRs`
2. `test: restore deterministic baseline and blocking build commands`
3. `build: make versioned migrations the only schema path`
4. `refactor: introduce context job and schedule manifests`
5. `refactor: move worker lifecycle behind the job runtime`
6. `db: add outbox events and consumer receipts`
7. `feat: add outbox relay and durable event dispatcher`
8. `test: prove relay and consumer crash boundaries`
9. One commit per migrated event family or tightly coupled vertical slice.
10. `refactor: remove production in-process event delivery`
11. `ci: enforce platform reliability gates`

## 11. Definition of done

PRE17A is done when:

- All measured baseline failures are fixed and every PRE17A CI job is blocking and green.
- Clean and upgrade databases reach an identical expected schema through migrations.
- No production application use case depends on persistence followed by an in-memory event emission.
- All cross-context consumers are transactionally idempotent and have duplicate/reorder/missing-source tests.
- All existing schedules use the owned runtime and current BullMQ Job Schedulers.
- Fault injection proves no lost event or duplicate visible side effect across every commit/enqueue/acknowledgement boundary.
- Temporary legacy delivery controls are removed or have an explicit dated production-removal ticket before PRE17 closes.
- PRE17B can consume durable review events and register ingestion/lifecycle jobs without changing the platform runtime.

## 12. Primary references

- [AWS transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [PostgreSQL `SKIP LOCKED`](https://www.postgresql.org/docs/current/sql-select.html)
- [PostgreSQL partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html)
- [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)
- [BullMQ job IDs](https://docs.bullmq.io/guide/jobs/job-ids)
- [BullMQ Job Schedulers](https://docs.bullmq.io/guide/job-schedulers)
- [BullMQ graceful shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown)
- [BullMQ Redis-unavailable behavior](https://docs.bullmq.io/patterns/failing-fast-when-redis-is-down)
- [Drizzle migrations](https://orm.drizzle.team/docs/migrations)
- [Vite build options](https://vite.dev/config/build-options.html)
- [PRE17 primary-source findings](pre17-ai-readiness-primary-research-2026-07-14.md)
