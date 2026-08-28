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
- **Legacy Badge compatibility** — neutral rendering of an already-persisted
  notification type only; there is no Badge lookup, subscription, replay, or
  materialization path.

## Invariants

- A notification is always scoped to exactly one `userId` + `organizationId`; Property families require one `propertyId`, while mandatory account notices require `propertyId = null` and `resourceType = organization`.
- `userId` MUST be non-empty (constructor rejects `invalid_input`).
- `type`, `resourceType`, and `status` MUST be in their allowed sets (constructor + row mapper enforce).
- Email state machine: a queue entry moves `pending → sent` (success) or `pending/failed → failed` (retry); enforced at DB level by repo WHERE clauses.
- Urgent priority is derived from type, never set by callers.
- Preferences are sparse and resolve through the versioned category/channel default policy; they never imply “both on” globally. Mandatory Organization notices always materialize in-app plus immediate email and cannot enter preference, quiet-hours, daily-digest, or unsubscribe paths.

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
  event-handlers/   subscribe to domain events, enqueue BullMQ jobs
  jobs/             BullMQ workers (insert-notification, digest, urgent-email,
                    reconcile-missing-notifications)
  outbox-consumers.ts        durable at-least-once consumer for
                             `inbox.inbox_item.created`
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

- **Types:** `Notification`, `NotificationPage`, `NotificationFeedHead`, `NotificationEmail`, `NotificationPreference`, `NotificationType`, `NotificationCategory`, `ConfigurableNotificationCategory`, `NotificationPriority`, `NotificationStatus`, `EmailQueueStatus`, `NotificationResourceType`, `NotificationPayload`, `NotificationGuestRating`, `NotificationActorRole`, `NotificationPlatform`, `NotificationTargetKind`, `RenderedNotification`, `NotificationLink`, `CreateNotificationInput`, `InsertNotificationInput`, `CreateNotificationEmailInput`, `CreateNotificationPreferenceInput`, `NotificationError`.
- **Values:** `isUrgent`, `URGENT_TYPES`, `notificationError`, `isNotificationError`, `getDefaultEnabled`, `classifyNotification`, `notificationScopeForType`, `NOTIFICATION_CATEGORIES` (complete retained persistence vocabulary), `NOTIFICATION_SETTINGS_CATEGORIES` (configurable Property preference rows only), `GOVERNING_NOTIFICATION_CATEGORIES` (active non-empty filter rows, including mandatory history), and the render layer: `renderNotification`, `notificationLink`, `formatWaitingAge`. `NOTIFICATION_TYPES` (canonical type list), `parseNotificationPayload` and `isEmptyNotificationPayload` are deliberately NOT on the surface: every consumer is inside this context (`domain/constructors.ts`, `infrastructure/repositories/notification-row.mapper.ts`), and a payload arriving from another context is parsed on the way in by `insertNotification`, not by the caller.
- **Preference vocabulary:** `NotificationCadence`, `NotificationChannel`, `NotificationUserSettings`, `NOTIFICATION_LIST_FILTERS`, `NotificationListFilter`, `getDefaultCadence`, `isPreferenceDisableable`.
- **Audience authority:** `NotificationAudience`, `NotificationAudienceAuthorizer`, `NotificationAudienceAuthorizationInput`. Delivery is authorized against current audience facts, never against the payload that requested it.
- **Fact shapes the lookup ports return:** `InboxItemFacts`, `HandlingCycleNotificationFacts`, `EscalationResolutionNotificationFacts`, `PortalHealthNotificationFacts` — identifier and enum state only.
- **Delivery observation:** `DeliveryErrorClass`, `NotificationDeliveryLagReport`, `NotificationDeliveryLagWindow`.
- **Ports:** `NotificationRepositoryPort`, `NotificationEmailRepositoryPort`, `NotificationPreferenceRepositoryPort`, `UserLookupPort`, `ResponsibleManagerLookupPort`, `FeedbackPortalLookupPort`, `PortalHealthLookupPort`, `EmailSenderPort`, `InboxItemLookupPort`, `EscalationResolutionLookupPort`, `NotificationDeliveryLagRepository`.

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

`emitAfterCommit` (`shared/outbox/commit.ts`) is best-effort: it catches and warns, so a throw in the inbox or notification handler could leave a committed workflow change with **no** notification. Four layers now contain and expose that failure:

1. **Durable outbox consumers** cover Inbox creation/Handling Cycle/assignment/grouped-assignment/escalation/resolution/note events, the five manager-facing Reply lifecycle events, achieved Goal Program monthly results and outcome/availability revisions, integration reauthorization, Property/Portal responsibility-needed events, actionable automatic Portal Health changes, and the three exact Identity account lifecycle facts listed above. They acknowledge only after every enqueue succeeds and use deterministic per-recipient job identities so redelivery converges instead of inflating the unread row. Every source fact is identifier-only and is written atomically with its owning workflow change. Handling Cycle closure and `goal.monthly_result.reconciled` are durable evidence but intentionally have no Notification consumer.
2. **Delivery-time authority** means an enqueued recipient is only a candidate. Every insert job declares one of ten identifier-only audiences: exact responsible scope, AccountAdmin recovery, current Inbox assignee, exact grouped Inbox assignee set, exact current escalation resolution, exact current Handling Cycle, exact current Portal Health, exact current Goal result revision, current Property operator, or the exact affected Organization user from one admitted Identity fact. The worker re-resolves that authority immediately before writing. The affected-user route binds the event id, type, Organization, source context, recovery fence, schema-valid payload, and exact user; it does not substitute membership, an actor, or a Property.
3. **Redis→PostgreSQL settlement** gives every active trigger-derived delivery deterministic `notification.enqueue:*` and `notification.materialized:*` receipts. Redis acceptance precedes enqueue evidence; the materialization receipt is the concurrency claim and commits in the same transaction as preference evaluation, the notification row, coalescing, and email-queue row. A crash or concurrent replay therefore applies once; any post-claim failure rolls the claim and all notification writes back together. The durable source event's route, tenant, and recovery fence are verified before settlement.
4. **Repair and evidence are explicit.** `reconcile-missing-notifications` remains the bounded repair path for a new Inbox item that predates or exhausts normal delivery. Normal outbox replay repairs failures before the base receipt; BullMQ retry/quarantine owns accepted jobs. `readNotificationDeliveryLag` reports, without selecting payloads, missing base receipts, accepted-but-unmaterialized deliveries, and immediate-email acceptance evidence over a 24-hour operational window after a one-minute grace edge (1,000-row per-stage bound with saturation). Email latency is measured from the durable source fact, never queue insertion; p99 is withheld when source linkage is absent or the sample saturates. It is intentionally a signal, not a false claim that application code can reconstruct a Redis job after total Redis loss once the base receipt exists.

To make the durable path actually deliver, an operator sets **`OUTBOX_DISPATCHER_ENABLED=true`** (with `QUEUE_REDIS_URL` set — `worker/index.ts` starts the relay + dispatcher only when both hold). The `DURABLE_CUTOVER_INBOX*` flags do **not** gate this consumer: they govern the four `review.*` inbox projection families, not `inbox.inbox_item.created`. Flipping the dispatcher is an ops decision with blast radius across every context's consumers, which is why nothing here changes its default.

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
- **Copy is rendered, never written by handlers** (2026-08 design, ADR 0046 r.8) — `domain/notification-templates.ts` is the single renderer for the in-app row, the urgent email and the digest line. Handlers emit a content-free `payload` (property name, local Portal guest rating, platform, waiting age, actor role, moderation reason, goal/badge/portal names, occurrences); `notifications.payload` is registered in `PROTECTED_FIELD_REGISTRY`, and `parseNotificationPayload` drops every unrecognised key on the way in AND out of the database. Migration 0128 and its compatibility trigger remove legacy provider-rating copies at persistence. This is what removed the raw-UUID bodies ("Inbox item &lt;uuid&gt; has been escalated", "Badge definition: &lt;uuid&gt;").
- **`digest_summary` retired as a category** (2026-08 design) — a digest is a **cadence** (`cadence = 'daily'`), and the category's default `{in_app:false, email:false}` silently dropped every `goal.completed`. Categories are now `mandatory | urgent_operational | workflow_collaboration | recognition`; `goal.completed` classifies as `recognition`. Migration 0070 remaps stored values in `notifications`, `notification_email_queue` and `notification_preferences`.
- **Recognition controls are beta-dark, retained rows are not erased** (2026-08 design) — `recognition` and `badge.awarded` remain valid persistence values so existing notification and preference rows still map. Recognition is absent from settings, category filter tabs, and row-level mute controls. Historical badge rows render as neutral earlier-award history and link to their Property; they never offer the unavailable Recognition route. Notification has no `badge.awarded` subscription, replay path, Badge lookup, or award-materialization handler; REC-01 removed Badge/Leaderboard server operations, event consumers, jobs, and runtime producers while retaining the historical type envelope and neutral renderer.
- **Notification type names distinct from event tags** (Q4).
