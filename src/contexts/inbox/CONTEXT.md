# Inbox Context

## Language

| Term              | Definition                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Inbox Item**    | A unified triage entry. Points to either a Review or a Feedback. Carries denormalized filter/sort fields and inbox-specific state (status, assignment). |
| **Source Type**   | The origin of an inbox item: `'review'` or `'feedback'`.                                                              |
| **Source ID**     | The primary key of the source entity (a `ReviewId` or `FeedbackId`).                                                  |
| **Status**        | The triage state of an inbox item: `new`, `read`, `addressed`, `escalated`, `archived`.                               |
| **Addressed**     | The item has been handled. For reviews: a reply has been published or manager manually marked it. For feedback: manager has handled it (added a note or marked manually). |
| **Escalated**     | The item has been flagged for management attention. Can be escalated from any status.                                 |
| **Assignment**    | Linking an inbox item to a specific team member. PM+ only. Assignee must have access to the item's property.          |
| **Internal Note** | A text annotation on an inbox item. Stored in `inbox_notes`. Tracks author and timestamp. Multiple notes per item.    |
| **Source Date**   | The denormalized date from the source entity (`reviewedAt` for reviews, `createdAt` for feedback). Used for sorting.  |
| **Unread Badge**  | Count of inbox items with `status = 'new'` for the current user's accessible properties. Redis-cached, invalidated on status events. |

## Relationships

- Inbox Item → Review (via `sourceType = 'review'`, `sourceId = reviewId`). Detail fetched by JOIN.
- Inbox Item → Feedback (via `sourceType = 'feedback'`, `sourceId = feedbackId`). Rating value denormalized at creation time from linked `Rating`.
- Inbox Item → StaffAssignment (assignment scoped to properties the user can access).
- Inbox Note → Inbox Item (many-to-one).
- Inbox subscribes to `review.created` and `feedback.submitted` events from other contexts.

## Invariants

- An inbox item is created for every new review and every new feedback submission.
- Bare ratings (no feedback comment) do not create inbox items.
- Status transitions must follow the valid graph (see ADR 0004).
- Only PM+ roles can assign inbox items.
- Assignee must have a `staff_assignment` record for the item's property.
- Each inbox item has exactly one source (review or feedback), never both.
- Feedback inbox items may have a denormalized rating value (from linked `ratings` row), nullable.

## Flagged ambiguities

- Whether "addressed" auto-transitions when a reply is published (Phase 12 will decide). Currently manual.
- Whether bulk actions are atomic (all-or-nothing) or best-effort. Implementation decision.
- Feedback category — deferred to Arc 7. No column until AI categorization is built.
