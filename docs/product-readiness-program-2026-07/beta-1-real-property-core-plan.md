# BETA-1 — Reliable Real-Property Core

**Status:** Proposed  
**Date:** 2026-07-14  
**Effort:** 20–30 engineering days, including PRE17A/B overlap  
**Depends on:** BETA-0; received Google disposition translated into accepted ADR 0031/source policy before real GBP content  
**Unlocks:** One-property shadow sync and controlled human reply publication

## 1. Objective

Make the review path—the product's primary value—durable, property-scoped, recoverable, and visible to operators:

```text
Google connection
  -> notification or reconciliation
  -> source review lifecycle
  -> inbox/activity/metric projections
  -> human triage and reply draft
  -> human-approved Google publish
  -> observable terminal state
```

This phase concentrates on actual Google reviews. Guest feedback, portals, recognition, and AI remain dark unless their later independent gates are completed.

## 2. Non-negotiable invariants

1. Every persisted business row belongs to exactly one organization and, where relevant, one property. The relationship is verified in commands and protected by database constraints where practical.
2. A committed source state cannot lose the work required to update its projections or external workflow.
3. Retrying any handler/job cannot create a duplicate review, note, notification, reply publication, email, or lifecycle action.
4. A worker never trusts a caller-supplied organization, route, provider endpoint, or capability; it re-resolves policy from canonical property identity.
5. External calls occur outside long database transactions, but their intent and outcome are durably modeled.
6. Google timestamps and identifiers are source truth. Application receipt and processing timestamps are separate fields.
7. Review source content and every derivative carry provenance, fetched-at, policy/route version, and expiry/deletion state required by the approved Google disposition.
8. A property cannot silently change processing region after source data exists.
9. A manager explicitly initiates or approves every reply publication. No auto-publish and no AI path exist in this beta.
10. Archive/disconnect/purge are workflows with retryable steps and evidence, not cascading UI deletes.

## 3. Adopt PRE17 without duplicating ownership

The detailed PRE17 plans remain authoritative for their implementation seams:

- [PRE17A](phase-pre17a-platform-reliability-plan.md): migration authority, durable events, job runtime, outbox, idempotency, failure policy.
- [PRE17B](phase-pre17b-review-data-and-regional-readiness-plan.md): bounded review ingestion, source timestamps/lifecycle, reconciliation, property routing.
- [PRE17C](phase-pre17c-scale-observability-and-closure-plan.md): operational telemetry/read models; the parts needed to operate the first property are pulled forward here.

BETA-1 adds authorization, complete property lifecycle, external workflow state, projection repair, and end-to-end property evidence around those seams.

## 4. Architectural decisions

Complete PRE17 ADRs 0025–0031 and add:

- **ADR 0034 — Property and organization lifecycle:** archive, suspend, disconnect, export, purge, evidence, cancellation, and recovery states.
- A versioned **Google source-content policy** derived from the [written response](google-business-profile-ai-policy-response-2026-07-14.md). It controls raw refresh/removal, separately retained derivatives, per-property isolation, PII/provider/region/consent conditions, backup/cache/log behavior, and purge deadlines.
- A clear **control-plane/data-plane boundary:** global low-sensitivity identity/configuration may remain central; review content, derivatives, queues, storage, telemetry, backups, and future AI calls follow property processing region.

Google has permitted the submitted per-property derivatives, but raw content remains temporary. Do not treat a short expiry column or the derivative permission as authorization to retain raw content in backups, materialized views, batch objects, prompts, or logs beyond the approved cache/provider lifecycle.

## 5. Deep modules to build

### `ContextCommandStore`

Each context exposes a small command-oriented persistence interface that can commit canonical state and an outbox record in one injected transaction. Avoid a universal repository/unit-of-work abstraction.

### `JobRuntime`

Owns stable job identity, queue selection, schema version, retry/terminal classification, backoff, trace context, cancellation/capability checks, heartbeat, graceful shutdown, and dead-letter/redrive metadata. Business handlers receive typed data; they do not configure BullMQ ad hoc.

### `ExternalWorkflow`

Models intent, attempt, provider request identity, provider result, ambiguous outcome, reconciliation, terminal state, and operator action for Google connect/import/reply/disconnect. It prevents the “API succeeded, process crashed before DB update” gap.

### `SourceContentLifecycle`

Owns provenance, current source version, fetched-at, publication/update timestamp, policy version, expiry, tombstone, derivative invalidation, deletion propagation, and evidence. Review queries cannot return expired/deleting content.

### `PropertyProcessingProfile`

Owns validated country, IANA time zone, processing region, assignment provenance, route-policy version, permitted provider/data endpoints, and change state. Unsupported or conflicting routes fail closed.

## 6. Work packages

### B1.1 — One migration authority and schema integrity

Tasks:

1. Define one versioned production migration command and journal for Better Auth schema, generated Drizzle migrations, raw SQL/triggers, materialized views, and backfills.
2. Remove deployment use of `db:push`. Restrict it to disposable local prototyping if retained.
3. Separate migration owner credential from least-privilege web and worker roles. Use direct/pooled endpoints deliberately.
4. Add advisory-lock serialization so one release applies migrations once.
5. Add blank-install and sanitized prior-release upgrade CI with schema/invariant verification.
6. Use expand → backfill → validate → cutover → contract for tenant keys, lifecycle fields, processing region, outbox, workflow, and dedupe constraints.
7. Add lock and statement timeouts plus abort/rollback instructions for production-like cardinality.
8. Reconcile schema/runtime fragmentation: every trigger, view, index, constraint, and Better Auth object must be owned and versioned.

Required constraints/invariants include:

- organization/property consistency for staff/team/portal/review/inbox/metric/notification relationships;
- unique Google account/location/source review identities at the correct tenant scope;
- unique stable event/job/idempotency keys;
- conditional workflow/state transitions that reject stale writers;
- one immutable or explicitly migrating processing profile per property;
- uniqueness/ownership for outbox delivery and webhook receipt records;
- no orphan current reply, current review source version, or lifecycle task.

Acceptance evidence:

- clean install and prior-release upgrade pass with the identical command;
- web/worker roles cannot alter schema or access another database;
- interrupted migration/backfill resumes or safely aborts;
- production-like migration timing and lock evidence is recorded.

### B1.2 — Transactional outbox and event contracts

Tasks:

1. Introduce a versioned outbox schema containing event ID, aggregate/context, organization/property, type/version, minimal payload, occurred/available time, attempts, lease, delivered/terminal state, and trace ID.
2. Commit domain state and outbox event atomically through the context command store.
3. Relay due records to BullMQ with stable job IDs; lease with `FOR UPDATE SKIP LOCKED` or equivalent; recover abandoned leases.
4. Record consumer receipts or enforce outcome uniqueness so replay is safe.
5. Define schema/version/ordering/idempotency/failure behavior for every emitted/consumed event in all contexts.
6. Replace the in-memory `Promise.allSettled` bus on durability-required paths. It may remain only for explicitly best-effort in-process observations with no correctness impact.
7. Add replay/repair commands scoped by context, event range, organization/property, dry run, reason, and operator audit.
8. Minimize payloads to IDs, versions, route metadata, and trace context; load review/personal content inside the authorized worker.

Failure tests:

- crash after domain commit but before relay;
- duplicate relay and duplicate consumer delivery;
- consumer failure after partial projection work;
- out-of-order events;
- schema version unknown;
- property suspended while job waits;
- queue outage followed by recovery;
- redrive after handler code upgrade.

### B1.3 — Production `JobRuntime` and queue topology

Tasks:

1. Separate durable queue Redis from cache/rate-limit Redis. Configure private networking, TLS/ACLs, persistence/HA appropriate to beta, and `noeviction` for BullMQ.
2. Define queues and service classes rather than one global concurrency:
   - urgent review receipt/targeted sync;
   - external reply workflow;
   - ordinary projections/notifications;
   - bounded imports/reconciliation;
   - maintenance/retention/materialized refresh.
3. Give each job type stable ID, version, attempt limit, retryable/terminal error taxonomy, capped exponential backoff with jitter, timeout, and dead-letter retention.
4. Implement graceful SIGTERM, heartbeat, stalled-work recovery, poison quarantine, and operator redrive/cancel.
5. Add per-property/provider concurrency and quota controls so initial imports cannot starve new review handling.
6. Keep sensitive source text/tokens/presigned URLs out of Redis job data.

Acceptance evidence:

- killing a worker at every external-workflow boundary eventually reaches one correct outcome;
- Redis restart/latency and queue backlog do not lose accepted intents;
- an urgent review is not starved by a large import;
- operator tooling shows oldest age, attempts, route, reason, and safe next action without raw review content.

### B1.4 — Complete authorization and assignment transactions

Tasks:

1. Migrate property, integration, review, inbox, staff, team, activity, metric, dashboard, and notification entry points to the BETA-0 `AuthorizationPolicy`.
2. Replace staff-member multi-write replacement with a transaction enforcing organization/property/team/portal consistency.
3. Define immediate effective-access behavior for assignment add/remove and invalidate sessions/caches/read models where required.
4. Add last-owner/admin and self-removal rules for invitations, memberships, teams, and property access.
5. Decide that direct staff-to-property assignment covers the first pilot; keep teams dark unless a concrete pilot workflow requires them.
6. Add cross-tenant constraints and negative repository tests, including malicious IDs supplied directly to mutations.

Acceptance evidence:

- no role-string branch remains in the migrated core path;
- concurrent assignment changes preserve invariants;
- a removed operator cannot read or mutate the property through stale session/cache/job state;
- list, count, export, and aggregate queries cannot leak cross-property existence.

### B1.5 — Property lifecycle and processing profile

Replace the misleading `soft-delete-property` hard cascade with explicit states:

```text
active -> suspended -> archived -> disconnecting -> purge_pending -> purging -> purged
                    \-> active (only before irreversible purge)
```

Tasks:

1. Create/update validates country and IANA time zone and assigns a processing region through policy/provenance.
2. Prevent silent region mutation after source content/work exists. A legitimate move is a separately planned, resumable data migration with dual-read/cutover evidence.
3. Archive immediately blocks sync, publish, public surfaces, schedules, new jobs, and ordinary user reads while preserving recovery/evidence.
4. Disconnect revokes Google access/subscriptions, stops reconciliation, resolves/quarantines in-flight work, and displays progress/failure.
5. Purge is operator-confirmed after a defined grace/policy check, retryable by resource class, and produces content-free completion evidence.
6. Propagate deletion to source reviews/versions, reply workflows, inbox/notes, metrics/aggregates, notifications, activity subject payloads, caches, queue jobs, files, provider records where supported, telemetry, and backups according to policy.
7. Use typed-name confirmation and impact summary for irreversible steps; keep restore available only before the irreversible boundary.

Acceptance evidence:

- archive/reconnect/disconnect/purge failure injection leaves an operator-visible recoverable state;
- no scheduled or queued work produces external effects after suspension/archive;
- deletion evidence accounts for every owned/derived store without retaining prohibited content;
- unsupported processing regions cannot connect Google.

### B1.6 — Google connection and token lifecycle

Tasks:

1. Request only documented minimum scopes; verify returned scopes, expected Google account, and location ownership/management authority before activation.
2. Persist the selected Google account/location mapping as a verified invariant, preventing duplicate or cross-organization attachment.
3. Version AES-GCM ciphertext/key ID; implement rotation/re-encryption, compromised-key response, and dual-key read during transition.
4. Model connection state and reason: pending, active, degraded, reauth-required, suspended, disconnecting, disconnected, failed.
5. Make notification subscription creation/renewal/health a durable workflow instead of best effort.
6. Implement explicit timeouts, retry classification, quota/rate metrics, capped backoff with jitter, and a circuit/degraded state.
7. Provide reconnect and disconnect UX with precise consequences; never expose provider tokens/errors to users.
8. Enforce property region/capability before all provider use, with no automatic cross-region fallback.

Acceptance evidence:

- wrong account/location/scope and revoked-token cases fail safely with actionable status;
- key rotation preserves access and old-key retirement is evidenced;
- two organizations cannot attach the same provider identity contrary to the selected invariant;
- subscription loss is detected and reconciliation covers the gap.

### B1.7 — Durable Pub/Sub receipt and bounded review ingestion

Tasks:

1. Verify the exact supported Google/Pub/Sub request identity and deployment topology. Persist a minimal webhook receipt before 2xx with stable message identity, schema version, received time, and status.
2. Reject malformed/oversize/unauthorized requests. Deduplicate retries and give missing message IDs an explicit safe strategy—never `unknown` shared across unrelated messages.
3. Convert notification into a targeted property/location/review sync job; avoid an unbounded fleet-wide import.
4. Implement cursor/page iteration with maximum page/time budgets and durable checkpoint. A partial import resumes rather than restarts or reports success.
5. Keep initial import and periodic reconciliation distinct from urgent notification sync. Reconciliation is bounded and repairs missed/out-of-order messages.
6. Persist source publication/update timestamp separately from first-seen/fetched/committed time. Upsert only when source version advances.
7. Model deleted/updated/omitted reviews explicitly according to Google semantics and the approved content policy.
8. Return a failed/terminal BullMQ result correctly; do not catch and convert a crashed import into a successful job.
9. Record watermark, lag, page counts, throttling, unknown location, duplicate, failure class, and operator action.

Acceptance evidence:

- duplicate, reordered, malformed, delayed, and missing-notification suites converge to one correct review state;
- a multi-page import interrupted on every page resumes at its checkpoint;
- 95% healthy notifications are visible within 15 minutes and 99% within 60 minutes initially, while the application-specific receipt-to-commit target is measured separately;
- import bursts cannot violate provider quota or starve targeted sync.

### B1.8 — Source review lifecycle and policy enforcement

Tasks:

1. Add provenance and lifecycle metadata to source review/current version/reply content and every derived row that can outlive its source.
2. Implement executable retention policy and scheduled deletion/invalidation across primary rows, projections, MVs/cache, BullMQ, telemetry, files, exports, and backups.
3. Exclude expired/deleting content from every query before physical deletion completes.
4. Make derived activity/metrics/dashboard/notifications reference content-free IDs where possible and invalidate/recompute when source becomes unavailable.
5. Prevent Google source content from entering test fixtures, logs, error tools, email, or AI paths.
6. Produce a deletion evidence report by property/source/policy version and alert on overdue work.

Acceptance evidence:

- clock-controlled tests prove boundary times and no stale query/cache access;
- restoration/backups cannot silently resurrect content beyond permitted retention;
- every source-to-derivative edge in the lineage map has a deletion/invalidation owner;
- changing the policy version produces a bounded migration/re-evaluation plan.

### B1.9 — Inbox and review command correctness

Tasks:

1. Use cursor pagination with indexed property/status/sentiment-free/source-time sorts; define maximum page size and stable tie-breaker.
2. Make note/status/assignment/reply-draft commands conditional on expected version/state so concurrent managers receive a conflict instead of overwriting.
3. Preserve an explicit review state machine and reason-coded failures. Separate local draft state from provider-published reply state.
4. Prevent client-provided organization/property ownership fields from driving queries; derive them from the authorized resource.
5. Provide loading/empty/partial/stale/degraded/error states and source freshness in the UI.
6. Remove reviewer/source content from URLs, client telemetry, and broad root-loader payloads.

Acceptance evidence:

- concurrent triage/draft/publish tests have deterministic outcomes;
- 5,000-property membership does not require loading all properties into the authenticated root layout;
- an inbox page cannot infer another property's counts, review IDs, or reviewer identity;
- expired/deleted source content disappears predictably without broken projections.

### B1.10 — Idempotent human reply publication

Model publication as an external saga:

```text
draft -> publish_requested -> publishing
      -> published
      -> rejected_terminal
      -> outcome_unknown -> reconciling -> published|retryable|manual_review
```

Tasks:

1. Atomically persist the approved reply snapshot, actor, review source version, idempotency key, and outbox intent.
2. Enforce one active publication workflow per review and conditional state transitions.
3. Call Google with timeout and safe retry behavior. Never blindly retry an ambiguous side effect.
4. Record provider-safe identifiers/result codes and reconcile outcome after crash/timeout before redrive.
5. Make edit-after-publish and delete-reply semantics explicit and policy/permission controlled.
6. Present terminal, retrying, and manual-review states to the manager/operator. Provide safe retry/cancel/reconcile commands.
7. Emit activity/in-app notification only from committed workflow transitions; projection replay cannot duplicate visible entries.

Acceptance evidence:

- crash before call, during call, after provider success, and before local success persistence yields at most one Google-visible reply;
- stale review/source/deleted property/revoked operator cases block publication;
- operator can resolve an unknown outcome without direct database edits;
- every publication has an actor and durable audit trail.

### B1.11 — Replay-safe core projections

Contexts in scope: inbox, activity, metric, limited dashboard, in-app notification.

Tasks:

1. Declare projection source event/version, tenant/property key, cursor/watermark, freshness, and rebuild behavior.
2. Enforce outcome uniqueness and monotonic version application.
3. Make activity immutable enough for investigation but minimize payload and apply retention.
4. Make in-app notification preferences authoritative and creation idempotent. Email remains a separate disabled capability.
5. Permit only property-local, Google-policy-approved dashboard sections. Do not expose materialized views merely because they exist.
6. Delete unused refresh paths or wire MVs behind explicit read contracts, freshness metadata, tenant keys, and observable refresh.
7. Add bounded property-scoped rebuild commands and compare rebuilt state to live state.

Acceptance evidence:

- replay from an event range produces the same projection without duplicates;
- a projection outage does not block canonical review ingestion and catches up within target;
- dashboard/metric results are source-policy permitted and property-scoped;
- users see honest freshness/degraded status.

## 7. Cross-context lifecycle obligations

| Context      | BETA-1 responsibility                                                                 |
| ------------ | ------------------------------------------------------------------------------------- |
| activity     | Idempotent content-minimized projection; actor/property scope; lifecycle invalidation |
| badge        | Remain disabled; no consumers run from review events                                  |
| dashboard    | Limited permitted property read model; bounded queries; freshness                     |
| goal         | Remain disabled; no review/metric schedules or consumers                              |
| guest        | Remain disabled and absent from core review metrics                                   |
| identity     | Core authorization, invitation, session invalidation, property access                 |
| inbox        | Cursor read model and versioned triage/note/draft commands                            |
| integration  | Connection/token/subscription/import/disconnect external workflows                    |
| leaderboard  | Remain disabled; no snapshot/evaluation jobs                                          |
| metric       | Only policy-permitted property-local metrics; replay/rebuild semantics                |
| notification | Idempotent in-app only; email intent cannot be created unless enabled                 |
| portal       | Remain disabled; review data cannot leak into public routes/cache                     |
| property     | Processing profile and archive/disconnect/purge state machine                         |
| review       | Source lifecycle, versioning, reconciliation, manual publish workflow                 |
| staff        | Transactional direct property assignments and immediate access changes                |
| team         | Remain disabled unless separately promoted through its correctness gate               |

## 8. Verification strategy

### Contract and domain

- state-machine transition/property tests;
- priority-free review vocabulary and timestamps;
- processing-region assignment/change cases;
- error taxonomy and retry classification;
- retention boundary/clock tests.

### Database/repository

- clean migration and upgrade fixtures;
- cross-tenant negative tests for every query/command;
- constraint/race tests under concurrent transactions;
- outbox lease/consumer receipt/replay tests;
- query-plan/index assertions on production-like cardinality.

### Queue and external workflow

- Redis loss/latency, process kill, stalled work, duplicate/out-of-order job;
- Google 401/403/404/409/429/5xx, timeout, ambiguous outcome, quota exhaustion;
- Pub/Sub malformed/duplicate/out-of-order/missing event identity;
- DLQ and audited redrive.

### End-to-end journeys

1. Operator admits user/org/property.
2. Manager connects the exact authorized Google account/location.
3. Initial import resumes after interruption.
4. New/updated/deleted review converges to inbox.
5. Two managers contend on triage/draft.
6. Manager publishes a reply while a worker is killed at each boundary.
7. Token revoked and connection recovers/requires reauth visibly.
8. Property is archived, disconnected, restored before purge, then purged in a separate test.
9. Assignment removed while session/job is active.
10. Projection is deleted/rebuilt and matches canonical state.

## 9. Sequence and estimates

| Order | Work package                             |     Estimate | Dependency                                |
| ----: | ---------------------------------------- | -----------: | ----------------------------------------- |
|     1 | B1.1 migration authority/schema          |     2–3 days | BETA-0 test lease                         |
|     2 | B1.2 outbox/event contracts              |     3–4 days | migration authority                       |
|     3 | B1.3 `JobRuntime`/queue topology         |     2–3 days | outbox schema                             |
|     4 | B1.4 authorization/staff transactions    |     2–3 days | BETA-0 policy                             |
|     5 | B1.5 property profile/lifecycle          |     2–3 days | schema + authorization                    |
|     6 | B1.6 Google connection/token workflow    |     2–3 days | property profile/runtime                  |
|     7 | B1.7 receipt/import/reconciliation       |     3–4 days | connection + runtime                      |
|     8 | B1.8 source lifecycle/policy             |     2–3 days | ADR 0031 from received Google disposition |
|     9 | B1.9 inbox/review correctness            | 1.5–2.5 days | source lifecycle/outbox                   |
|    10 | B1.10 reply publication saga             |     2–3 days | review/runtime/Google                     |
|    11 | B1.11 core projections and full evidence |     2–3 days | canonical events                          |

Some packages can overlap, but schema → outbox/runtime → external workflows is the sequential spine.

## 10. Exit gate and Stage 2/3 distinction

### Synthetic BETA-1 gate

- migration/install/upgrade and all failure suites pass;
- outbox, queue, source lifecycle, Google fake adapter, reply saga, projections, archive/disconnect/purge, and region policy are observable and recoverable;
- no lost accepted intent or duplicate externally simulated effect occurs;
- authorization and lifecycle negative tests cover all core contexts.

### Real Google shadow entry

In addition to the synthetic gate:

- accepted ADR 0031/source policy implements the received Google permission and conservative backup/log/few-shot/backfill boundaries;
- the internal property is demonstrably authorized;
- privacy, region, operator, provider project/quota, monitoring, and stop controls are approved;
- publish capability remains off.

### Controlled publish entry

- shadow freshness/reconciliation and deletion/disconnect have been observed successfully;
- one named manager and one backup are authorized;
- reply workflow failure tests, audit, operator reconciliation, and kill switch pass;
- an operator is present during the first publishes.

BETA-1 closes after the one-property shadow and controlled-publish evidence is accepted. Expansion waits for BETA-2 critical experience and BETA-3 operations/scale gates.
