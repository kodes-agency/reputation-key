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
  jobs/             BullMQ workers (insert-notification, digest, urgent-email,
                    reconcile-missing-notifications)
  outbox-consumers.ts        durable at-least-once consumer for
                             `inbox.inbox_item.created`
  inbox-notification-fanout.ts  the ONE inbox-item → insert-notification jobs
                             path, shared by the bus handler, the durable
                             consumer and the reconciliation sweep
  adapters/         cross-context lookups (db-user-lookup, resend-email)
  repositories/     Drizzle implementations of ports (+ row mapper)
```

## Use cases

| Name                 | Input                                                                | Output                 | Permission                |
| -------------------- | -------------------------------------------------------------------- | ---------------------- | ------------------------- |
| `insertNotification` | `InsertNotificationInput` (userId, orgId, type, resource, `payload`) | `Notification \| null` | Internal (event handlers) |

`insertNotification` is invoked by the insert-notification BullMQ worker, not directly by server functions. Returns `null` when the user has disabled both channels (still persists if email-only) — see Q19.

Callers pass **facts, never sentences**: `title`/`body` are derived inside `createNotification` from `renderNotification(type, payload)`, so the stored snapshot always matches what every channel renders (ADR 0046 r.8). A repeat event for a resource that already has an unread row **coalesces** into it instead of inserting (ADR 0046 r.2).

## Public API

Exported from `application/public-api.ts`:

- **Types:** `Notification`, `NotificationEmail`, `NotificationPreference`, `NotificationType`, `NotificationCategory`, `NotificationPriority`, `NotificationStatus`, `EmailQueueStatus`, `NotificationResourceType`, `NotificationPayload`, `NotificationRating`, `NotificationActorRole`, `NotificationPlatform`, `NotificationTargetKind`, `RenderedNotification`, `NotificationLink`, `CreateNotificationInput`, `InsertNotificationInput`, `CreateNotificationEmailInput`, `CreateNotificationPreferenceInput`, `NotificationError`.
- **Values:** `isUrgent`, `URGENT_TYPES`, `NOTIFICATION_TYPES` (canonical type list), `notificationError`, `getDefaultEnabled`, `classifyNotification`, `NOTIFICATION_CATEGORIES` (all four, for settings), `GOVERNING_NOTIFICATION_CATEGORIES` (only those governing ≥ 1 type — what a filter may offer), and the render layer: `renderNotification`, `notificationLink`, `formatWaitingAge`, `parseNotificationPayload`, `isEmptyNotificationPayload`.
- **Ports:** `NotificationRepositoryPort`, `NotificationEmailRepositoryPort`, `NotificationPreferenceRepositoryPort`, `UserLookupPort`, `EmailSenderPort`, `InboxItemLookupPort`, `RecognitionLookupPort`.

The build function (`build.ts`) also exposes `publicApi` query/mutation helpers (`findById`, `getUnreadCount`, `getNotifications`, `markRead`, `markAllRead`, `dismiss`, `getPreferences`, `updatePreference`) consumed by the notification server functions.

## Server functions

| Name                             | Method | Permission            | Route |
| -------------------------------- | ------ | --------------------- | ----- |
| `getUnreadNotificationCountFn`   | GET    | `notification.read`   | RPC   |
| `getNotificationsFn`             | GET    | `notification.read`   | RPC   |
| `markNotificationReadFn`         | POST   | `notification.update` | RPC   |
| `markNotificationUnreadFn`       | POST   | `notification.update` | RPC   |
| `markAllNotificationsReadFn`     | POST   | `notification.update` | RPC   |
| `dismissNotificationFn`          | POST   | `notification.update` | RPC   |
| `dismissAllNotificationsFn`      | POST   | `notification.update` | RPC   |
| `getNotificationPreferencesFn`   | GET    | `notification.read`   | RPC   |
| `updateNotificationPreferenceFn` | POST   | `notification.update` | RPC   |

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
- **reconcile-missing-notifications** — every 10 min, tenant-cross. Finds inbox items created in the last 24h (past a 5-minute grace edge) that have **no notification row for anybody** and enqueues the insert-notification jobs they never got. Bounded: keyset cursor on `inbox_items (created_at, id)`, 100 items × 5 batches per firing. Idempotent without a second dedupe mechanism — the candidate query only returns items with zero notifications, so a healed item leaves the candidate set, and because the sweep goes through the ordinary insert-notification job, preferences are honoured (a user who disabled the email channel is not backfilled mail). The gap it measures is the `notification.missing_for_inbox_item` gauge.

## Ports

- `NotificationRepositoryPort` — CRUD + count/findByUser for notifications.
- `NotificationEmailRepositoryPort` — email queue management (findPending, markSent/markFailed).
- `NotificationPreferenceRepositoryPort` — preference upsert/findByUser/findByUserAndType.
- `UserLookupPort` — `findByRole()`, `findAssignedManagers()` (managers AND staff), `getEmail()`, `getName()`, `findActorRole()` (role for `payload.actorRole`; never a name).
- `EmailSenderPort` — wraps Resend `sendEmail()`.
- `InboxItemLookupPort` — `findInboxItemByReviewId()`, `findInboxItemFacts()` (property name, rating, source, age — the render facts the events do not carry).
- `RecognitionLookupPort` — `findGoalFacts()`, `findBadgeFacts()` (goal / badge / portal display names).
- `NotificationGapRepositoryPort` — `findItemsMissingNotifications()` (one keyset batch of inbox items with no notification row), `countItemsMissingNotifications()` (the same predicate as a capped count, for the gauge).

## Durable delivery

`emitAfterCommit` (`shared/outbox/commit.ts`) is best-effort: it catches and warns, so a throw in the inbox or notification handler left a committed review with **no** notification and nothing retrying. Two things now close that:

1. **`infrastructure/outbox-consumers.ts`** registers `notification.on-inbox-item-created` with the outbox dispatcher — the at-least-once path. It is fenced three ways: the dispatcher's receipt pre-check, a deterministic per-recipient BullMQ job id (`<eventId>-<userId>`) that a redelivery collapses onto, and the notification insert's own convergence (the partial unique index `notifications_unread_resource_unique` plus `onConflictDoUpdate`). The bus handler derives the SAME job id from the same event id (the outbox row id **is** the domain event id — `insertOutboxRow` sets `id: event.eventId`), so once the dispatcher is enabled the dual path cannot double-notify.
2. **`reconcile-missing-notifications`** heals what either path drops, and works regardless of the flags.

To make the durable path actually deliver, an operator sets **`OUTBOX_DISPATCHER_ENABLED=true`** (with `REDIS_URL` set — `worker/index.ts` starts the relay + dispatcher only when both hold). The `DURABLE_CUTOVER_INBOX*` flags do **not** gate this consumer: they govern the four `review.*` inbox projection families, not `inbox.inbox_item.created`. Flipping the dispatcher is an ops decision with blast radius across every context's consumers, which is why nothing here changes its default.

- **`goal.progress_updated` pruned (Q14)** — event removed entirely: no consumer, only `goal.completed` is notification-worthy.
- **Digest keyed by property timezone** (already on properties table), not org timezone (Q8).
- **Review notification sources `inbox.inbox_item.created`** (2026-07 design) — the `review.created` notification subscribes to `inbox.inbox_item.created` (carries the `inboxItemId`, fires _after_ the item exists → no race), branching on `sourceType` (review vs feedback). That event is enriched with `rating`/`snippet` so the body derives fully. `resourceId` is the **inbox-item id**, making deep-links honest. (Replaces the old `review.created` subscription that stamped a `reviewId` under `resourceType: 'inbox_item'`.)
- **Reply notifications resolve via `InboxItemLookupPort`** (2026-07 design) — reply-lifecycle handlers (`submitted/approved/rejected/published/publish_failed`) resolve `reviewId → inboxItemId` through a new `InboxItemLookupPort` (`findInboxItemByReviewId`) and stamp `resourceType: 'inbox_item'` / `resourceId: inboxItemId`. No race (the inbox item always exists by reply time). If the lookup returns null (item hard-deleted) the notification is **skipped**. Result: every action-oriented notification is uniformly `inbox_item`-keyed, so `getNotificationUrl` has one honest branch: `/inbox?itemId=<id>`.
- **List excludes `dismissed`; header has both Mark-all-read and Clear-all** (2026-07 design) — `findByUser` now filters `status != 'dismissed'` (was returning all, so the per-item dismiss was a visual no-op). The popover header exposes two actions: **Mark all read** (existing → items move New→Earlier) and **Clear all** (new `dismissAll` use case + server fn → everything dismissed, list empties). No undo in v1 (rows persist in the DB, just hidden).
- **At most one unread per `(userId, type, resourceId)`** (2026-07 design, ADR 0046 r.2) — enforced in the database by the partial unique index `notifications_unread_resource_unique … WHERE status = 'unread'` (migration 0070, replacing the event-ID-keyed unique). `insertNotification` finds the unread row and **coalesces**: `coalesced_count + 1`, `coalesced_latest_at = now`, payload merged newest-wins with `occurrences` set, and title/body re-rendered so the row reads "… Updated 3 times". If the existing row is read/dismissed a fresh unread row is created (so the user is re-notified). Prevents the duplicate-stacking seen for re-escalations / re-submitted replies.
- **Copy is rendered, never written by handlers** (2026-08 design, ADR 0046 r.8) — `domain/notification-templates.ts` is the single renderer for the in-app row, the urgent email and the digest line. Handlers emit a content-free `payload` (property name, rating, platform, waiting age, actor role, moderation reason, goal/badge/portal names, occurrences); `notifications.payload` is registered in `PROTECTED_FIELD_REGISTRY`, and `parseNotificationPayload` drops every unrecognised key on the way in AND out of the database. This is what removed the raw-UUID bodies ("Inbox item &lt;uuid&gt; has been escalated", "Badge definition: &lt;uuid&gt;").
- **`digest_summary` retired as a category** (2026-08 design) — a digest is a **cadence** (`cadence = 'daily'`), and the category's default `{in_app:false, email:false}` silently dropped every `goal.completed`. Categories are now `mandatory | urgent_operational | workflow_collaboration | recognition`; `goal.completed` classifies as `recognition`. Migration 0070 remaps stored values in `notifications`, `notification_email_queue` and `notification_preferences`.
- **Notification type names distinct from event tags** (Q4).
