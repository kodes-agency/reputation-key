# ADR 0004 — Inbox as a Separate Bounded Context

**Status:** Proposed
**Date:** 2026-05-18
**Context:** Reviews, Feedback, Unified Inbox

## Decision

Introduce a new `inbox` bounded context that provides a unified triage surface for reviews and private feedback. Inbox owns its own status workflow, assignment model, internal notes, and events. It is not a mere read-model — it has write-side domain logic.

## Context

Phase 11 requires a unified inbox where managers see all reviews and all private feedback in a single list. The inbox has its own domain concerns that don't belong to either the `review` or `guest` contexts:

- A status workflow (`new → read → addressed → archived`, with `escalated` sidetrack) with transition validation rules
- Assignment of items to team members (PM+ only, property-scoped)
- Internal notes with authorship tracking
- Bulk actions (mark read, mark addressed, assign)
- An unread count badge (Redis-cached, invalidated on status events)

Phase 12 extends the inbox with reply drafting UI, but the reply domain logic (draft/approve/reject/publish) stays in the `review` context — the inbox just surfaces it.

## Alternatives Considered

### A. Thin read-model (no new context)

Server functions query across `reviews` and `feedback` tables directly. Status tracked via a new `inbox_items` table in shared schema. No context boundary.

- **Pros:** Fewer files, simpler wiring. Inbox is "just queries."
- **Cons:** Inbox has real write-side logic (status transitions, assignment, bulk actions, notes). A read-model can't enforce domain rules. Phase 12's reply UI integration would scatter inbox logic across server functions with no clear home. No events for the unread badge or Phase 19 notifications.

### B. Extend `review` context

Add feedback-reading and inbox logic to the existing `review` context.

- **Pros:** One fewer context to wire.
- **Cons:** Pollutes the review context with guest-domain concerns (feedback has no platform, no replies to Google, different detail view). Violates single responsibility. The inbox is about triage across sources — it's not a review concept.

### C. Inbox as a separate bounded context (chosen)

New `inbox` context owns: unified item projection, status workflow, assignment, notes, filtering, pagination, events. Subscribes to `review.created` and `feedback.submitted` events to create inbox items.

- **Pros:** Clean domain boundary. Inbox owns its rules. Events enable unread badge and Phase 19 notifications. Phase 12 reply UI lives here without contaminating review domain. Guest context stays write-only.
- **Cons:** More wiring in `composition.ts`. Cross-context event handlers needed.

## Key Architectural Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | `inbox_items` table with hybrid denormalization | Filter/sort columns (rating, sourceDate, sourceType, platform, propertyId) denormalized for indexed queries. Full detail (text, reviewer name, photos) fetched via JOIN on detail view. |
| 2 | Status workflow: `new → read → addressed → archived` with `escalated` sidetrack | "addressed" is semantically honest for both reviews (replied to) and feedback (internally handled). Un-archive goes to `read`. Any state can escalate or archive. |
| 3 | `inbox_notes` table (not a single text field) | Notes are audit-relevant. Multiple notes per item. Tracks who wrote what and when. |
| 4 | Feedback items include joined rating value | Feedback inbox item denormalizes the linked rating (1-5) from the `ratings` table at creation time. Bare ratings without feedback comments do not create inbox items. |
| 5 | Assignment: PM+ only, property-scoped | Staff cannot reassign. Assignee must have access to the item's property via `staff_assignments`. |
| 6 | Forward-only cursor pagination on `(sourceDate DESC, id)` | Stable composite cursor across two source types. No backward pagination — inbox loads newest first. |
| 7 | Inbox emits events: `inbox.item.created`, `inbox.status.changed`, `inbox.item.assigned` | Enables Redis unread badge invalidation. Enables Phase 19 notification subscriptions. Follows existing architecture pattern. |
| 8 | No feedback category column in Phase 11 | Category is an Arc 7 (AI) feature. Add the nullable column when AI categorization is built. |
| 9 | Creation triggers: `review.created`, `feedback.submitted` | Event handlers in `inbox/infrastructure/event-handlers/` create `inbox_items` rows. Denormalize filter/sort columns at creation time. |
| 10 | Email split UI layout with chat-like thread in detail panel | List panel for triage speed and bulk actions. Detail panel shows item content + notes/replies in a vertical thread (newest at bottom, input at bottom). Existing `Sidebar` component reused. |

## Consequences

### Positive

- Inbox has a clear, single reason to change
- Status workflow, assignment, and notes have a natural home with domain rules
- Events enable reactive features (unread badge, future notifications) without polling
- Review context stays focused on sync and reply lifecycle
- Guest context stays write-only
- Phase 12 reply UI integrates cleanly — inbox surfaces the reply, review owns the logic

### Negative

- More wiring in `composition.ts` (event subscriptions, repo creation)
- Denormalized columns in `inbox_items` must be synced on `review.updated` events
- Cross-context read for detail view (JOIN to `reviews` or `feedback` table)

### Risks

- Denormalization drift: if source data changes frequently, inbox items may show stale filter/sort values until re-synced. Mitigated by syncing on `review.updated` events.
- The `inbox_notes` table could grow large if managers add many notes. Mitigated by pagination on the detail view's note thread.
