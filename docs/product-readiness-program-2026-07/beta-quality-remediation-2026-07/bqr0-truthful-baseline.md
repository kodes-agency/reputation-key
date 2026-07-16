# BQR-0 — Truthful Baseline and Capability Inventory

**Date:** 2026-07-16
**Status:** Evidence-backed audit of the current codebase
**Release SHA:** `da0f3add`
**Method:** Automated grep + manual code path audit across all 16 contexts

## 1. Outbox and Event Reliability

### Finding 1.1 — `emitAndRecord()` is non-atomic

**Severity:** P0
**File:** `src/shared/outbox/emit-and-record.ts`

The function performs two independent awaits: `events.emit(event)` (in-process bus) then `outboxRepo.insert(...)`. The outbox insert is NOT enrolled in the source context's transaction. A crash between the business commit and the outbox insert loses the event permanently.

The function's own JSDoc admits this: _"The outbox insert is NOT yet atomic with the business write."_

All ~15 emitting use cases follow the same pattern: business write → separate `emitAndRecord()` call.

### Finding 1.2 — Relay/dispatcher envelope mismatch

**Severity:** P0
**Files:** `src/shared/outbox/relay.ts:67`, `src/shared/outbox/dispatcher.ts:88-92`

The relay enqueues only the bare event payload as BullMQ job data. The dispatcher expects a full `ConsumerEvent` envelope (`eventId`, `eventType`, `eventVersion`, `payload`, `organizationId`, etc.). Since the relay discards the envelope, `event.eventType` is `undefined` → validation throws → caught and logged as "discarding" → job silently dropped.

**Every outbox event is silently lost on dispatch.**

### Finding 1.3 — Consumer registry empty in production

**Severity:** P0
**File:** `src/contexts/inbox/infrastructure/outbox-consumers.ts`

`registerInboxConsumers()` is defined but has zero callers. The dispatcher runs with no consumers registered. Even if the envelope bug were fixed, `consumersByType.get(undefined)` returns nothing.

### Finding 1.4 — No-op consumers

**Severity:** P1
**File:** `src/contexts/inbox/infrastructure/outbox-consumers.ts`

Two of three defined consumers write an `'applied'` receipt without performing the projection side effect.

## 2. Capability Enforcement

### Finding 2.1 — Capability checks absent from production paths

**Severity:** P0
**Files:** `src/shared/auth/beta-capabilities.ts`, `src/shared/auth/authorization-policy.ts`

`BetaCapabilities` correctly declares `team.use`, `goal.use`, `badge.use`, `leaderboard.use` as non-core (off by default) and `portal.write`/`portal.upload` as blocked. But `checkBetaCapability`/`assertBetaCapability` is imported in only THREE production files:

- `src/contexts/identity/server/organizations.registration.ts` (identity.register)
- `src/routes/register.tsx` (identity.register)
- `src/shared/auth/authorization-policy.ts` (defines `authorize()` but it is NEVER called from production)

The combined `authorize()` function (capability + permission + scope) exists but is dead code — only called from its own unit test.

### Finding 2.2 — Dark contexts reachable through server functions

**Severity:** P0

Every "dark" context (Team, Portal, Guest, Goal, Badge, Leaderboard) has server functions that use only role-based permission checks (`canForContext`), with zero capability checks. Any authenticated user with the matching role permission can reach them through direct server function calls or API routes.

## 3. Schema Drift

### Finding 3.1 — Migrations 0006-0008 absent from Drizzle schema

**Severity:** P0

| Migration | Adds                                                                                                    | Drizzle representation |
| --------- | ------------------------------------------------------------------------------------------------------- | ---------------------- |
| 0006      | 9 property routing columns + 7 review lifecycle columns                                                 | **None**               |
| 0007      | 3 tables (review_sync_state, review_sync_runs, inbound_webhook_receipts)                                | **None**               |
| 0008      | 4 tables (rollup_daily_metrics, rollup_weekly_metrics, rollup_daily_inbox_metrics, \_rollup_watermarks) | **None**               |

Migrations 0009-0011 ARE fully mirrored in Drizzle schema.

### Finding 3.2 — Review lifecycle columns never written

**Severity:** P0
**Files:** `src/contexts/review/infrastructure/mappers/review.mapper.ts`

`reviewToRow()` omits all 7 lifecycle columns. After the one-time migration backfill, `last_fetched_at` is frozen at original `created_at`. The health metrics module reads these columns and will drift to "everything is stale" over time.

### Finding 3.3 — source-content-lifecycle.ts is dead code

**Severity:** P1
**File:** `src/contexts/review/application/source-content-lifecycle.ts`

The `fresh`/`refresh_due`/`expired` classification module is imported only by its own test. No production use case, job, or handler wires it in.

## 4. Review Content in Events and Denormalized Copies

### Finding 4.1 — Domain events carry raw PII

**Severity:** P0
**File:** `src/contexts/review/domain/events.ts:22-23, 51-52`

`ReviewCreated` and `ReviewUpdated` define `reviewerName: string | null` and `reviewText: string | null`. The in-process event bus delivers these to every subscriber. The outbox strips them downstream, but only via a fragile denylist (see 4.2).

### Finding 4.2 — Outbox protected by denylist, not allowlist

**Severity:** P1
**File:** `src/shared/outbox/event-adapter.ts:21-32`

`CONTENT_FIELDS_TO_STRIP` is a denylist of 10 field names. A field not in the list (e.g. `comment`, `body`, `description`) would persist into the durable outbox. Zod allowlist schemas exist but are only validated at relay/dispatch, not at insert.

### Finding 4.3 — inbox_items stores full review text permanently

**Severity:** P0
**File:** `src/contexts/inbox/infrastructure/event-handlers/on-review-created.ts:31-32`

The in-process handler reads `event.reviewText` and stores it as `inbox_items.snippet` (full, untruncated). When a review expires and is purged from `reviews`, the inbox handler only transitions `open→closed` and **retains** the denormalized text. The review.expired outbox consumer is a no-op stub.

### Finding 4.4 — ADR 0030 referenced but missing

**Severity:** P1

ADR 0030 is referenced as authoritative in 6 locations but no file exists at `docs/adr/0030*.md`.

## 5. Capability Inventory (Truthful)

| Context      | Claimed posture          | Actual state          | Evidence                                                                         |
| ------------ | ------------------------ | --------------------- | -------------------------------------------------------------------------------- |
| Identity     | Enabled                  | **Partially working** | Registration + invite enforced; property access grants are domain-only (unwired) |
| Property     | Enabled                  | **Partially working** | Lifecycle state machine works; processing profile columns unwired in Drizzle     |
| Integration  | Enabled                  | **Partially working** | OAuth flow exists; sync state tables unwired in Drizzle                          |
| Review       | Enabled                  | **Partially working** | Sync works; source lifecycle columns never written after migration               |
| Inbox        | Enabled                  | **Partially working** | Projection works via in-process bus; outbox path broken; full review text leaked |
| Dashboard    | Limited                  | **Prototype**         | Cache module exists; not wired to governed projections                           |
| Metric       | Internal projection only | **Prototype**         | Registry domain module exists; no production readings path                       |
| Notification | In-app only              | **Partially working** | In-app delivery works; email capability declared but not enforced                |
| Activity     | Limited                  | **Partially working** | Activity feed works; audit separation is domain-only (unwired)                   |
| Staff        | Minimal enabled          | **Prototype**         | Old staff_assignments still authoritative; new participation domain unwired      |
| Team         | Dark                     | **NOT contained**     | Server functions reachable without capability check                              |
| Portal       | Dark                     | **NOT contained**     | Server functions reachable without capability check                              |
| Guest        | Dark                     | **NOT contained**     | Server functions reachable without capability check                              |
| Goal         | Dark                     | **NOT contained**     | Server functions reachable without capability check                              |
| Badge        | Dark                     | **NOT contained**     | Server functions reachable without capability check                              |
| Leaderboard  | Dark                     | **NOT contained**     | Server functions reachable without capability check                              |
| AI           | Dark                     | N/A                   | Not implemented                                                                  |

## 6. Summary

The codebase has 2,738 passing unit tests and clean builds, but the majority of the "beta-ready" and "post-beta" work consists of domain models, migrations, and documentation that are **not wired into production execution paths**. The enabled capabilities (identity, property, integration, review, inbox) work partially through in-process event delivery, but the durable outbox path is broken (events silently dropped), raw PII leaks through the in-process bus, and schema drift means health metrics are unreliable.

Six contexts declared as "dark" are **not contained** — their server functions are reachable without capability checks.
