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
| Urgent             | Priority eligible for the recipient's explicit urgent quiet-hours bypass (see Q9 urgent types).                                                                                              |
| Normal             | Priority that always respects quiet hours; its email cadence may still be immediate for Action Required.                                                                                     |
| Digest             | Daily-cadence job that sends due `pending` entries per org.                                                                                                                                  |
| Channel preference | Sparse per-user/per-Property/category channel policy for configurable categories. Organization mandatory notices are policy, not preference rows.                                            |

## Relationships

**Within context:**

- `Notification` 1—1 `NotificationEmail` (email queue entry is created per notification when the email channel is enabled).
- Property-scoped `Notification` N—1 `NotificationPreference` (one sparse row per user × Property × configurable category × channel; absence resolves through versioned defaults). Organization mandatory notices never have preference rows.

**Cross-context (consumed via ports / event subscriptions):**

- **Identity** — user email + display name + role lookups via `UserLookupPort`; exact durable invitation-accepted, member-role-changed, and member-removed facts provide Organization account-notice recipient authority.
- **Property** — Property Responsible Managers and property timezone for digest scheduling.
- **Portal** — Portal and Portal Group Responsible Managers for scoped workflow delivery, plus an exact identifier/enum-only Portal Health fence for delayed serious-health delivery.
- **Guest** — tenant-scoped, content-free feedback source → Portal attribution through `FeedbackPortalLookupPort`; Notification never reads Guest-owned response tables.
- **Staff** — participation is evaluated by the owning responsibility APIs for PropertyManager eligibility; Staff attribution is never a notification source.
- **Review / Inbox / Goal** — active event subscriptions (see "Events consumed").

## Invariants

- A notification is always scoped to exactly one `userId` + `organizationId`; Property families require one `propertyId`, while mandatory account notices require `propertyId = null` and `resourceType = organization`.
- `userId` MUST be non-empty (constructor rejects `invalid_input`).
- `type`, `resourceType`, and `status` MUST be in their allowed sets (constructor + row mapper enforce).
- Email state machine: a queue entry moves `pending → sent` (success) or `pending/failed → failed` (retry); enforced at DB level by repo WHERE clauses.
- Urgent priority is derived from type, never set by callers.
- Preferences are sparse and resolve through the versioned category/channel default policy; they never imply “both on” globally. Mandatory Organization notices always materialize in-app plus immediate email and cannot enter preference, quiet-hours, daily-digest, or unsubscribe paths.
- Organization Export (`infrastructure/adapters/notification-organization-export.adapter.ts`) contributes `tenant_visible` data from `notifications`, `notification_preferences` and `notification_user_settings` only. LIF-01 bullet 7 excludes queues, outbox, receipts and rate limits, so `notification_email_queue` (provider message id/state, acceptance, delivery, bounce, suppression, retry counters, idempotency key and the immediate-acceptance health index), `notification_digest_batches`, `notification_digest_batch_members`, both governance quarantine tables, and the `notifications.event_id` delivery-correlation key are excluded and named in the export's `excludedRecordClasses`. An Organization with no notification row and no delivery setting contributes the affirmative `no_data`, never an invented empty CSV.

## Events produced

This context produces **no domain events**. It consumes events and materializes notifications + email-queue rows.

## Events consumed

| `_tag`                                                | Source      | Handler action                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity.invitation.accepted`                        | identity    | Enqueue Organization-scoped `account.organization_access_granted` to the exact affected user from the schema-validated durable fact.                                                                                                                                                                                                                            |
| `identity.member.role_changed`                        | identity    | Enqueue Organization-scoped `account.organization_role_changed` to the exact affected member (`memberUserId`, never the actor).                                                                                                                                                                                                                                 |
| `identity.member.removed`                             | identity    | Enqueue Organization-scoped `account.organization_access_removed` to the exact removed user; current membership is deliberately not required for their own removal notice.                                                                                                                                                                                      |
| `inbox.inbox_item.created`                            | inbox       | Enqueue `review.created` to Property Responsible Managers or `feedback.created` to Portal Responsible Managers; AccountAdmin recovery only when unowned.                                                                                                                                                                                                        |
| `inbox.handling_cycle.opened`                         | inbox       | For an exact current material Review revision only, enqueue `review.updated` to current Property Responsible Managers. Initial Review/feedback cycles are receipt-only because item creation already owns arrival delivery.                                                                                                                                     |
| `inbox.handling_cycle.reopened`                       | inbox       | Enqueue `inbox.reopened` to current source-specific Responsible Managers for an exact current cycle; suppress the acting manager. Provider reply loss and governed manual reopen share this durable path.                                                                                                                                                       |
| `inbox.inbox_item.assigned`                           | inbox       | Enqueue `inbox.assigned` notification to assignee.                                                                                                                                                                                                                                                                                                              |
| `inbox.inbox_items.bulk_assignment_completed`         | inbox       | Enqueue one `inbox.bulk_assigned` notification per next-assignee and Property. Bulk-linked per-item facts remain audit history and do not notify independently.                                                                                                                                                                                                 |
| `inbox.inbox_item.escalated`                          | inbox       | Enqueue urgent `inbox.escalated` to AccountAdmins as the current persistent-unacknowledged recovery path.                                                                                                                                                                                                                                                       |
| `inbox.inbox_item.escalation_resolved`                | inbox       | Enqueue calm `inbox.escalation_resolved` to the current eligible assignee, otherwise current Property Responsible Managers; suppress the resolver and fence delivery to the exact current resolution.                                                                                                                                                           |
| `inbox.inbox_note.added`                              | inbox       | Enqueue `inbox_note.added` to the assignee after claim; otherwise use source-specific Responsible Managers; suppress the author.                                                                                                                                                                                                                                |
| `review.reply.submitted`                              | review      | Enqueue urgent `reply.pending_approval` to AccountAdmins.                                                                                                                                                                                                                                                                                                       |
| `review.reply.approved`                               | review      | Enqueue `reply.approved` to reply author.                                                                                                                                                                                                                                                                                                                       |
| `review.reply.rejected`                               | review      | Enqueue `reply.rejected` to reply author.                                                                                                                                                                                                                                                                                                                       |
| `review.reply.published`                              | review      | Enqueue `reply.published` to reply author.                                                                                                                                                                                                                                                                                                                      |
| `review.reply.publish_failed`                         | review      | Enqueue urgent `reply.publish_failed` to reply author.                                                                                                                                                                                                                                                                                                          |
| `goal.monthly_result.closed`                          | goal        | For an exact current closed-and-achieved result, enqueue `goal.completed` to current responsible recipients for its Property, Portal Group, or Portal scope. Legacy `goal.completed` has no executable Notification handler.                                                                                                                                    |
| `goal.monthly_result.revised`                         | goal        | When outcome or availability changed, enqueue neutral `goal.result_revised` to current responsible recipients for the exact current revision. Superseded revisions and revisions whose two notification flags are both false are receipt-only.                                                                                                                  |
| `property.responsibility_became_needed`               | property    | Enqueue urgent, content-free `property.responsibility_needed` to current AccountAdmins only; link to Property settings.                                                                                                                                                                                                                                         |
| `portal.responsibility_became_needed`                 | portal      | Enqueue urgent, content-free `portal.responsibility_needed` to current AccountAdmins only; link to Portal settings.                                                                                                                                                                                                                                             |
| `portal.health.changed`                               | portal      | Enqueue calm Action Required `portal.health_attention` only for serious automatic degradation/unavailability to current Portal Responsible Managers, with AccountAdmin recovery only when unowned. Intentional publication states, responsibility-needed, awaiting-refresh, and recovery are receipt-only. Delivery revalidates the exact current Health fence. |
| `integration.google_account.reauthorization_required` | integration | Enqueue urgent, content-free `integration.reauthorization_required` to current AccountAdmins; link to Integration settings.                                                                                                                                                                                                                                     |

## Architecture layers

```
server/           → createServerFn wrappers (queries + mutations), tenant resolution
application/      → use cases, ports, public-api barrel
  use-cases/        insert-notification
  ports/            repository / user-lookup / email-sender ports
domain/           → types, constructors, constructors-email, constructors-transitions, constructors-preference, errors
infrastructure/
  jobs/             BullMQ workers (insert-notification, digest, urgent-email,
                    reconcile-missing-notifications)
  outbox-consumers.ts        durable at-least-once consumer for
                             `inbox.inbox_item.created`
  workflow-outbox-consumers.ts durable consumers for assignment, escalation,
                             notes, and Reply lifecycle facts
  bulk-assignment-outbox-consumers.ts durable grouped consumer for
                             `inbox.inbox_items.bulk_assignment_completed`
  escalation-resolution-outbox-consumers.ts exact-state durable consumer for
                             `inbox.inbox_item.escalation_resolved`
  handling-cycle-outbox-consumers.ts exact-cycle durable consumers for
                             `inbox.handling_cycle.opened` and `.reopened`
  goal-outbox-consumers.ts   exact-result durable consumers for
                             `goal.monthly_result.closed` and `.revised`
  portal-outbox-consumers.ts portal.write-gated durable consumer for
                             `portal.responsibility_became_needed`
  portal-health-outbox-consumers.ts exact-state durable consumer for
                             actionable `portal.health.changed`
  property-outbox-consumers.ts durable consumer for
                             `property.responsibility_became_needed`
  identity-account-outbox-consumers.ts exact-user durable consumers for
                             three Organization account lifecycle facts
  inbox-notification-fanout.ts  the ONE inbox-item → insert-notification jobs
                             path, shared by durable delivery and repair
  adapters/         cross-context lookups (db-user-lookup, resend-email)
  repositories/     Drizzle implementations of ports (+ row mapper)
```

## Use cases

| Name                 | Input                                                                | Output                 | Permission                |
| -------------------- | -------------------------------------------------------------------- | ---------------------- | ------------------------- |
| `insertNotification` | `InsertNotificationInput` (userId, orgId, type, resource, `payload`) | `Notification \| null` | Internal (BullMQ workers) |

`insertNotification` is invoked by the insert-notification BullMQ worker, not directly by server functions. Returns `null` when the user has disabled both channels (still persists if email-only) — see Q19.

Callers pass **facts, never sentences**: `title`/`body` are derived inside `createNotification` from `renderNotification(type, payload)`, so the stored snapshot always matches what every channel renders (ADR 0046 r.8). A repeat event for a resource that already has an unread row **coalesces** into it instead of inserting (ADR 0046 r.2).

## Public API

Exported from `application/public-api.ts`:

- **Types:** `Notification`, `NotificationPage`, `NotificationFeedHead`, `NotificationPreference`, `NotificationType`, `NotificationCategory`, `ConfigurableNotificationCategory`, `NotificationPriority`, `NotificationStatus`, `NotificationResourceType`, `NotificationPayload`, `NotificationCadence`, `NotificationChannel`, `NotificationUserSettings`, `NotificationListFilter`.
- **Values:** `isUrgent`, `getDefaultEnabled`, `getDefaultCadence`, `isPreferenceDisableable`, `classifyNotification`, `NOTIFICATION_SETTINGS_CATEGORIES`, `GOVERNING_NOTIFICATION_CATEGORIES`, `renderNotification`, `notificationLink`, `formatWaitingAge`.
- **Ports:** `UserLookupPort`, `InboxItemLookupPort`.
- `NOTIFICATION_TYPES`, `parseNotificationPayload`, `isEmptyNotificationPayload`, and `insertNotification` remain context-internal; incoming payloads are parsed before persistence.

The build function (`build.ts`) also exposes `publicApi` query/mutation helpers (`findById`, `getFeedHead`, `getNotifications`, `markRead`, `markAllRead`, `dismiss`, `getPreferences`, `updatePreference`) consumed by the notification server functions, plus the bounded operational readers `readMissingNotificationCount` and `readNotificationDeliveryLag`.

## Server functions

| Name                             | Method | Permission            | Route                                                 |
| -------------------------------- | ------ | --------------------- | ----------------------------------------------------- |
| `getNotificationFeedHeadFn`      | GET    | `notification.read`   | Active offset-zero page + exact count + watermark RPC |
| `getNotificationsFn`             | GET    | `notification.read`   | RPC                                                   |
| `markNotificationReadFn`         | POST   | `notification.update` | RPC                                                   |
| `markNotificationUnreadFn`       | POST   | `notification.update` | RPC                                                   |
| `markAllNotificationsReadFn`     | POST   | `notification.update` | RPC                                                   |
| `dismissNotificationFn`          | POST   | `notification.update` | RPC                                                   |
| `dismissAllNotificationsFn`      | POST   | `notification.update` | RPC                                                   |
| `getNotificationPreferencesFn`   | GET    | `notification.read`   | RPC                                                   |
| `updateNotificationPreferenceFn` | POST   | `notification.update` | RPC                                                   |

Server functions resolve tenant context from the authenticated session (never client payload) and verify notification ownership before mutating.

## Permissions

| Permission            | AccountAdmin (owner) | PropertyManager (admin) | Staff (member) |
| --------------------- | -------------------- | ----------------------- | -------------- |
| `notification.read`   | ✅                   | ✅                      | ✅             |
| `notification.update` | ✅                   | ✅                      | ✅             |

Notifications are personal (scoped to the caller's `userId`); all three roles may read their own notifications and update their own notification state/preferences. Defined in `shared/auth/permissions.ts`.

## Background jobs

- **insert-notification** — BullMQ worker that first revalidates the job's identifier-only audience descriptor against current responsibility, role, access, participation, and any exact workflow/Health fence. Durable-source jobs then atomically claim their materialization receipt with the notification/preference/email writes in one PostgreSQL transaction. Stale recipients settle `obsolete`; authority lookup failures retry; legacy jobs without an audience fail closed.
- **urgent-email** — handles immediate queue entries. Organization mandatory rows are revalidated against the exact durable Identity fact and recipient before provider admission; Property rows retain their current scope, capability, preference, quiet-hours, and membership checks.
- **digest-notification** — daily batch that sends all `pending` normal-priority emails, keyed by property timezone (Q8); also sweeps orphaned urgent entries.
- **reconcile-missing-notifications** — every 10 min, tenant-cross. Finds inbox items created in the last 24h (past a 5-minute grace edge) that have **no notification row for anybody** and enqueues the insert-notification jobs they never got. Bounded: keyset cursor on `inbox_items (created_at, id)`, 100 items × 5 batches per firing. Idempotent without a second dedupe mechanism — the candidate query only returns items with zero notifications, so a healed item leaves the candidate set, and because the sweep goes through the ordinary insert-notification job, preferences are honoured (a user who disabled the email channel is not backfilled mail). The gap it measures is the `notification.missing_for_inbox_item` gauge.

## Ports

- `NotificationRepositoryPort` — CRUD + count/findByUser for notifications.
- `NotificationEmailRepositoryPort` — email queue management (findPending, markSent/markFailed).
- `NotificationPreferenceRepositoryPort` — preference upsert/findByUser/findByUserAndType.
- `UserLookupPort` — identity-only `findByRole()`, `getEmail()`, `getName()`, `findActorRole()` (role for `payload.actorRole`; never a name).
- `ResponsibleManagerLookupPort` — current, eligibility-filtered Property, Portal, and Portal Group responsibility supplied by owning public APIs, plus a current Property-operator eligibility check for direct assignees/reply authors. Access grants and Staff attribution are not recipient sources.
- `FeedbackPortalLookupPort` — Guest-owned, tenant-scoped Portal attribution for canonical or legacy private-feedback sources. It returns identifiers only.
- `EmailSenderPort` — wraps Resend `sendEmail()`.
- `InboxItemLookupPort` — `findInboxItemByReviewId()`, `findInboxItemFacts()`, and `findHandlingCycleNotificationFacts()` (property, source Portal, assignee, locally collected guest rating, source, age, and the exact current cycle/head revision fence — content-free facts the events do not carry). Google/provider ratings never cross this port.
- `EscalationResolutionLookupPort` — exact current resolution timestamp/actor, assignment, Property, and Property name; no Inbox source content.
- `PortalHealthLookupPort` — Portal-owned exact current `propertyId/status/reason/sourceVersion` lookup. It is identifier/enum-only and prevents delayed serious-health jobs from notifying after recovery or a newer Health interval.
- `NotificationGapRepositoryPort` — `findItemsMissingNotifications()` (one keyset batch of inbox items with no notification row), `countItemsMissingNotifications()` (the same predicate as a capped count, for the gauge).
- `NotificationDeliveryLagRepository` — bounded, payload-free evidence for missing base-consumer receipts, Redis-accepted deliveries missing PostgreSQL materialization, and immediate-email provider acceptance. Immediate-email rows are linked to their durable source clock; the read reports awaiting/attempted counts, source-link gaps, sample saturation, and an exact p99 only when the bounded sample is complete.

## Durable delivery

Every source fact is written atomically to the outbox; four layers contain and expose delivery failure:

1. **Durable consumers** validate identifier-only facts, resolve current recipients, enqueue deterministic per-recipient jobs, and acknowledge only after every enqueue succeeds.
2. **Delivery-time authority** treats every enqueued recipient as a candidate and re-resolves the exact audience immediately before writing.
3. **Redis→PostgreSQL settlement** records Redis acceptance, then claims materialization in the same transaction as preference evaluation, notification/coalescing, and email-queue writes.
4. **Repair and evidence** use outbox replay before the base receipt, BullMQ retry/quarantine after acceptance, the bounded `reconcile-missing-notifications` backstop when a receipt has no notification row, and `readNotificationDeliveryLag` for payload-free operational evidence.

- **Canonical Goal delivery** — only `goal.monthly_result.closed:v1` may create `goal.completed`, and only when the Goal-owned exact lookup proves the result remains closed and achieved. Append-only `goal.monthly_result.revised:v1` creates the neutral `goal.result_revised` only when outcome or availability changed, after an exact current revision fence proves the event was not superseded; it never mislabels a false or unavailable result as completed. `goal.monthly_result.reconciled` is durable evidence without a user notification; legacy `goal.completed` retains schema/history compatibility but has no Notification registration or handler.
- **Digest keyed by property timezone** (already on properties table), not org timezone (Q8).
- **Action Required cadence is category-derived** — an absent email preference defaults every `urgent_operational` type to immediate cadence, including private feedback, revised/reopened work, and serious Portal Health. `NotificationPriority` remains the separate quiet-hours-bypass axis, so calm Action Required items can send promptly after quiet hours without bypassing them.
- **Mandatory account notices are Organization policy** (2026-08-28 readiness slice) — only `identity.invitation.accepted:v1`, `identity.member.role_changed:v1`, and `identity.member.removed:v1` map to the three active account types. They persist with `property_id = null`, render calm content-free copy, and create both an in-app row and immediate email row. Property settings and preference APIs do not expose the category; persistence rejects mandatory preferences and daily mandatory email. Provider sending remains behind the existing execution/capability gates; this repository-local wiring does not activate a live provider or deployment.
- **Immediate-email acceptance is source-clocked** — Operations exposes awaiting/attempted counts, oldest linked source age, accepted sample count, source-link gaps, saturation, and unsaturated p99. Rows carrying a retained `notBefore` policy/quiet-hours hold are deliberately outside this target. The five-minute alert evaluates latency only when global email is active or accepted/attempted work proves a narrower activation; untouched linked backlog stays quiet while email is deliberately dark, while missing durable-source linkage remains an independent evidence failure.
- **Review notification sources `inbox.inbox_item.created`** (2026-07 design) — the `review.created` notification subscribes to `inbox.inbox_item.created` (carries the `inboxItemId`, fires _after_ the item exists → no race), branching on `sourceType` (review vs feedback). The handler resolves allowlisted property/platform/age facts and, for Portal feedback only, the local guest rating. The durable event never carries source content. `resourceId` is the **inbox-item id**, making deep-links honest. (Replaces the old `review.created` subscription that stamped a `reviewId` under `resourceType: 'inbox_item'`.)
- **Re-handling sources are canonical Handling Cycle facts** — `inbox.handling_cycle.opened` produces `review.updated` only for `material_revision_changed`; initial `review_observed`, `feedback_submitted`, and `legacy_backfill` facts are acknowledged without delivery so they cannot duplicate `inbox.inbox_item.created`. `inbox.handling_cycle.reopened` produces `inbox.reopened` for governed manual reopen and provider reply loss. Both the consumer and insert worker require the exact current open source cycle/head, resolve current Property/Portal responsibility, suppress a user actor, and use stable per-recipient job identities.
- **Reply notifications resolve via `InboxItemLookupPort`** (2026-07 design) — reply-lifecycle handlers (`submitted/approved/rejected/published/publish_failed`) resolve `reviewId → inboxItemId` through a new `InboxItemLookupPort` (`findInboxItemByReviewId`) and stamp `resourceType: 'inbox_item'` / `resourceId: inboxItemId`. No race (the inbox item always exists by reply time). If the lookup returns null (item hard-deleted) the notification is **skipped**. Result: every action-oriented notification is uniformly `inbox_item`-keyed, so `getNotificationUrl` has one honest branch: `/inbox?itemId=<id>`.
- **Bell and full-page dismissal are separate** — `findByUser` filters `status != 'dismissed'` (per-item dismissal therefore removes a row). The Bell quick view exposes **Mark all read** and a link to the complete notification page; it does not carry a destructive bulk action. The full page exposes confirmed **Dismiss all**, which changes only notification rows and never the source workflow. No undo in v1; rows persist in the database but are hidden.
- **Filtered pagination has server-derived continuation evidence** — the server requests `limit + 1` after applying the selected filter, returns only `limit` rows, and sets `hasMore` from the extra row. The client never guesses another page merely because the current filtered page is exactly full.
- **Periodic refresh is one atomic feed-head snapshot** — the exact unread count, offset-zero page, and transaction watermark are read in one repeatable-read repository transaction and poll through one client observer every 30 seconds while the surface is visible. Older pages live in a separate, disabled infinite-query cache and are requested only through **Load more**, so focus/interval refresh never replays all history already loaded. The refreshed head is merged ahead of retained history by stable notification id, removing offset-boundary overlap without dropping older rows. Optimistic read/dismiss actions patch both caches and restore the complete head snapshot on rollback.
- **At most one unread per `(userId, type, resourceId)`** (2026-07 design, ADR 0046 r.2) — enforced in the database by the partial unique index `notifications_unread_resource_unique … WHERE status = 'unread'` (migration 0070, replacing the event-ID-keyed unique). `insertNotification` finds the unread row and **coalesces**: `coalesced_count + 1`, `coalesced_latest_at = now`, payload merged newest-wins with `occurrences` set, and title/body re-rendered so the row reads "… Updated 3 times". If the existing row is read/dismissed a fresh unread row is created (so the user is re-notified). Prevents the duplicate-stacking seen for re-escalations / re-submitted replies.
- **Copy is rendered, never written by consumers** (2026-08 design, ADR 0046 r.8) — `domain/notification-templates.ts` is the single renderer for in-app rows, urgent email, and digest lines. Durable consumers enqueue an allowlisted, content-free `payload`; `parseNotificationPayload` drops every unrecognised key on the way in and out of persistence.
- **`digest_summary` retired as a category** (2026-08 design) — a digest is a **cadence** (`cadence = 'daily'`), and the category's default `{in_app:false, email:false}` silently dropped every `goal.completed`. Categories are now `mandatory | urgent_operational | workflow_collaboration | recognition`; `goal.completed` classifies as `recognition`. Migration 0070 remaps stored values in `notifications`, `notification_email_queue` and `notification_preferences`.
- **Recognition preference controls remain beta-dark** (2026-08 design) — `recognition` remains a valid category for active Goal notifications, but it is absent from settings, category filter tabs, and row-level mute controls.
- **Notification type names distinct from event tags** (Q4).
