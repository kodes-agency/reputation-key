# Notification Context

## Bounded context

Produces user-facing in-app and email notifications about domain events. Subscribes to events from other contexts, resolves recipients, creates notification rows, and manages email delivery (urgent: immediate via a dedicated job; normal: daily digest).

## Glossary

| Term               | Meaning                                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notification       | An in-app notification row (`notifications` table) anchored to a user.                                                                                                                       |
| Notification type  | User-facing type name (e.g. `reply.pending_approval`); distinct from event tags.                                                                                                             |
| Resource           | The domain thing a notification is about (`resourceType` + `resourceId`). For action-oriented types the resource is the **inbox item** (resolved at creation), so clicking opens its detail. |
| New / Earlier      | The two read-state sections of the list: **New** = unread, **Earlier** = read. Dismissed items are excluded entirely.                                                                        |
| Email queue entry  | A row in `notification_email_queue` representing one email to deliver.                                                                                                                       |
| Urgent             | Priority that triggers immediate email delivery (see Q9 urgent types).                                                                                                                       |
| Normal             | Priority batched into the daily digest.                                                                                                                                                      |
| Digest             | Daily job that sends all `pending` normal-priority emails per org.                                                                                                                           |
| Channel preference | Per-user/per-type toggle for in-app and email channels (default: both on).                                                                                                                   |

## Relationships

**Within context:**

- `Notification` 1—1 `NotificationEmail` (email queue entry is created per notification when the email channel is enabled).
- `Notification` N—1 `NotificationPreference` (one preference row per user × type; sparse — absence means default-on).

**Cross-context (consumed via ports / event subscriptions):**

- **Identity** — user email + display name + role lookups via `UserLookupPort`.
- **Property** — property timezone for digest scheduling (existing property schema).
- **Staff** — `staff_assignments` joined in `findAssignedManagers()` to resolve property-scoped recipients.
- **Review / Inbox / Goal / Badge** — event subscriptions (see "Events consumed").

## Invariants

- A notification is always scoped to exactly one `userId` + `organizationId`.
- `userId` MUST be non-empty (constructor rejects `invalid_input`).
- `type`, `resourceType`, and `status` MUST be in their allowed sets (constructor + row mapper enforce).
- Email state machine: a queue entry moves `pending → sent` (success) or `pending/failed → failed` (retry); enforced at DB level by repo WHERE clauses.
- Urgent priority is derived from type, never set by callers.
- Preferences are sparse — a missing preference row means both channels enabled.

## Events produced

This context produces **no domain events**. It consumes events and materializes notifications + email-queue rows.

## Events consumed

| `_tag`                        | Source | Handler action                                                                                                                  |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `inbox.inbox_item.created`    | inbox  | Enqueue `review.created` (review) or `feedback.created` (feedback) to assigned managers; `resourceId` = inboxItemId (ADR 0022). |
| `inbox.inbox_item.assigned`   | inbox  | Enqueue `inbox.assigned` notification to assignee.                                                                              |
| `inbox.inbox_item.escalated`  | inbox  | Enqueue urgent `inbox.escalated` to managers/staff.                                                                             |
| `inbox.inbox_note.added`      | inbox  | Enqueue `inbox_note.added` to assigned managers/staff.                                                                          |
| `review.reply.submitted`      | review | Enqueue urgent `reply.pending_approval` to AccountAdmins.                                                                       |
| `review.reply.approved`       | review | Enqueue `reply.approved` to reply author.                                                                                       |
| `review.reply.rejected`       | review | Enqueue `reply.rejected` to reply author.                                                                                       |
| `review.reply.published`      | review | Enqueue `reply.published` to reply author.                                                                                      |
| `review.reply.publish_failed` | review | Enqueue urgent `reply.publish_failed` to reply author.                                                                          |
| `goal.completed`              | goal   | Enqueue `goal.completed` to assigned managers/staff.                                                                            |
| `badge.awarded`               | badge  | Enqueue `badge.awarded` to assigned managers/staff.                                                                             |

## Architecture layers

```
server/           → createServerFn wrappers (queries + mutations), tenant resolution
application/      → use cases, ports, public-api barrel
  use-cases/        insert-notification
  ports/            repository / user-lookup / email-sender ports
domain/           → types, constructors, constructors-email, constructors-transitions, constructors-preference, errors
infrastructure/
  event-handlers/   subscribe to domain events, enqueue BullMQ jobs
  jobs/             BullMQ workers (insert-notification, digest, urgent-email)
  adapters/         cross-context lookups (db-user-lookup, resend-email)
  repositories/     Drizzle implementations of ports (+ row mapper)
```

## Use cases

| Name                 | Input                                                                  | Output                 | Permission                |
| -------------------- | ---------------------------------------------------------------------- | ---------------------- | ------------------------- |
| `insertNotification` | `InsertNotificationInput` (userId, orgId, type, resource, title, body) | `Notification \| null` | Internal (event handlers) |

`insertNotification` is invoked by the insert-notification BullMQ worker, not directly by server functions. Returns `null` when the user has disabled both channels (still persists if email-only) — see Q19.

## Public API

Exported from `application/public-api.ts`:

- **Types:** `Notification`, `NotificationEmail`, `NotificationPreference`, `NotificationType`, `NotificationPriority`, `NotificationStatus`, `EmailQueueStatus`, `NotificationResourceType`, `CreateNotificationInput`, `CreateNotificationEmailInput`, `CreateNotificationPreferenceInput`, `NotificationError`.
- **Values:** `isUrgent`, `URGENT_TYPES`, `NOTIFICATION_TYPES` (canonical type list), `notificationError`.
- **Ports:** `NotificationRepositoryPort`, `NotificationEmailRepositoryPort`, `NotificationPreferenceRepositoryPort`, `UserLookupPort`, `EmailSenderPort`.

The build function (`build.ts`) also exposes `publicApi` query/mutation helpers (`findById`, `getUnreadCount`, `getNotifications`, `markRead`, `markAllRead`, `dismiss`, `getPreferences`, `updatePreference`) consumed by the notification server functions.

## Server functions

| Name                             | Method | Permission            | Route                        |
| -------------------------------- | ------ | --------------------- | ---------------------------- |
| `getUnreadNotificationCountFn`   | GET    | `notification.read`   | RPC                          |
| `getNotificationsFn`             | GET    | `notification.read`   | RPC                          |
| `markNotificationReadFn`         | POST   | `notification.update` | RPC                          |
| `markAllNotificationsReadFn`     | POST   | `notification.update` | RPC                          |
| `dismissNotificationFn`          | POST   | `notification.update` | RPC                          |
| `dismissAllNotificationsFn`      | POST   | `notification.update` | RPC                          |
| `getNotificationPreferencesFn`   | GET    | `notification.read`   | RPC (staged — not yet wired) |
| `updateNotificationPreferenceFn` | POST   | `notification.update` | RPC (staged — not yet wired) |

Server functions resolve tenant context from the authenticated session (never client payload) and verify notification ownership before mutating.

## Permissions

| Permission            | AccountAdmin (owner) | PropertyManager (admin) | Staff (member) |
| --------------------- | -------------------- | ----------------------- | -------------- |
| `notification.read`   | ✅                   | ✅                      | ✅             |
| `notification.update` | ✅                   | ✅                      | ✅             |

Notifications are personal (scoped to the caller's `userId`); all three roles may read their own notifications and update their own notification state/preferences. Defined in `shared/auth/permissions.ts`.

## Background jobs

- **insert-notification** — BullMQ worker that calls `insertNotification`.
- **urgent-email** — sends urgent-priority email queue entries immediately (pending/failed → sent/failed).
- **digest-notification** — daily batch that sends all `pending` normal-priority emails, keyed by property timezone (Q8); also sweeps orphaned urgent entries.

## Ports

- `NotificationRepositoryPort` — CRUD + count/findByUser for notifications.
- `NotificationEmailRepositoryPort` — email queue management (findPending, markSent/markFailed).
- `NotificationPreferenceRepositoryPort` — preference upsert/findByUser/findByUserAndType.
- `UserLookupPort` — `findByRole()`, `findAssignedManagers()` (managers AND staff), `getEmail()`, `getName()`.
- `EmailSenderPort` — wraps Resend `sendEmail()`.

- **`goal.progress_updated` pruned (Q14)** — event removed entirely: no consumer, only `goal.completed` is notification-worthy.
- **Digest keyed by property timezone** (already on properties table), not org timezone (Q8).
- **Review notification sources `inbox.inbox_item.created`** (2026-07 design) — the `review.created` notification subscribes to `inbox.inbox_item.created` (carries the `inboxItemId`, fires _after_ the item exists → no race), branching on `sourceType` (review vs feedback). That event is enriched with `rating`/`snippet` so the body derives fully. `resourceId` is the **inbox-item id**, making deep-links honest. (Replaces the old `review.created` subscription that stamped a `reviewId` under `resourceType: 'inbox_item'`.)
- **Reply notifications resolve via `InboxItemLookupPort`** (2026-07 design) — reply-lifecycle handlers (`submitted/approved/rejected/published/publish_failed`) resolve `reviewId → inboxItemId` through a new `InboxItemLookupPort` (`findInboxItemByReviewId`) and stamp `resourceType: 'inbox_item'` / `resourceId: inboxItemId`. No race (the inbox item always exists by reply time). If the lookup returns null (item hard-deleted) the notification is **skipped**. Result: every action-oriented notification is uniformly `inbox_item`-keyed, so `getNotificationUrl` has one honest branch: `/inbox?itemId=<id>`.
- **List excludes `dismissed`; header has both Mark-all-read and Clear-all** (2026-07 design) — `findByUser` now filters `status != 'dismissed'` (was returning all, so the per-item dismiss was a visual no-op). The popover header exposes two actions: **Mark all read** (existing → items move New→Earlier) and **Clear all** (new `dismissAll` use case + server fn → everything dismissed, list empties). No undo in v1 (rows persist in the DB, just hidden).
- **At most one unread per `(userId, type, resourceId)`** (2026-07 design) — `insertNotification` dedups: if an _unread_ row already exists for that key, it **bumps** it (refresh `updatedAt`/body) instead of inserting; if the existing row is read/dismissed, a fresh unread row is created (so the user is re-notified). Prevents the duplicate-stacking seen for re-escalations / re-submitted replies. Replaces one-row-per-event.
- **Notification type names distinct from event tags** (Q4).
