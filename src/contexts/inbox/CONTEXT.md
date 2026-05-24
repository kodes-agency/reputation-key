# Inbox Context

Unified triage surface for reviews and feedback — status tracking, assignment, notes, and unread counts.

## Glossary

| Term              | Definition                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inbox Item**    | A unified triage entry. Points to either a Review or a Feedback. Carries denormalized filter/sort fields and inbox-specific state (status, assignment).                   |
| **Source Type**   | The origin of an inbox item: `'review'` or `'feedback'`.                                                                                                                  |
| **Source ID**     | The primary key of the source entity (a `ReviewId` or `FeedbackId`).                                                                                                      |
| **Status**        | The triage state of an inbox item: `new`, `read`, `addressed`, `escalated`, `archived`.                                                                                   |
| **Addressed**     | The item has been handled. For reviews: a reply has been published or manager manually marked it. For feedback: manager has handled it (added a note or marked manually). |
| **Escalated**     | The item has been flagged for management attention. Can be escalated from any status.                                                                                     |
| **Assignment**    | Linking an inbox item to a specific team member. PM+ only. Assignee must have access to the item's property.                                                              |
| **Internal Note** | A text annotation on an inbox item. Stored in `inbox_notes`. Tracks author and timestamp. Multiple notes per item.                                                        |
| **Source Date**   | The denormalized date from the source entity (`reviewedAt` for reviews, `createdAt` for feedback). Used for sorting.                                                      |
| **Unread Badge**  | Count of inbox items with `status = 'new'` for the current user's accessible properties. Redis-cached, invalidated on status events.                                      |

## Relationships

- Inbox Item → Review (via `sourceType = 'review'`, `sourceId = reviewId`). Detail fetched by JOIN.
- Inbox Item → Feedback (via `sourceType = 'feedback'`, `sourceId = feedbackId`). Rating value denormalized at creation time from linked `Rating`.
- Inbox Item → StaffAssignment (assignment scoped to properties the user can access).
- Inbox Note → Inbox Item (many-to-one).
- Inbox subscribes to `review.created`, `feedback.submitted`, and `reply.published` events from other contexts.

## Invariants

- An inbox item is created for every new review and every new feedback submission.
- Bare ratings (no feedback comment) do not create inbox items.
- Status transitions must follow the valid graph (see ADR 0004).
- Only PM+ roles can assign inbox items.
- Assignee must have a `staff_assignment` record for the item's property.
- Each inbox item has exactly one source (review or feedback), never both.
- Feedback inbox items may have a denormalized rating value (from linked `ratings` row), nullable.

## Events produced

| Tag                    | Payload                                                          | When                                       |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| `inbox.item.created`   | inboxItemId, orgId, propertyId, sourceType, sourceId, occurredAt | New review or feedback triggers inbox item |
| `inbox.status.changed` | inboxItemId, orgId, oldStatus, newStatus, occurredAt             | Status transition                          |
| `inbox.item.assigned`  | inboxItemId, orgId, assignedTo, occurredAt                       | Item assigned to user                      |

## Events consumed

| Tag                  | Source context | Handler action                            |
| -------------------- | -------------- | ----------------------------------------- |
| `review.created`     | review         | Create inbox item for new review          |
| `review.updated`     | review         | Update denormalized fields on inbox item  |
| `feedback.submitted` | guest          | Create inbox item for new feedback        |
| `reply.published`    | review         | Auto-transition inbox item to `addressed` |

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
                      feedback-lookup.port.ts, property-lookup.port.ts, unread-counter.port.ts
    dto/               inbox.dto.ts (Zod schemas)
    use-cases/         get-inbox-items.ts, update-inbox-status.ts, bulk-update-inbox-status.ts,
                      assign-inbox-item.ts, add-inbox-note.ts, get-unread-count.ts,
                      get-inbox-item-detail.ts, get-inbox-notes.ts, create-inbox-item.ts
    public-api.ts      re-exports domain types, error types, cursor type
  infrastructure/
    adapters/          review-lookup.adapter.ts, feedback-lookup.adapter.ts,
                      property-lookup.adapter.ts, redis-unread-counter.ts
    mappers/           inbox.mapper.ts, inbox-note.mapper.ts
    repositories/      inbox.repository.ts, inbox-note.repository.ts (Drizzle)
    event-handlers/    on-review-created.ts, on-review-updated.ts, on-feedback-submitted.ts,
                      on-reply-published.ts
  server/              inbox.ts
  build.ts             composition root
```

## Use cases

| Use case                | Input                                                      | Output                | Permission    |
| ----------------------- | ---------------------------------------------------------- | --------------------- | ------------- |
| `getInboxItems`         | orgId, userId, role, filters, cursor?, limit?              | paginated inbox items | `inbox.read`  |
| `getInboxItemDetail`    | inboxItemId, orgId, userId, role                           | `InboxItemDetail`     | `inbox.read`  |
| `updateInboxStatus`     | inboxItemId, orgId, newStatus, userId, role                | updated item          | `inbox.write` |
| `bulkUpdateInboxStatus` | inboxItemIds[], orgId, newStatus, userId, role             | bulk result           | `inbox.write` |
| `assignInboxItem`       | inboxItemId, orgId, assignedToUserId?, userId, role        | updated item          | `inbox.write` |
| `addInboxNote`          | inboxItemId, orgId, authorUserId, text, role               | `InboxNote`           | `inbox.write` |
| `getUnreadCount`        | orgId                                                      | count                 | `inbox.read`  |
| `getInboxNotes`         | inboxItemId, orgId, userId, role                           | `InboxNote[]`         | `inbox.read`  |
| `createInboxItem`       | orgId, propertyId, sourceType, sourceId, rating?, snippet? | `InboxItem`           | internal only |

## Public API

Exported from `application/public-api.ts`:

- Types: `InboxItem`, `InboxNote`, `InboxItemDetail`, `InboxStatus`, `SourceType`
- Error types: `InboxError`, `InboxErrorCode`
- Port types: `Cursor`

## Server functions

| Function                  | Method | Permission    | Route                             |
| ------------------------- | ------ | ------------- | --------------------------------- |
| `getInboxItemsFn`         | GET    | `inbox.read`  | Paginated inbox list with filters |
| `updateInboxStatusFn`     | POST   | `inbox.write` | Update single item status         |
| `bulkUpdateInboxStatusFn` | POST   | `inbox.write` | Bulk status update                |
| `assignInboxItemFn`       | POST   | `inbox.write` | Assign/unassign item              |
| `addInboxNoteFn`          | POST   | `inbox.write` | Add internal note                 |
| `getUnreadCountFn`        | GET    | `inbox.read`  | Unread badge count                |
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

- **Auto-transition on reply published**: Inbox items auto-transition to `addressed` when a reply is published (via `reply.published` event handler). Managers can still manually mark items as addressed.
