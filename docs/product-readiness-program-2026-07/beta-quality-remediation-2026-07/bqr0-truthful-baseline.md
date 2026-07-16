# BQR-0 — Truthful Baseline and Capability Inventory

**Date:** 2026-07-16  
**Status:** Containment complete for BQR-0 scope; deeper fixes deferred to BQR-1…7  
**Baseline audit SHA:** `da0f3add`  
**Containment SHA:** see `phase-bqr0-containment-and-rebaseline.md` exit matrix  
**Method:** Automated grep + manual code path audit across all 16 contexts; re-verified after containment

## 1. Outbox and Event Reliability

### Finding 1.1 — `emitAndRecord()` is non-atomic

**Severity:** P0  
**Status:** Open (deferred to BQR-2); **contained** — durable dispatch off by default  
**File:** `src/shared/outbox/emit-and-record.ts`

The function performs two independent awaits: `events.emit(event)` (in-process bus) then `outboxRepo.insert(...)`. The outbox insert is NOT enrolled in the source context's transaction. A crash between the business commit and the outbox insert loses the event permanently.

The function's own JSDoc admits this: _"The outbox insert is NOT yet atomic with the business write."_

All ~15 emitting use cases follow the same pattern: business write → separate `emitAndRecord()` call.

### Finding 1.2 — Relay/dispatcher envelope mismatch

**Severity:** P0  
**Status:** **Remediated (BQR-2.1)** — relay enqueues full `ConsumerEvent` via `buildConsumerEvent`; dispatcher uses `parseConsumerEvent`  
**Files:** `src/shared/outbox/envelope.ts`, `relay.ts`, `dispatcher.ts`

Previously the relay enqueued only the bare event payload as BullMQ job data. The dispatcher expected a full `ConsumerEvent` envelope, so `event.eventType` was `undefined` and every job was discarded.

**Containment still in force:** `OUTBOX_DISPATCHER_ENABLED` remains default-off until remaining BQR-2 exit criteria (consumers, atomic producers, no-ops).

### Finding 1.3 — Consumer registry empty in production

**Severity:** P0  
**Status:** **Remediated (BQR-2.2)** — worker calls `container.registerOutboxConsumers()` → `registerInboxConsumers`  
**Files:** `src/composition.ts`, `src/worker/index.ts`, `src/contexts/inbox/infrastructure/outbox-consumers.ts`

Previously `registerInboxConsumers()` had zero callers. Worker now registers inbox consumers whenever `outboxRepo` is present. Durable relay still requires `OUTBOX_DISPATCHER_ENABLED` (default off).

### Finding 1.4 — No-op consumers

**Severity:** P1  
**Status:** Open (deferred to BQR-2)  
**File:** `src/contexts/inbox/infrastructure/outbox-consumers.ts`

Two of three defined consumers write an `'applied'` receipt without performing the projection side effect.

## 2. Capability Enforcement

### Finding 2.1 — Capability checks absent from production paths

**Severity:** P0  
**Status:** **Partially remediated (BQR-0)** — dark server functions gated; `authorize()` still unused as a unified seam (BQR-4)  
**Files:** `src/shared/auth/beta-capabilities.ts`, `src/shared/auth/authorization-policy.ts`

`checkBetaCapability` / `assertBetaCapability` is now applied to all dark-context server functions (team, portal, guest, goal, badge, leaderboard) plus identity registration paths. Architecture test `dark-capability-enforcement.test.ts` prevents regressions on server functions.

The combined `authorize()` function (capability + permission + scope) remains dead code for production routes — only unit-tested. Full authoritative authorization is BQR-4.

### Finding 2.2 — Dark contexts reachable through server functions

**Severity:** P0  
**Status:** **Remediated (BQR-0)** at the server-function boundary

Every dark context server function asserts its capability before permission checks. Guest public paths use `assertGlobalCapability('portal.read')`.

### Finding 2.3 — `portal.read` was core (gates were ineffective)

**Severity:** P0  
**Status:** **Remediated (BQR-0)**

Prior policy listed `portal.read` as a core capability, so portal/guest asserts did not fail closed. BQR-0 removed `portal.read` from `CORE_CAPABILITIES` so Portal and Guest match master-plan dark posture (non-core, off unless allowlisted). This supersedes ADR 0032’s core list for portal until that ADR is formally revised in BQR-4.

### Finding 2.4 — Dark scheduled jobs still ran

**Severity:** P0  
**Status:** **Remediated (BQR-0)**

Goal reconcile/spawn, badge/leaderboard reconcile, portal process-image, and outbound email digest/urgent jobs are gated via `isCapabilityJobEnabled` / `registerCapabilityGatedJob`. When dark/blocked they are not scheduled and handlers no-op leftover Redis jobs.

## 3. Schema Drift

### Finding 3.1 — Migrations 0006-0008 absent from Drizzle schema

**Severity:** P0  
**Status:** **Remediated in BQR-1.1** (Drizzle + domain/mapper + parity test)

| Migration | Adds                                                                                                    | Drizzle representation (BQR-1.1)    |
| --------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 0006      | 9 property routing columns + 7 review lifecycle columns                                                 | `property.schema` / `review.schema` |
| 0007      | 3 tables (review_sync_state, review_sync_runs, inbound_webhook_receipts)                                | `review-sync.schema.ts`             |
| 0008      | 4 tables (rollup_daily_metrics, rollup_weekly_metrics, rollup_daily_inbox_metrics, \_rollup_watermarks) | `rollup.schema.ts`                  |

Migrations 0009-0011 remain fully mirrored. Parity locked by `schema-migration-parity.test.ts`.

### Finding 3.2 — Review lifecycle columns never written

**Severity:** P0  
**Status:** **Partially remediated (BQR-1.1)** — mapper + sync path write lifecycle fields; content expiry/hash/policy still BQR-3  
**Files:** `src/contexts/review/infrastructure/mappers/review.mapper.ts`, `sync-reviews.ts`

`reviewToRow()` now includes all 7 lifecycle columns. Sync updates `lastFetchedAt` / preserves existing lifecycle on upsert. Full `content_expires_at` / hash policy and dead `source-content-lifecycle` wiring remain BQR-3.

### Finding 3.3 — source-content-lifecycle.ts is dead code

**Severity:** P1  
**Status:** Open (deferred to BQR-3)  
**File:** `src/contexts/review/application/source-content-lifecycle.ts`

The `fresh`/`refresh_due`/`expired` classification module is imported only by its own test. No production use case, job, or handler wires it in.

## 4. Review Content in Events and Denormalized Copies

### Finding 4.1 — Domain events carry raw PII

**Severity:** P0  
**Status:** Open (deferred to BQR-3 / BQR-4)  
**File:** `src/contexts/review/domain/events.ts:22-23, 51-52`

`ReviewCreated` and `ReviewUpdated` define `reviewerName: string | null` and `reviewText: string | null`. The in-process event bus delivers these to every subscriber. The outbox strips them downstream, but only via a fragile denylist (see 4.2).

### Finding 4.2 — Outbox protected by denylist, not allowlist

**Severity:** P1  
**Status:** Open (deferred to BQR-2 / BQR-4)  
**File:** `src/shared/outbox/event-adapter.ts:21-32`

`CONTENT_FIELDS_TO_STRIP` is a denylist of 10 field names. A field not in the list (e.g. `comment`, `body`, `description`) would persist into the durable outbox. Zod allowlist schemas exist but are only validated at relay/dispatch, not at insert.

### Finding 4.3 — inbox_items stores full review text permanently

**Severity:** P0  
**Status:** Open (deferred to BQR-3)  
**File:** `src/contexts/inbox/infrastructure/event-handlers/on-review-created.ts:31-32`

The in-process handler reads `event.reviewText` and stores it as `inbox_items.snippet` (full, untruncated). When a review expires and is purged from `reviews`, the inbox handler only transitions `open→closed` and **retains** the denormalized text. The review.expired outbox consumer is a no-op stub.

### Finding 4.4 — ADR 0030 referenced but missing

**Severity:** P1  
**Status:** **Remediated (BQR-1.4)** — `docs/adr/0030-identifier-only-domain-events-and-outbox.md` (accepted)

Identifier-only outbox/event contract is documented. Architecture test `adr-0030-presence.test.ts` locks file presence and event-adapter citation.

## 5. Capability Inventory (Truthful — post BQR-0 containment)

| Context      | Claimed posture          | Actual state (post BQR-0)                    | Evidence                                                                                       |
| ------------ | ------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Identity     | Enabled                  | **Partially working**                        | Registration + invite enforced; property access grants domain-only in places                   |
| Property     | Enabled                  | **Partially working**                        | Lifecycle state machine works; processing profile columns unwired in Drizzle                   |
| Integration  | Enabled                  | **Partially working**                        | OAuth flow exists; sync state tables unwired in Drizzle                                        |
| Review       | Enabled                  | **Partially working**                        | Sync works via in-process bus; source lifecycle columns never written after migration          |
| Inbox        | Enabled                  | **Partially working**                        | Projection via in-process bus; durable outbox path contained-off; full review text retained    |
| Dashboard    | Limited                  | **Prototype**                                | Cache module exists; not wired to governed projections                                         |
| Metric       | Internal projection only | **Prototype / internal jobs active**         | Rollup refresh still scheduled; domain registry exists                                         |
| Notification | In-app only              | **In-app partial; outbound email contained** | Insert-notification remains; digest/urgent email no-op while `notification.send_email` blocked |
| Activity     | Limited                  | **Partially working**                        | Activity feed works; audit separation domain-only                                              |
| Staff        | Minimal enabled          | **Prototype**                                | Old staff_assignments still authoritative; new participation domain unwired                    |
| Team         | Dark                     | **Contained**                                | Server fns assert `team.use`; no dark scheduled jobs                                           |
| Portal       | Dark                     | **Contained**                                | Server fns assert `portal.read` (non-core); process-image no-op (`portal.upload` blocked)      |
| Guest        | Dark                     | **Contained**                                | Public server fns assert global `portal.read` (non-core / off)                                 |
| Goal         | Dark                     | **Contained**                                | Server fns assert `goal.use`; reconcile/spawn not scheduled + no-op handlers                   |
| Badge        | Dark                     | **Contained**                                | Server fns assert `badge.use`; reconcile not scheduled + no-op handler; seed definitions only  |
| Leaderboard  | Dark                     | **Contained**                                | Server fns assert `leaderboard.use`; reconcile not scheduled + no-op handler                   |
| AI           | Dark                     | N/A                                          | Not implemented                                                                                |

### Residual risks (accepted for BQR-0, not closed)

1. **In-process event bus** still delivers events (including dark-context emitters if any code path bypasses server fns). Application use cases do not re-assert capabilities — only the server boundary and job registry do.
2. **Org allowlist** can still open non-core capabilities for interactive server fns; background jobs stay off until capability is globally/core enabled.
3. **UI routes** for dark contexts may still render shells; server calls fail closed. Full route denial is BQR-4/BQR-5 polish.
4. **Leftover Redis repeatable job keys** from previous deploys may still fire until purged; handlers no-op when dark.
5. **Enabled contexts remain partially wired** — schema drift, PII, outbox atomicity are not BQR-0 scope.

## 6. Summary

The codebase has a large green unit suite and clean builds, but much of the prior “beta-ready” and post-beta work is domain models, migrations, and docs not fully wired into production paths.

**BQR-0 containment achieved:**

- Durable outbox relay/dispatcher **off by default** (`OUTBOX_DISPATCHER_ENABLED`).
- Dark context **server functions** capability-gated.
- Dark / blocked **jobs and schedules** not started; handlers no-op if leftover work arrives.
- `portal.read` demoted from core so portal/guest fail closed.
- Architecture tests lock the above in place.
- This baseline inventory is the truthful starting map for BQR-1+.

**Not achieved in BQR-0 (by design):** atomic outbox, schema coherence, source lifecycle, authoritative `authorize()`, experience gates, scale/pilot evidence.
