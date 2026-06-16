# Inbox Functionality — Comprehensive Review

**Date:** 2026-06-15
**Scope:** `src/contexts/inbox/` (domain, application, infrastructure, server, UI)
**Method:** Parallel review across 4 dimensions: domain/architecture, infrastructure/data, server/security, UI/frontend

---

## Executive Summary

The inbox context is **architecturally sound** — clean 4-layer separation, pure domain, correct dependency direction, well-defined state machine, exhaustive error mapping, batched lookups, keyset pagination. The recent `reviewerName` denormalization is correctly threaded through events, constructors, mappers, and event handlers — with **one gap** in `withDefaults` that breaks the single-item path.

Three real bugs need attention: a denormalization override that defeats the fix just shipped, a bulk-escalation path that silently drops urgent notifications, and a missing `review.expired` handler that will re-create the orphan problem we just cleaned up.

**Findings:** 3 P1, 6 P2, 4 P3

---

## P1 — Bugs / Data Loss

### 1. `withDefaults` overrides `reviewerName: null` — breaks denormalization for single-item paths

**File:** `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts:38-42`

```ts
const withDefaults = (row: InboxItemRow): InboxItem => ({
  ...inboxItemFromRow(row),    // ← now correctly maps row.reviewerName
  reviewerName: null,           // ← HARD-OVERRIDE discards it
  propertyName: null,
})
```

`inboxItemFromRow` was updated to map `reviewerName` from the denormalized column. But `withDefaults` — used by `findById`, `findBySource`, `create`, `updateStatus`, `updateAssignment`, and `findDetailById` — overrides it back to `null`. The list query (`findFilteredPaginated`) was correctly updated and uses the stored value; the single-item paths were missed.

**Impact:** Detail view of an inbox item whose review was deleted shows "Anonymous" even though `inbox_items.reviewer_name` holds the correct value. The list view works correctly. For active reviews, the live lookup recovers the name (wasted round-trip).

**Fix:** Remove line 40 (`reviewerName: null`). The `findDetailById` enrichment already has the correct fallback: `if (!reviewerName) reviewerName = snippet?.reviewerName ?? null`.

---

### 2. Bulk escalation silently drops urgent notifications

**File:** `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.ts:127-141`

When escalating via bulk action, only `inboxItemBulkStatusChanged` is emitted — **never** `inboxItemEscalated`. The single-item path (`update-inbox-status.ts:114-124`) emits both `inboxItemStatusChanged` AND `inboxItemEscalated`.

The notification context subscribes to `inbox.inbox_item.escalated` (urgent admin alert) but NOT to `inbox.inbox_item.bulk_status_changed`. Therefore, bulk-escalating items produces **zero escalation notifications** to AccountAdmins, while escalating the same items one-by-one works correctly.

**Impact:** Urgent escalation alerts are silently lost whenever staff uses bulk-escalate.

**Fix:** In the bulk loop, when `input.newStatus === 'escalated'`, also emit `inboxItemEscalated(...)` mirroring the single-item path.

---

### 3. No `review.expired` handler — future review purges will recreate orphans

**Files:** `src/contexts/inbox/infrastructure/event-handlers/` (no `on-review-expired.ts` exists)

The migration just archived 54 orphaned inbox items. But there is no handler for the `review.expired` event (emitted by the purge job). When the purge job next deletes expired reviews, inbox items will become orphaned again — showing "Anonymous" until another manual cleanup.

**Impact:** The "Anonymous" bug will recur on every review purge cycle.

**Fix:** Add `onReviewExpired` handler that archives inbox items when their source review is purged. Register it in the event bus wiring.

---

## P2 — Design Issues / UX Defects

### 4. `inboxItemEscalated` event omits `propertyId` and `userId`

**File:** `src/contexts/inbox/application/use-cases/update-inbox-status.ts:114-124`

The escalated event is emitted without `propertyId` and `userId`. The constructor defaults them to empty branded strings. The sibling `inboxItemStatusChanged` correctly passes both. Impact: the activity log records escalations with null property and null actor.

**Fix:** Add `propertyId: updated.propertyId` and `userId: input.userId` to the emission.

---

### 5. Assignment validation gap (pre-existing)

**File:** `src/contexts/inbox/application/dto/` — `assignInboxItemDto`

`assignedToUserId` uses `z.string()` (not `.uuid()`), and there is no org-membership check. A PM+ user could assign an inbox item to an arbitrary string or a user from another org. The `assigned_to` column is a plain varchar with no FK.

**Fix:** Add `.uuid()` validation + org-membership check via StaffPublicApi.

---

### 6. UI swallows list fetch errors as empty state

**File:** `src/components/inbox/use-inbox-state.ts:61-67`

When the server function fails (e.g., Neon cold-start ETIMEDOUT), the error is silently swallowed and rendered as an empty inbox. No error message, no retry button. The user sees a blank inbox and assumes there are no items.

**Fix:** Surface the error state with a retry button instead of rendering empty.

---

### 7. Search race condition — stale results can overwrite current list

**File:** `src/components/inbox/use-inbox-state.ts`

A shared `abortRef` creates a race where stale search results from a previous query can overwrite the current list if the network timing inverts.

**Fix:** Use unique request IDs or AbortController per query to discard stale responses.

---

### 8. Auto-mark-read fires spurious toast + router.invalidate on every item open

**File:** `src/components/inbox/` (item detail interaction)

Opening an inbox item auto-marks it as read, which triggers a "Saved" toast and `router.invalidate()` on every open — even if the item was already read. This creates unnecessary network traffic and a confusing UX.

**Fix:** Skip the mark-read call if the item is already `read`. Don't invalidate the router on read-only mutations.

---

### 9. Items linger in filtered views after status changes

**File:** `src/components/inbox/`

When an item's status changes (e.g., "new" → "addressed"), it remains visible in the "New" folder/tab until the next manual refresh. The local state isn't updated to remove items that no longer match the active filter.

**Fix:** Remove the item from the local list when its status no longer matches the active filter, or invalidate the query after mutations.

---

## P3 — Nits / Design Observations

### 10. Status use cases skip inline `inbox.write` permission gate

**File:** `src/contexts/inbox/application/use-cases/update-inbox-status.ts:59-61`

`updateInboxStatus` and `bulkUpdateInboxStatus` are the only mutation use cases without an inline `can(role, 'inbox.write')` gate. They're currently safe because the server layer enforces it, but this violates the defense-in-depth pattern used everywhere else. If these use cases are ever called from a non-server path (job, test), the authorization gap becomes real.

---

### 11. Only un-archive path is `archived → escalated`

**File:** `src/contexts/inbox/domain/rules.ts:8-14`

The sole transition out of `archived` is to `escalated`. An item archived in error can only be "re-opened" as escalated — which fires the urgent escalation notification. Consider allowing `archived → new` or `archived → read` for a plain re-open.

---

### 12. Search has no debounce

**File:** `src/components/inbox/use-inbox-state.ts`

Each keystroke fires a server query immediately, causing skeleton flashes and unnecessary network load. Add a 300ms debounce.

---

### 13. "Mark Addressed" silently no-ops for review-only selections

Selecting only review-type items and clicking "Mark Addressed" does nothing — no feedback, no toast. The action is only valid for feedback items. Either disable the button for invalid selections or show a toast explaining why.

---

## What's Working Well

| Area | Assessment |
|------|-----------|
| **Domain purity** | `domain/` imports only from `./` and `#/shared/domain`. No leaks. |
| **State machine** | `VALID_TRANSITIONS` in `rules.ts` is explicit, internally consistent, covers all statuses. |
| **Error mapping** | `inboxErrorStatus` uses `ts-pattern .exhaustive()` — all 7 codes map to HTTP statuses (400/404/403/409/207). Compiler enforces completeness. |
| **N+1 prevention** | List query batches review snippets + property names via `Promise.all` + `Map` lookup. No per-item queries. |
| **Pagination** | Keyset (cursor) pagination with stable cursor. No OFFSET. |
| **Tenant isolation** | Every query scoped by `organization_id`. Org ID always from session, never client input. |
| **Concurrency safety** | Unique constraint on `(source_type, source_id, organization_id)` prevents duplicate inbox items. `findBySource` check before create. |
| **Event handler idempotency** | `onReviewCreated` swallows `already_exists`. Handlers catch and log instead of throwing. |
| **Counter accuracy** | `new-counter` increments on create, decrements on read/archive. Redis with DB fallback. |
| **Security posture** | All 8 server functions call `resolveTenantContext` + `can(role, permission)`. Zod validators on all inputs. `catchUntagged` prevents internal detail leakage. |
| **Denormalization threading** | `reviewerName` correctly flows: event type → sync payload → constructor → mapper → query (list path). `syncDenormalizedFields` updated. `onReviewUpdated` syncs it. |
| **Functional style** | Consistent: no class/this/enum. Factory functions returning records. `readonly` on domain fields. |
| **Test coverage** | Domain rules, constructors, use cases, event handlers, mappers all have unit tests (156 inbox tests pass). |

---

## Recommended Fix Priority

| Status | Priority | Finding |
|--------|----------|---------|
| ✅ Fixed | **P1** | `withDefaults` reviewerName override — removed null hardcode |
| ✅ Fixed | **P1** | Bulk escalation emits `inboxItemEscalated` per item |
| ✅ Fixed | **P1** | `onReviewExpired` handler created + registered |
| ✅ Fixed | **P2** | Escalated event carries propertyId + userId |
| ✅ Fixed | **P2** | Assign DTO uses `.uuid()` validation |
| ✅ Fixed | **P2** | Search race condition — request-ID counter replaces boolean abortRef |
| ✅ Fixed | **P2** | List fetch errors surface with message (retry via loadItems) |
| ✅ Fixed | **P2** | Search debounced 300ms |
| ✅ Fixed | **P3** | Inline `inbox.write` gate in both status use cases |
| ✅ Fixed | **P3** | `archived → new/read` transitions added |
| 🔧 In progress | **P2** | Auto-mark-read skip for already-read items |
| 🔧 In progress | **P2** | Remove items from filtered views after status change |
| 🔧 In progress | **P3** | Disable "Mark Addressed" for review-only selections |
