# Inbox Context

## Bounded context

Unified triage surface for reviews and feedback — status tracking, assignment, notes, and new-item counts.

## Glossary

| Term               | Definition                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inbox Item**     | A unified triage entry. Points to either a Review or a Feedback. Carries denormalized filter/sort fields and inbox-specific state (status, assignment).                                             |
| **Source Type**    | The origin of an inbox item: `'review'` or `'feedback'`.                                                                                                                                            |
| **Source ID**      | The primary key of the source entity (a `ReviewId` or `FeedbackId`).                                                                                                                                |
| **Status**         | The triage state of an inbox item: `open` or `closed`.                                                                                                                                              |
| **Closed**         | The item has been handled. For Review work, only an exact current live Google reply observation may close the active Handling Cycle automatically; authorized users can also close or reopen items. |
| **Escalated**      | An orthogonal flag for management attention. An open or closed item can be escalated until the flag is resolved.                                                                                    |
| **Assignment**     | Linking an inbox item to a specific eligible user. An eligible user may explicitly claim or release their own work; managing another assignee additionally requires `inbox.manage`.                 |
| **Internal Note**  | A text annotation on an inbox item. Stored in `inbox_notes`. Tracks author and timestamp. Multiple notes per item.                                                                                  |
| **Source Date**    | The denormalized date from the source entity (`reviewedAt` for reviews, `createdAt` for feedback). Used for sorting.                                                                                |
| **Filtered Total** | Authoritative count of all items matching the governed list filters, calculated before the page cursor and returned with every page.                                                                |
| **List Sort**      | Stable keyset ordering by `(sourceDate, id)`, newest-first by default with an oldest-first option.                                                                                                  |
| **Handling Cycle** | An immutable, numbered opening fact for one Review work episode, anchored to one Material Review Revision. More than one cycle may reference the same revision.                                     |
| **Cycle Head**     | The compare-and-swap pointer to the one current Review cycle, its current Material Review Revision, workflow status, and state revision.                                                            |

## Relationships

- Inbox Item → Review (via `sourceType = 'review'`, `sourceId = reviewId`). Eligible content is read through `ReviewLookupPort`, never cross-context SQL.
- Inbox Item → Feedback (via `sourceType = 'feedback'`, `sourceId = feedbackId`). Rating value denormalized at creation time from linked `Rating`.
- Inbox Item → StaffAssignment (assignment scoped to properties the user can access).
- Review Inbox Item → Handling Cycle (one-to-many immutable openings) → Material Review Revision; one Cycle Head selects the current actionable episode.
- Inbox Note → Inbox Item (many-to-one).
- Inbox subscribes to Review/Guest lifecycle facts. `review.reply.observed` is the sole provider-reply authority; `review.reply.published` is retained only as a compatibility receipt.

## Invariants

- An inbox item is created for every new review and every new feedback submission.
- Bare ratings (no feedback comment) do not create inbox items.
- Status transitions must follow the valid graph (see ADR 0004).
- Claiming or releasing one's own eligible item requires source handling access. Assigning, releasing, or replacing another assignee additionally requires `inbox.manage`.
- Assignee must have a `staff_assignment` record for the item's property.
- Review visibility requires `inbox.read ∧ review.read`; private-feedback visibility requires `inbox.read ∧ feedback.read`.
- Review workflow changes require `inbox.write ∧ review.read`; private-feedback workflow changes require `inbox.write ∧ feedback.handle`. Assignment never grants either permission.
- Each inbox item has exactly one source (review or feedback), never both.
- Feedback inbox items may have a denormalized rating value (from linked `ratings` row), nullable.
- List cursors are bounded canonical base64 JSON. Their `sourceDate` must be a canonical ISO instant and `id` a UUID; malformed cursors are discarded before repository/SQL access and never echoed into logs.
- A Review cycle opening is append-only at the database boundary. Starting a later cycle advances the head only when expected cycle number, Material Review Revision, and state revision all match.
- `material_revision_changed` must advance to the Review's current Material Review Revision. `manual_reopen` may create another numbered cycle on the same revision. Both preserve every earlier opening fact.
- Automatic Review closure requires a `review.reply.observed` fact whose identifiers still name the exact current Review-owned live observation head and current source epoch and Material Review Revision. A `confirmed_on_google` observation additionally binds the exact current Reply publication attempt and cycle; an `external_current_live` observation closes as current external truth without claiming RepKey provenance. The event is only a wake-up hint: Inbox receives a content-free permit through its own `ReplyObservationAuthorityPort`, never queries Review tables, and treats a refused permit as obsolete.
- Review holds its observation-write fence from exact-head validation until the Inbox callback commits. Within that interval, Inbox commits receipt reservation, status/cycle changes, and the emitted Inbox fact in one transaction. This explicit two-transaction fence is necessary because each context owns its writes; it prevents a newer Review head from landing in the validation-to-Inbox-commit interval, while the Inbox receipt makes an outer read-only commit failure replay-safe.
- A current `review.reply.observed` fact that overtakes `review.created` remains retryable: Inbox records no receipt until the item and Handling Cycle materialize. If the observation's Material Review Revision is ahead of Inbox, delivery likewise retries without a receipt; if Inbox is already newer, the observation receives an obsolete receipt. A fact whose Review head is already obsolete also receives an obsolete receipt even when no Inbox item exists.
- A current observed Google reply deletion reopens the active Review work when the Handling Cycle's material/cycle fences still permit it. An external live edit remains handled and does not reopen work. The retained legacy `diverged` value is receipt-only and never a reopen authority. A stale/replayed fact cannot close or reopen twice.
- Provider write acknowledgement and the internal `review.reply.published` lifecycle fact are not Google truth and cannot mutate Inbox status.
- Expand phase is intentionally non-destructive: `inbox_items.status` remains the compatibility projection. Existing status/assignment/escalation commands have not yet cut over to the cycle head and are not claimed as fully revision-fenced.

## Events produced

| Tag                                    | Payload                                                                                   | When                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| `inbox.inbox_item.created`             | inboxItemId, organizationId, propertyId, sourceType, sourceId, occurredAt                 | New review or feedback triggers inbox item |
| `inbox.inbox_item.status_changed`      | inboxItemId, organizationId, propertyId, userId, oldStatus, newStatus, occurredAt         | Status transition                          |
| `inbox.inbox_item.assigned`            | inboxItemId, organizationId, propertyId, userId, assignedTo, occurredAt                   | Item assigned to user                      |
| `inbox.inbox_item.unassigned`          | inboxItemId, organizationId, propertyId, userId, previousAssignee, occurredAt             | Item unassigned from user                  |
| `inbox.inbox_item.escalated`           | inboxItemId, organizationId, propertyId, userId, occurredAt                               | Escalation flag set                        |
| `inbox.inbox_item.escalation_resolved` | inboxItemId, organizationId, propertyId, userId, occurredAt                               | Escalation flag resolved                   |
| `inbox.inbox_note.added`               | inboxItemId, organizationId, propertyId, userId, noteId, occurredAt                       | Internal note added to item                |
| `inbox.inbox_item.bulk_status_changed` | inboxItemId, organizationId, propertyId, userId, oldStatus, newStatus, bulkId, occurredAt | Item status changed in bulk operation      |

Note: `inbox.inbox_item.created` has no `userId` — it's emitted by sync pipeline event handlers, not user actions. Activity log attributes it to `'system'`.

Note (BQC-3.4): `inbox.inbox_note.added` carries the note ID, never the note text — notes remain context-owned content. Every fact above is committed atomically with its state change via the `InboxCommandStore` (one PostgreSQL transaction: state + outbox row; post-commit bus emit is best-effort). The projection repair command is `rebuildInboxProjection` (bounded, idempotent, report-first; review-sourced items only — guest/feedback is a dark context).

## Events consumed

| Tag                        | Source context | Handler action                                                                                                                                                               |
| -------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review.created`           | review         | Create metadata-only inbox item (bus + durable `inbox.on-review-created`, applyOnce co-commits receipt)                                                                      |
| `review.updated`           | review         | Metadata-only refresh of sourceDate/platform (durable `inbox.on-review-updated`, BQC-3.4)                                                                                    |
| `guest.feedback.submitted` | guest          | Create metadata-only feedback item (bus + durable `inbox.on-guest-feedback-submitted`)                                                                                       |
| `guest.feedback.retracted` | guest          | Close open feedback work after Guest purges the body (bus + durable `inbox.on-guest-feedback-retracted`)                                                                     |
| `review.reply.published`   | review         | Compatibility receipt only; never closes or reopens work (durable `inbox.on-reply-published`)                                                                                |
| `review.reply.observed`    | review         | Request an exact-current Review permit; an exact live reply closes once, a deletion reopens once, and an external live edit stays closed (durable `inbox.on-reply-observed`) |
| `review.reply.submitted`   | review         | Stamp `firstReplySubmittedAt` milestone on inbox item (bus only)                                                                                                             |
| `review.expired`           | review         | Close open inbox item when its source review is purged (bus + durable `inbox.on-review-expired`)                                                                             |

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
                      property-lookup.adapter.ts, reply-lookup.adapter.ts,
                      review-source-lookup.adapter.ts
    mappers/           inbox.mapper.ts, inbox-note.mapper.ts
    repositories/      inbox.repository.ts, inbox-note.repository.ts (Drizzle)
    inbox-command-store.ts            atomic state+outbox+receipt commands (BQC-3.4)
    review-handling-cycle.store.ts    immutable cycle append + locked/CAS current head
    outbox-consumers.ts  durable consumers (applyOnce): review.created/.updated/.expired,
                      reply.published compatibility receipt, reply.observed authority
    event-handlers/    on-review-created.ts, on-review-expired.ts, on-feedback-submitted.ts,
                      on-reply-submitted.ts (bus paths); on-reply-published.ts is quarantined
    (test fake: src/shared/testing/sequential-inbox-command-store.ts)
  server/              inbox.ts, inbox-item-queries.ts, inbox-status.ts, inbox-item-actions.ts,
                      inbox-queries.ts, inbox-shared.ts
  build.ts             composition root
  build-use-cases.ts   use-case factory

## Use cases

| Use case                | Input                                                               | Output                | Permission    |
| ----------------------- | ------------------------------------------------------------------- | --------------------- | ------------- |
| `getInboxItems`         | organizationId, userId, role, filters (including sort), cursor?, limit? | items, next cursor, filtered total | `inbox.read` plus source read |
| `getInboxItemDetail`    | inboxItemId, organizationId, userId, role                           | `InboxItemDetail`     | `inbox.read` plus source read |
| `updateInboxStatus`     | inboxItemId, organizationId, newStatus, userId, role                | updated item          | `inbox.write` plus source handle |
| `bulkUpdateInboxStatus` | inboxItemIds[], organizationId, newStatus, userId, role             | bulk result           | `inbox.write` plus per-item source handle |
| `assignInboxItem`       | inboxItemId, organizationId, assignedToUserId?, userId, role        | updated item          | source handle; `inbox.manage` for another assignee |
| `addInboxNote`          | inboxItemId, organizationId, authorUserId, text, role               | `InboxNote`           | `inbox.write` plus source handle |
| `getInboxNotes`         | inboxItemId, organizationId, userId, role                           | notes                 | `inbox.read` plus source read |
| `getLastVisitCount`     | organizationId, userId                                              | open-since-last-visit count | `inbox.read` plus per-source read scope |
| `createInboxItem`       | organizationId, propertyId, sourceType, sourceId, rating?, sourceDate, platform?, snippet? | `InboxItem`           | internal only |
| `getFolderCounts`       | organizationId, userId, role                                        | `InboxFolderCounts`   | `inbox.read` plus per-source read scope |
| `escalateInboxItem`     | inboxItemId, organizationId, userId                                 | updated item          | `inbox.write` plus source handle |
| `resolveEscalation`     | inboxItemId, organizationId, userId                                 | updated item          | `inbox.write` plus source handle |
| `rebuildInboxProjection` | organizationId, propertyId?, dryRun, batchSize?                    | repair report         | internal repair command (BQC-3.4; operator surface is BQC-7) |
| `startReviewHandlingCycle` | inboxItemId, Organization, expected cycle/material/state revisions, target Material Review Revision, reason | cycle + current head | internal workflow command; caller owns authorization |

## Public API

Exported from `application/public-api.ts`:

- Types: `InboxItem`, `InboxNote`, `InboxItemDetail`, `InboxStatus`, `SourceType`, `InboxSort`
- Error types: `InboxError`, `InboxErrorCode`, `isInboxError`
- Port types: `Cursor` and paginated results with `totalCount`
- Constants: `INBOX_BULK_LIMIT` (100 item IDs per bulk status command)
- Event types: `InboxItemCreated`, `InboxItemStatusChanged`, `InboxItemAssigned`, `InboxItemUnassigned`, `InboxItemEscalated`, `InboxNoteAdded`, `InboxItemBulkStatusChanged`, `InboxEvent`

## Server functions

| Function                  | Method | Permission    | Route                             |
| ------------------------- | ------ | ------------- | --------------------------------- |
| `getInboxItemsFn`         | GET    | `inbox.read`  | Paginated inbox list with filters |
| `updateInboxStatusFn`     | POST   | `inbox.write` | Update single item status         |
| `bulkUpdateInboxStatusFn` | POST   | `inbox.write` | Bulk reopen only; Bulk Close is unavailable in initial beta |
| `assignInboxItemFn`       | POST   | `inbox.write` | Assign/unassign item              |
| `addInboxNoteFn`          | POST   | `inbox.write` | Add internal note                 |
| `getLastVisitCountFn`     | GET    | `inbox.read` plus source read | Open items since the caller's previous visit |
| `getInboxNotesFn`         | GET    | `inbox.read` plus source read | Notes for an item                 |
| `getInboxFolderCountsFn`  | GET    | `inbox.read` plus source read | Open, escalated, and closed counts |

## Permissions

| Permission     | AccountAdmin | PropertyManager | Staff |
| -------------- | ------------ | --------------- | ----- |
| `inbox.read`   | ✓            | ✓               | ✓     |
| `inbox.write`  | ✓            | ✓               | ✓     |
| `inbox.manage` | ✓            | ✓               | —     |
| `feedback.read` | ✓           | ✓               | —     |
| `feedback.handle` | ✓         | ✓               | —     |

## Lookup ports

Inbox defines cross-context lookup ports (per ADR-0008):

- **ReviewLookupPort** — fetches eligible review snippets (reviewerName, text, translatedText, reviewerProfilePhotoUrl, rating, languageCode) by ID or bounded ID batch. `text` is the guest's original words; `translatedText` is the provider's machine translation (Google only, null elsewhere).
- **FeedbackLookupPort** — fetches feedback snippet (comment, ratingValue) by ID.
- **PropertyLookupPort** — fetches property name by ID (for denormalization).
- **AiReviewInsightsPort** — reads the current AI analysis for a review, and resolves which reviews currently carry a given `attention` level or `primaryCategory`. Implemented by the AI context and wired at composition time.

All ports are implemented by adapters from their respective contexts, wired at composition time.

### AI-derived list filters

`attention` and `category` are the two AI-derived filters on the item list. Neither is a column on `inbox_items`: both resolve to a set of review ids through `AiReviewInsightsPort` and then narrow the item query by `sourceId`. Consequences worth knowing before touching them:

- The AI context's query carries the whole capability gate — the merchant authorization must be enabled and still hold `review_analysis`, and the analysis must agree with the authorization's lineage and epochs — so a tenant without the capability gets an empty set, not an unfiltered list.
- An empty id set means **no matches**, never **no filter**. The same holds when the port is absent entirely.
- Supplying both filters intersects them: each pushes its own `sourceId IN (…)` predicate into the same `and(…)`.
- `attention` is the AI urgency level (`urgent`/`high`/`medium`/`low`); `category` is the primary topic. They are different dimensions, so a link that means "show me the service complaints" must use `category`, not `attention`.
- List rows make one additional page-bounded current-analysis lookup for `urgent`. A row displays the Urgent badge only when that governed lookup confirms it; escalation state is never used as an urgency proxy.
- Both search params must be declared in `inboxSearchSchema`. It is a `z.object`, which strips unknown keys, so an undeclared param arrives as `undefined` and silently filters nothing.


- **Timestamp display**: `readAt` timestamp relabelled from "Read" to "Opened" in the detail panel. Auto-transition makes "Read" misleading — "Opened" is honest about what happened. The domain field stays `readAt`; only the display label changes. Status badge for `read` also changes from "Read" to "Opened".
- **List row styling**: the active item has the accent tint/rail and `aria-current`; checkbox selection is independent. Rows lead with reviewer, property/platform/language metadata, compact rating/date, and a two-line snippet (or `Rating only`).
- **Bulk status actions**: the contextual toolbar supports close/reopen and caps selection at `INBOX_BULK_LIMIT`; unchecked rows are disabled with an accessible limit explanation once the cap is reached.
- **Activity timeline**: Inbox detail panel will render an activity timeline using the ReUI timeline component, showing status changes, notes, replies, and assignments in chronological order. Data sourced from the `activity` context's activity log (per Q11 decisions).
- **Activity event delivery (Q12)**: In-process via `eventBus.on()`. Matching the metric context's subscriber pattern. Handlers are idempotent (`findDuplicate` check before insert) and errors are logged, not propagated. If durability becomes a requirement (audit entries must survive process crashes), migrate to BullMQ-backed delivery per the original Q12 intent — the `CONTEXT.md` in `src/contexts/activity/` documents this trade-off explicitly.
- **Activity log schema (Q13)**: Polymorphic table `activity_log` with columns: `id` (UUID PK), `actor_id` (FK auth_user), `actor_role` (denormalized, role at time of action), `action` (verb from fixed vocabulary), `resource_type` + `resource_id` (polymorphic target, no typed FK), `property_id` (nullable, account-level events have no property), `account_id` (FK), `payload` (JSONB, uniform `{field, from, to}` grammar), `source` ('web'|'api'|'system'|'import'), `created_at`. Immutable — no `updated_at`. Indexes: `(resource_type, resource_id, created_at)`, `(account_id, property_id, created_at)`, `(actor_id, created_at)`.
- **Activity event mapping (Q14)**: One activity entry per event per item. Events that produce entries: `inbox.inbox_item.created`, `inbox.inbox_item.status_changed`, `inbox.inbox_item.escalated`, `inbox.inbox_item.assigned`, `inbox.inbox_item.unassigned`, `inbox.inbox_note.added`, `inbox.inbox_item.bulk_status_changed`, `review.reply.published`, `review.reply.submitted`, `review.reply.approved`, `review.reply.rejected`. Excluded: `cache.invalidated`, `item.read` (auto, not user-initiated). Bulk operations produce one entry per affected item with `payload.bulkId` linking them — audit-complete per item, groupable for org-wide feed.
- **Activity context location (Q15)**: New top-level context `src/contexts/activity/`. Own directory, composition, public API, event handlers, queries, permission filtering. Not shared infrastructure — it's a bounded context with its own schema and business rules.
- **Activity context structure (Q16)**: `domain/` (activity-log entity, constructors), `ports/` (repository interface, user lookup), `infrastructure/` (drizzle repo, event handlers, identity adapter), `queries/` (timeline + org-wide feed with permission filtering), `application/public-api.ts` (queries only — no commands). No use cases — write-only via event subscription, read-only via queries. Composition wires `eventBus.on()` handlers.
```
