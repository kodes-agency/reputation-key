# Notification Functionality — Comprehensive Review

**Date:** 2026-06-15
**Scope:** `src/contexts/notification/` (domain, application, infrastructure, server, UI)
**Method:** Parallel review across 4 dimensions: domain/architecture, infrastructure/data, server/security, UI/frontend

---

## Executive Summary

The notification context has **sound building blocks** — clean domain boundaries, Result-based constructors, idempotent inserts, org-scoped queries, strong auth posture. But the **email delivery pipeline is completely non-functional**: neither the urgent-email job nor the digest repeatable job is ever enqueued or scheduled. Every notification email (urgent and normal) stays "pending" forever. Additionally, badge notifications silently fail at runtime due to a missing type in the constructor allow-list.

The in-app notification surface works but has a data-staleness bug: the list is fetched once and never refreshed, so the panel drifts out of sync with the polled unread badge.

**Findings:** 2 P0, 3 P1, 11 P2, 6 P3

---

## P0 — Feature Non-Functional

### 1. Digest job never scheduled — normal notification emails never send

**File:** `src/worker/index.ts:148-156`

The `digest-notification` handler is registered in `bootstrap.ts:300-303` but **never scheduled as a repeatable job** in `src/worker/index.ts`. The worker schedules repeatables for health-check, reviews, metrics, goals, and badge/leaderboard reconciliation — but has no `queue.add(DIGEST_JOB_NAME, { repeat })`. Every `notification_email_queue` row with `priority='normal'` stays "pending" forever.

**Fix:** Add a repeatable schedule for the digest job alongside the other schedules in `src/worker/index.ts`.

---

### 2. Urgent email jobs never enqueued — urgent emails never send

**File:** `src/contexts/notification/application/use-cases/insert-notification.ts:76-82`

The `urgent-email` handler is registered in `bootstrap.ts:280-286` but **nothing enqueues `urgent-email` jobs**. `insert-notification.ts` inserts the email-queue row (lines 76-82) but never enqueues the urgent job. `findPendingUrgent()` — the only candidate poller — is dead code with zero production callers. The three urgent types promised as "immediate" alerts (`reply.pending_approval`, `reply.publish_failed`, `inbox.escalated`) are never emailed.

**Fix:** After inserting an urgent email-queue row, enqueue an `urgent-email` BullMQ job. Either pass the `notificationEmailId` directly or wire the `findPendingUrgent` poller.

---

## P1 — Bugs

### 3. `badge.awarded` missing from ALLOWED_TYPES — badge notifications always fail

**File:** `src/contexts/notification/domain/constructors.ts:18-36`

The `NotificationType` union includes `'badge.awarded'` (types.ts:34) and `NotificationResourceType` includes `'badge'` (types.ts:47), but neither appears in the constructor allow-lists. `ALLOWED_TYPES` has 11 entries (missing `badge.awarded`); `ALLOWED_RESOURCE_TYPES` has 3 entries (missing `badge`). When the worker processes a badge notification job, `createNotification` rejects it with `invalid_type`. BullMQ retries 3 times (all failing identically) and the notification is never created. **Every badge award event silently fails.**

**Fix:** Add `'badge.awarded'` to `ALLOWED_TYPES` and `'badge'` to `ALLOWED_RESOURCE_TYPES` in `constructors.ts`.

---

### 4. on-badge-awarded payload shape doesn't match worker contract

**File:** `src/contexts/notification/infrastructure/event-handlers/on-badge-awarded.ts:16-29`

The handler enqueues `{ type, priority, resourceType, resourceId, message, targetUserIds }` but the `InsertNotificationJobData` worker contract requires `{ userId, organizationId, type, resourceType, resourceId, eventId, title, body }`. The worker cannot process badge events even after fixing finding #3. The handler also uses a raw string `'insert-notification'` instead of the `INSERT_NOTIFICATION_JOB_NAME` constant.

**Fix:** Rewrite the handler to emit one job per target user with the correct payload shape.

---

### 5. Notification list frozen after initial load — never refreshed

**File:** `src/components/features/notification/notification-panel.tsx:94-99`

`useNotifications` fetches exactly once at layout mount. The panel only refetches inside `handleMarkAllRead`. Since the panel lives in the persistent layout shell, the list is frozen for the entire session: the polled badge can show N unread while the opened panel shows stale content, new notifications never appear, and a single mark-read leaves the row visually unread on reopen.

**Fix:** Call `refetchList()` in `handleMarkRead` and on popover open.

---

## P2 — Design Issues / UX Defects

### 6. Missing title/resourceId/eventId validation in createNotification

**File:** `src/contexts/notification/domain/constructors.ts:80-98`

`createNotification` validates `type` and `resourceType` against allow-lists but performs no validation on `title`, `resourceId`, or `eventId`. An empty string passes through unchecked. An empty `title` produces a notification with no heading; an empty `eventId` breaks the idempotency unique index (distinct notifications collide).

---

### 7. Dismissed status is unreachable

**File:** `src/contexts/notification/domain/constructors-transitions.ts:10-38`

`NotificationStatus` includes `'dismissed'` and `ALLOWED_STATUSES` includes it, but no domain transition function can produce it. Only `markNotificationRead` (unread→read) exists. There is no `dismissNotification` constructor, use case, server endpoint, or repository method. The status is dead code.

---

### 8. Notification rows persist despite inAppEnabled=false — read queries don't filter

**File:** `src/contexts/notification/application/use-cases/insert-notification.ts:63-64`

When `inAppEnabled=false` but `emailEnabled=true`, `insertNotification` still inserts the notification row (needed as the email's FK anchor) and returns `null`. But every read query (`findByUser`, `findUnreadByUser`, `countUnreadByUser`) selects from `notifications` with no preference-based filter. Opted-out notifications leak into the in-app list. Currently masked because no preferences API exists, but will activate the moment preferences endpoints ship.

---

### 9. markNotificationReadDto uses z.string() not z.string().uuid()

**File:** `src/contexts/notification/server/notifications.ts:93-95`

Inconsistent with every other context (inbox, badge, dashboard all use `.uuid()`). A malformed ID passes Zod, hits Postgres, triggers `invalid input syntax for type uuid`, and surfaces as a 500 instead of a clean 422 validation error.

---

### 10. No server functions for notification preferences

**File:** `src/contexts/notification/server/notifications.ts`

CONTEXT.md advertises sparse opt-out support. The preference repository, port, and domain types are all in place. But no server function exposes preference read/update. The settings UI renders "Coming soon." Users cannot opt out of notification types.

---

### 11. N+1 query in digest job per user

**File:** `src/contexts/notification/infrastructure/jobs/digest-notification.job.ts:87-95`

The digest job fetches each entry's notification individually via `notifRepo.findById()` inside a per-entry loop. For N pending notifications per user, this is N SELECTs per user per org each hour. Fix: batch-fetch by `notificationId` with `inArray`.

---

### 12. Failed normal emails permanently stuck — no retry path

**File:** `src/contexts/notification/infrastructure/repositories/notification-email.repository.ts:89-101`

`findPendingByOrg` filters `status='pending'` only. Once a normal email is marked `'failed'` by a transient Resend outage, no subsequent digest picks it up. Failed normal emails are permanently stuck with no recovery path.

---

### 13. No error/retry state for notification list fetch failures

**File:** `src/components/features/notification/notification-queries.ts:57-70`

`useNotifications` swallows all errors and leaves `notifications=[]`. The panel renders the empty state indistinguishable from a genuine empty result. Since the list is fetched once, a transient failure strands the user on "No notifications" until page reload.

---

### 14. Urgent notifications not visually distinguished

**File:** `src/components/features/notification/notification-panel.tsx:30-62`

The domain exposes `priority`, `isUrgent`, and `URGENT_TYPES`. Each notification carries `priority`. But `NotificationRow` ignores it — an urgent `reply.publish_failed` looks identical to a routine `review.created`.

---

### 15. Accessibility gaps on bell trigger and unread indicators

**File:** `src/components/features/notification/notification-panel.tsx:105-114`

The bell button has no `aria-label`. The unread-count span has no label or `aria-live` region. The per-row unread dot is purely decorative — unread state is visual-only for assistive tech.

---

### 16. No pagination for notification list

**File:** `src/components/features/notification/notification-panel.tsx:73`

`useNotifications(20)` always passes offset 0 though the server supports offset. No load-more or pager. Users with >20 notifications cannot reach older items.

---

## P3 — Nits / Design Observations

### 17. Dead inbox_item branch + dropped resourceId in getNotificationUrl

**File:** `src/components/features/notification/notification-utils.ts:14-25`

`handleNotificationClick` special-cases `inbox_item` so the `getNotificationUrl` `inbox_item` branch is dead code. The reply/goal branches return bare `/inbox` and `/properties`, discarding `resourceId` — notifications never deep-link to the specific item.

---

### 18. Mark all read button not disabled during mutation

**File:** `src/components/features/notification/notification-panel.tsx:126-134`

`markAllRead.isPending` is unused. The button stays clickable during the mutation, allowing repeated concurrent requests (idempotent but wasteful).

---

### 19. isLoading ignored — flashes "No notifications" on mount

**File:** `src/components/features/notification/notification-panel.tsx:139-142`

Both hooks expose `isLoading` but the panel ignores it, rendering the empty state while `notifications=[]` during the initial load window.

---

### 20. No transaction around notification + email insert

**File:** `src/contexts/notification/application/use-cases/insert-notification.ts:64-82`

`notificationRepo.insert` and `emailRepo.insert` are independent statements with no transaction. A transient DB error on the second insert leaves an orphan notification with no email-queue entry.

---

### 21. Dead findPendingUrgent query

**File:** `src/contexts/notification/infrastructure/repositories/notification-email.repository.ts:108-123`

`findPendingUrgent()` is declared on the port and implemented but has zero production callers. Two incompatible dispatch designs (poll vs per-row queue.add) coexist with neither wired. Pick one and delete the other.

---

### 22. NotificationError.code typed as open string

**File:** `src/contexts/notification/domain/errors.ts:4-6`

`NotificationError.code` is `string`, not a closed union. Consumers can't get exhaustiveness checking. Typing as `'invalid_type' | 'invalid_resource_type' | 'invalid_status'` would provide compile-time safety.

---

## What's Working Well

| Area | Assessment |
|------|-----------|
| **Domain purity** | Clean boundaries — domain imports only from `./` and `#/shared/domain`. |
| **Constructor pattern** | `Result<T, E>` with `neverthrow`. Validation returns `err()` on invalid input. |
| **Email transition state machine** | `constructors-email.ts` has a complete and correct transition matrix: pending→sent, pending→failed, failed→sent. |
| **Idempotent inserts** | Composite unique index `(userId, type, resourceId, eventId)` + `ON CONFLICT DO UPDATE`. Event replays don't create duplicates. |
| **Tenant isolation** | Every query scoped by `organization_id`. Org ID always from session. |
| **Auth/IDOR posture** | Every server function calls `resolveTenantContext`. `userId` always from session. `markRead` does explicit ownership check before mutating. |
| **Error containment** | `catchUntagged` prevents internal-detail leaks. POST for all mutations. |
| **Preference enforcement at write** | `insertNotification` checks `inAppEnabled`/`emailEnabled` before creating rows. |
| **Indexed unread count** | `notifications_user_status_idx` on `(userId, status, createdAt)` for efficient unread queries. |
| **Individual job handler quality** | Each handler is well-structured with proper error handling and logging. Tests cover happy path + error cases. |
| **Event handler idempotency** | Unique index + ON CONFLICT protects against duplicate notifications from event replays. |

---

## Recommended Fix Priority

| Priority | Finding | Effort |
|----------|---------|--------|
| **P0** | Schedule digest repeatable job in worker | ~5 lines |
| **P0** | Enqueue urgent-email job on insert | ~10 lines |
| **P1** | Add `badge.awarded` to ALLOWED_TYPES + `badge` to ALLOWED_RESOURCE_TYPES | 2 lines |
| **P1** | Fix on-badge-awarded payload to match worker contract | ~20 lines |
| **P1** | Refresh notification list on open + after mark-read | ~5 lines |
| **P2** | Add title/resourceId/eventId validation in createNotification | ~10 lines |
| **P2** | Implement dismiss or remove dismissed status | ~30 lines or 1 line |
| **P2** | Filter in-app queries by preference at read time | ~15 lines |
| **P2** | Add `.uuid()` to markNotificationReadDto | 1 line |
| **P2** | Add preference server functions + DTOs | ~60 lines |
| **P2** | Batch-fetch in digest job (fix N+1) | ~15 lines |
| **P2** | Include 'failed' in digest query for retry | ~5 lines |
| **P2** | Surface list fetch errors with retry in UI | ~15 lines |
| **P2** | Visually distinguish urgent notifications | ~10 lines |
| **P2** | Add aria-labels and aria-live for accessibility | ~10 lines |
| **P2** | Add pagination to notification list | ~20 lines |
| **P3** | Fix dead branches + dropped resourceId in URL builder | ~10 lines |
| **P3** | Disable Mark all read during mutation | 1 line |
| **P3** | Use isLoading in panel to avoid flash | ~5 lines |
| **P3** | Wrap notification+email insert in transaction | ~10 lines |
| **P3** | Remove dead findPendingUrgent or wire it up | ~5 lines |
| **P3** | Type NotificationError.code as closed union | ~5 lines |
