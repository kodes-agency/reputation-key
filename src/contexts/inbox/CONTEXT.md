# Inbox Context

## Bounded context

Unified triage surface for reviews and feedback — status tracking, assignment, notes, and new-item counts.

## Glossary

| Term              | Definition                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inbox Item**    | A unified triage entry. Points to either a Review or a Feedback. Carries denormalized filter/sort fields and inbox-specific state (status, assignment). |
| **Source Type**   | The origin of an inbox item: `'review'` or `'feedback'`.                                                                                                |
| **Source ID**     | The primary key of the source entity (a `ReviewId` or `FeedbackId`).                                                                                    |
| **Status**        | The triage state of an inbox item: `new`, `read`, `addressed`, `escalated`, `archived`.                                                                 |
|                   | **Addressed**                                                                                                                                           | The item has been handled. For reviews: only via `review.reply.published` event (auto-transition). For feedback: manager manually marks it (no reply possible). No manual "Mark Addressed" button for reviews — archive instead. |
| **Escalated**     | The item has been flagged for management attention. Can be escalated from any status.                                                                   |
| **Assignment**    | Linking an inbox item to a specific team member. PM+ only. Assignee must have access to the item's property.                                            |
| **Internal Note** | A text annotation on an inbox item. Stored in `inbox_notes`. Tracks author and timestamp. Multiple notes per item.                                      |
| **Source Date**   | The denormalized date from the source entity (`reviewedAt` for reviews, `createdAt` for feedback). Used for sorting.                                    |
|                   | **New Badge**                                                                                                                                           | Count of inbox items with `status = 'new'` for the current user's accessible properties. Redis-cached, invalidated on status events. Ephemeral — items auto-transition `new→read` on open.                                       |
|                   | **Unaddressed**                                                                                                                                         | Filter group meaning "needs attention": items with `status IN ('new', 'read')`. Used as the secondary tab alongside "All".                                                                                                       |

## Relationships

- Inbox Item → Review (via `sourceType = 'review'`, `sourceId = reviewId`). Detail fetched by JOIN.
- Inbox Item → Feedback (via `sourceType = 'feedback'`, `sourceId = feedbackId`). Rating value denormalized at creation time from linked `Rating`.
- Inbox Item → StaffAssignment (assignment scoped to properties the user can access).
- Inbox Note → Inbox Item (many-to-one).
- Inbox subscribes to `review.created`, `guest.feedback.submitted`, and `review.reply.published` events from other contexts.

## Invariants

- An inbox item is created for every new review and every new feedback submission.
- Bare ratings (no feedback comment) do not create inbox items.
- Status transitions must follow the valid graph (see ADR 0004).
- Only PM+ roles can assign inbox items.
- Assignee must have a `staff_assignment` record for the item's property.
- Each inbox item has exactly one source (review or feedback), never both.
- Feedback inbox items may have a denormalized rating value (from linked `ratings` row), nullable.

## Events produced

|| Tag | Payload | When |
|| ------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------ |
||| `inbox.inbox_item.created` | inboxItemId, organizationId, propertyId, sourceType, sourceId, occurredAt | New review or feedback triggers inbox item |
||| `inbox.inbox_item.status_changed` | inboxItemId, organizationId, propertyId, userId, oldStatus, newStatus, occurredAt | Status transition |
||| `inbox.inbox_item.assigned` | inboxItemId, organizationId, propertyId, userId, assignedTo, occurredAt | Item assigned to user |
||| `inbox.inbox_item.unassigned` | inboxItemId, organizationId, propertyId, userId, previousAssignee, occurredAt | Item unassigned from user |
||| `inbox.inbox_item.escalated` | inboxItemId, organizationId, propertyId, userId, oldStatus, occurredAt | Item escalated alongside status.changed |
||| `inbox.inbox_note.added` | inboxItemId, organizationId, propertyId, userId, noteId, text, occurredAt | Internal note added to item |
||| `inbox.inbox_item.bulk_status_changed` | inboxItemId, organizationId, propertyId, userId, oldStatus, newStatus, bulkId, occurredAt | Item status changed in bulk operation |

Note: `inbox.inbox_item.created` has no `userId` — it's emitted by sync pipeline event handlers, not user actions. Activity log attributes it to `'system'`.

## Events consumed

| Tag                        | Source context | Handler action                            |
| -------------------------- | -------------- | ----------------------------------------- |
| `review.created`           | review         | Create inbox item for new review          |
| `review.updated`           | review         | Update denormalized fields on inbox item  |
| `guest.feedback.submitted` | guest          | Create inbox item for new feedback        |
| `review.reply.published`   | review         | Auto-transition inbox item to `addressed` |

## Lookup ports

Inbox defines cross-context lookup ports (per ADR-0008):

- **ReviewLookupPort** — fetches review snippet (reviewerName, text, reviewerProfilePhotoUrl) by ID.
- **FeedbackLookupPort** — fetches feedback snippet (comment, ratingValue) by ID.
- **PropertyLookupPort** — fetches property name by ID (for denormalization).

All ports are implemented by adapters from their respective contexts, wired at composition time.

## Architecture layers

```
inbox/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts
  application/
    ports/             inbox.repository.ts, inbox-note.repository.ts, review-lookup.port.ts,
                      feedback-lookup.port.ts, property-lookup.port.ts, new-counter.port.ts
    dto/               inbox.dto.ts (Zod schemas)
    use-cases/         get-inbox-items.ts, update-inbox-status.ts, bulk-update-inbox-status.ts,
                      assign-inbox-item.ts, add-inbox-note.ts, get-new-count.ts,
                      get-inbox-item-detail.ts, get-inbox-notes.ts, create-inbox-item.ts,
                      get-folder-counts.ts
    public-api.ts      re-exports domain types, error types, cursor type
  infrastructure/
    adapters/          review-lookup.adapter.ts, feedback-lookup.adapter.ts,
                      property-lookup.adapter.ts, redis-new-counter.ts
    mappers/           inbox.mapper.ts, inbox-note.mapper.ts
    repositories/      inbox.repository.ts, inbox-note.repository.ts (Drizzle)
    event-handlers/    on-review-created.ts, on-review-updated.ts, on-feedback-submitted.ts,
                      on-reply-published.ts
  server/              inbox.ts
  build.ts             composition root
```

## Use cases

| Use case                | Input                                                               | Output                | Permission    |
| ----------------------- | ------------------------------------------------------------------- | --------------------- | ------------- |
| `getInboxItems`         | organizationId, userId, role, filters, cursor?, limit?              | paginated inbox items | `inbox.read`  |
| `getInboxItemDetail`    | inboxItemId, organizationId, userId, role                           | `InboxItemDetail`     | `inbox.read`  |
| `updateInboxStatus`     | inboxItemId, organizationId, newStatus, userId, role                | updated item          | `inbox.write` |
| `bulkUpdateInboxStatus` | inboxItemIds[], organizationId, newStatus, userId, role             | bulk result           | `inbox.write` |
| `assignInboxItem`       | inboxItemId, organizationId, assignedToUserId?, userId, role        | updated item          | `inbox.write` |
| `addInboxNote`          | inboxItemId, organizationId, authorUserId, text, role               | `InboxNote`           | `inbox.write` |
| `getNewCount`           | organizationId                                                      | count                 | `inbox.read`  |
| `getInboxNotes`         | inboxItemId, organizationId, userId, role                           | `InboxNote[]`         | `inbox.read`  |
| `createInboxItem`       | organizationId, propertyId, sourceType, sourceId, rating?, snippet? | `InboxItem`           | internal only |
| `getFolderCounts`       | organizationId, userId, role                                        | `InboxFolderCounts`   | `inbox.read`  |

## Public API

Exported from `application/public-api.ts`:

- Types: `InboxItem`, `InboxNote`, `InboxItemDetail`, `InboxStatus`, `SourceType`
- Error types: `InboxError`, `InboxErrorCode`, `isInboxError`
- Port types: `Cursor`
- Event types: `InboxItemCreated`, `InboxItemStatusChanged`, `InboxItemAssigned`, `InboxItemUnassigned`, `InboxItemEscalated`, `InboxNoteAdded`, `InboxItemBulkStatusChanged`, `InboxEvent`

## Server functions

| Function                  | Method | Permission    | Route                             |
| ------------------------- | ------ | ------------- | --------------------------------- |
| `getInboxItemsFn`         | GET    | `inbox.read`  | Paginated inbox list with filters |
| `updateInboxStatusFn`     | POST   | `inbox.write` | Update single item status         |
| `bulkUpdateInboxStatusFn` | POST   | `inbox.write` | Bulk status update                |
| `assignInboxItemFn`       | POST   | `inbox.write` | Assign/unassign item              |
| `addInboxNoteFn`          | POST   | `inbox.write` | Add internal note                 |
| `getNewCountFn`           | GET    | `inbox.read`  | New badge count                   |
| `getInboxItemDetailFn`    | GET    | `inbox.read`  | Item detail with source data      |
| `getInboxNotesFn`         | GET    | `inbox.read`  | Notes for an item                 |

## Permissions

| Permission     | AccountAdmin | PropertyManager | Staff |
| -------------- | ------------ | --------------- | ----- |
| `inbox.read`   | ✓            | ✓               | ✓     |
| `inbox.write`  | ✓            | ✓               | ✓     |
| `inbox.manage` | ✓            | ✓               | —     |

## Intentional deviations

- Domain rules (domain/rules.ts) use hasRole() directly for role-based business logic — this is intentional per ADR-0001.

## Flagged ambiguities

- Whether bulk actions are atomic (all-or-nothing) or best-effort. Implementation decision.
- Feedback category — deferred to Arc 7. No column until AI categorization is built.

## Resolved decisions

- **Auto-transition on reply published**: Inbox items auto-transition to `addressed` when a reply is published (via `review.reply.published` event handler). Managers can still manually mark items as addressed.
- **Auto-transition `new→read` on open**: When a user opens an inbox item detail, the item auto-transitions from `new` to `read` after a 500ms debounce. This makes `new` an ephemeral pulse state. `autoMarkRead: true` in `useInboxDetail`.
- **Unaddressed tab**: The secondary list tab filters to `status IN ('new', 'read')` — everything needing attention. Replaces the previous "Unread" tab which filtered only `status = 'new'`.
- **Action buttons**: Detail panel shows Escalate + Archive universally. "Mark as Addressed" only appears for feedback items (reviews auto-transition via `review.reply.published`). Bulk actions: Escalate + Mark Addressed (feedback-only, silently skips reviews) + Archive. "Mark Read" removed everywhere — auto `new→read` on open makes it redundant.
- **Transition graph update**: Added `new → addressed` and `read → archived` to the transition graph. Full graph: `new→{read, addressed, archived, escalated}`, `read→{addressed, escalated, archived}`, `escalated→{addressed, archived}`, `addressed→{archived, escalated}`, `archived→{escalated}`.
- **"Unread" → "New" rename**: Glossary term, use case, server function, port, adapter all renamed: `getUnreadCount` → `getNewCount`, `UnreadCounterPort` → `NewCounterPort`, `redis-unread-counter` → `redis-new-counter`, `getUnreadCountFn` → `getNewCountFn`. Execute during implementation.
- **Status filter supports arrays**: `InboxFilters.status` changed from `InboxStatus` to `InboxStatus | InboxStatus[]`. Enables "Unaddressed" tab (`['new', 'read']`) and future multi-status filters. Repository handles array → SQL `IN (...)`.
- **Sidebar "Inbox" folder badge**: Shows unaddressed count (`new + read`), not just `new`. Renamed `InboxFolderCounts.unread` → `InboxFolderCounts.unaddressed`. The ephemeral "New" badge lives on the top-level nav icon, not the sidebar folder.
- **DTO updates**: `getInboxItemsDto.status` accepts `InboxStatus | InboxStatus[]` (Zod union). `bulkUpdateStatusDto.status` narrowed to `['addressed', 'archived', 'escalated']` — `'read'` removed (no bulk mark-read). `updateStatusDto.status` stays as-is (single target status, source-type constraints enforced by UI).
- **Timestamp display**: `readAt` timestamp relabelled from "Read" to "Opened" in the detail panel. Auto-transition makes "Read" misleading — "Opened" is honest about what happened. The domain field stays `readAt`; only the display label changes. Status badge for `read` also changes from "Read" to "Opened".
- **List row styling**: `new` items render bold with a subtle dot indicator. `read` items render normal weight — no badge. `escalated`, `addressed`, `archived` items get their colored status badges. Gmail pattern.
- **Bulk "Mark Addressed" review guard**: Defense-in-depth. Use case skips reviews in the per-item validation loop (`sourceType === 'review' && newStatus === 'addressed'` → skip). UI filters selected IDs to only feedback items before calling bulk action.
- **Activity timeline**: Inbox detail panel will render an activity timeline using the ReUI timeline component, showing status changes, notes, replies, and assignments in chronological order. Data sourced from the `activity` context's activity log (per Q11 decisions).
- **Activity event delivery (Q12)**: In-process via `eventBus.on()`. Matching the metric context's subscriber pattern. Handlers are idempotent (`findDuplicate` check before insert) and errors are logged, not propagated. If durability becomes a requirement (audit entries must survive process crashes), migrate to BullMQ-backed delivery per the original Q12 intent — the `CONTEXT.md` in `src/contexts/activity/` documents this trade-off explicitly.
- **Activity log schema (Q13)**: Polymorphic table `activity_log` with columns: `id` (UUID PK), `actor_id` (FK auth_user), `actor_role` (denormalized, role at time of action), `action` (verb from fixed vocabulary), `resource_type` + `resource_id` (polymorphic target, no typed FK), `property_id` (nullable, account-level events have no property), `account_id` (FK), `payload` (JSONB, uniform `{field, from, to}` grammar), `source` ('web'|'api'|'system'|'import'), `created_at`. Immutable — no `updated_at`. Indexes: `(resource_type, resource_id, created_at)`, `(account_id, property_id, created_at)`, `(actor_id, created_at)`.
- **Activity event mapping (Q14)**: One activity entry per event per item. Events that produce entries: `inbox.inbox_item.created`, `inbox.inbox_item.status_changed`, `inbox.inbox_item.escalated`, `inbox.inbox_item.assigned`, `inbox.inbox_item.unassigned`, `inbox.inbox_note.added`, `inbox.inbox_item.bulk_status_changed`, `review.reply.published`, `review.reply.submitted`, `review.reply.approved`, `review.reply.rejected`. Excluded: `cache.invalidated`, `item.read` (auto, not user-initiated). Bulk operations produce one entry per affected item with `payload.bulkId` linking them — audit-complete per item, groupable for org-wide feed.
- **Activity context location (Q15)**: New top-level context `src/contexts/activity/`. Own directory, composition, public API, event handlers, queries, permission filtering. Not shared infrastructure — it's a bounded context with its own schema and business rules.
- **Activity context structure (Q16)**: `domain/` (activity-log entity, constructors), `ports/` (repository interface, user lookup), `infrastructure/` (drizzle repo, event handlers, identity adapter), `queries/` (timeline + org-wide feed with permission filtering), `application/public-api.ts` (queries only — no commands). No use cases — write-only via event subscription, read-only via queries. Composition wires `eventBus.on()` handlers.
