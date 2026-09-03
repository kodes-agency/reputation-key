# Inbox Context

## Bounded context

Unified triage surface for reviews and feedback — status tracking, assignment, notes, and new-item counts.

## Glossary

| Term                          | Definition                                                                                                                                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inbox Item**                | A unified triage entry. Points to either a Review or a Feedback. Carries denormalized filter/sort fields and inbox-specific state (status, assignment).                                                                                                                             |
| **Source Type**               | The origin of an inbox item: `'review'` or `'feedback'`.                                                                                                                                                                                                                            |
| **Source ID**                 | The primary key of the source entity (a `ReviewId` or `FeedbackId`).                                                                                                                                                                                                                |
| **Status**                    | The triage state of an inbox item: `open` or `closed`.                                                                                                                                                                                                                              |
| **Closed**                    | The item no longer needs active work. Review closure comes from exact current Google/source authority. Private-feedback closure comes from either a guest withdrawal or a manager-selected Handling Outcome. Manual reopen remains governed and preserves earlier completion facts. |
| **Escalated**                 | An orthogonal flag for management attention. An open or closed item can be escalated until the flag is resolved.                                                                                                                                                                    |
| **Assignment**                | Linking an inbox item to a specific eligible user. An eligible user may explicitly claim or release their own work; managing another assignee additionally requires `inbox.manage`.                                                                                                 |
| **Internal Note**             | A text annotation on an inbox item. Stored in `inbox_notes`. Tracks author and timestamp. Multiple notes per item.                                                                                                                                                                  |
| **Source Date**               | The denormalized date from the source entity (`reviewedAt` for reviews, `createdAt` for feedback). Used for sorting.                                                                                                                                                                |
| **Filtered Total**            | Authoritative count of all items matching the governed list filters, calculated before the page cursor and returned with every page.                                                                                                                                                |
| **Response Cutoff**           | Server time captured before first-page loading. A successful page may monotonically advance the user's seen watermark to this instant, never to request completion time.                                                                                                            |
| **List Sort**                 | Stable keyset ordering by `(sourceDate, id)`, newest-first by default with an oldest-first option.                                                                                                                                                                                  |
| **Handling Cycle**            | An immutable, numbered work episode anchored to one source revision: Material Review Revision for Review, Guest Response Revision for feedback. More than one cycle may reference the same revision.                                                                                |
| **Cycle Head**                | The compare-and-swap pointer to the one current source cycle, its source revision, workflow status, and state revision.                                                                                                                                                             |
| **Feedback Handling Outcome** | One of five controlled manager completion results for a private-feedback cycle. Its optional internal note is manager-only and never included in guest responses or cross-context facts.                                                                                            |
| **Outcome Correction**        | A new append-only outcome fact that supersedes the previous result. It never rewrites the original completion time/timing result, reopens work, or changes the guest rating.                                                                                                        |

## Relationships

- Inbox Item → Review (via `sourceType = 'review'`, `sourceId = reviewId`). Eligible content is read through `ReviewLookupPort`, never cross-context SQL.
- Inbox Item → Feedback (via `sourceType = 'feedback'`, `sourceId = feedbackId`). Eligible rating/comment content is enriched through `FeedbackLookupPort`; handling commands never rewrite it.
- Inbox Item → StaffAssignment (assignment scoped to properties the user can access).
- Inbox Item → Handling Cycle (one-to-many immutable openings); one Cycle Head selects the current actionable episode. Review cycles anchor Material Review Revisions and feedback cycles anchor Guest Response Revisions.
- Feedback Handling Cycle → Feedback Handling Outcome (one initial outcome plus zero or more append-only corrections).
- Inbox Note → Inbox Item (many-to-one).
- Inbox subscribes to Review/Guest lifecycle facts. `review.reply.observed` is the sole provider-reply authority; `review.reply.published` is retained only as a compatibility receipt.

## Invariants

- An inbox item is created for every new review and every new feedback submission.
- Bare ratings (no feedback comment) do not create inbox items.
- Status transitions must follow the valid graph (see ADR 0004).
- Claiming or releasing one's own eligible item requires source handling access. Assigning, releasing, or replacing another assignee additionally requires `inbox.manage`.
- An assignee must retain the same Identity-owned manager permissions and Property scope as an actor handling that source. A PropertyManager must also have one exact current Staff user link and active participation at the Property; an AccountAdmin intentionally does not require a Staff participant row.
- Role downgrade, Property grant revocation, and Staff participation archive re-run an idempotent Inbox reconciliation. It proves each assigned Review/feedback permission inside the release transaction and durably clears only assignments that are now ineligible; a retained legacy non-UUID Property key is always releasable and is preserved verbatim in assignment history.
- Every human command authorizes its complete unique `(principal, Property)` requirement set once inside the write transaction. Multi-item commands cannot lock the permission generation after one item and then acquire a later item's membership or grant row.
- Human-authored status, assignment, escalation, resolution, and note commands compare-and-swap the client-observed item command revision. Adding a note advances the same item fence atomically with the note and its identifier-only fact.
- Bulk Close is unavailable. Bulk Reopen accepts at most 100 distinct item/revision pairs, preauthorizes the complete candidate set once, applies compare-and-swap writes in stable Inbox-item-ID order, and reconstructs privacy-safe results in caller order. Only landed rows emit a durable fact; a racing row is reported without rolling back another landed reopen.
- Review visibility requires `inbox.read ∧ review.read`; private-feedback visibility requires `inbox.read ∧ feedback.read`.
- Review workflow changes require `inbox.write ∧ review.read`; private-feedback workflow changes require `inbox.write ∧ feedback.handle`. Assignment never grants either permission.
- Generic status commands never close work. Review closure is provider/source-authoritative; a manager closes an open private-feedback cycle only through `markFeedbackHandled` with exactly one controlled outcome.
- A feedback Handling Outcome is allowed only for an open feedback cycle. `guest_withdrawn` is a separate guest lifecycle transition and records no manager outcome.
- Outcome corrections append a directly superseding fact under exact item/cycle/source/state/outcome revision fences. They preserve the first completion instant and deadline result, leave the cycle closed, and never alter the source rating.
- Feedback outcome history is immutable at the database boundary. The optional internal note is returned only when the caller has current `inbox.write ∧ feedback.handle` Property scope; it is absent from guest surfaces and emitted Inbox lifecycle facts.
- Each inbox item has exactly one source (review or feedback), never both.
- Feedback list/detail results may carry an eligible rating value from the Guest-owned lookup; the Inbox handling stores remain content-free.
- List cursors are bounded canonical base64 JSON. Their `sourceDate` must be a canonical ISO instant and `id` a UUID; malformed cursors are discarded before repository/SQL access and never echoed into logs.
- Every page carries a response cutoff captured before access resolution and data loading. The client stamps it only after a successful first-page load, and storage advances the per-user watermark monotonically, so arrivals during the load remain new and a slower response cannot move the watermark backward.
- A Review cycle opening is append-only at the database boundary. Starting a later cycle advances the head only when expected cycle number, Material Review Revision, and state revision all match.
- `material_revision_changed` must advance to the Review's current Material Review Revision. `manual_reopen` may create another numbered cycle on the same revision. Both preserve every earlier opening fact.
- Automatic Review closure requires a `review.reply.observed` fact whose identifiers still name the exact current Review-owned live observation head and current source epoch and Material Review Revision. A `confirmed_on_google` observation additionally binds the exact current Reply publication attempt and cycle; an `external_current_live` observation closes as current external truth without claiming RepKey provenance. The event is only a wake-up hint: Inbox receives a content-free permit through its own `ReplyObservationAuthorityPort`, never queries Review tables, and treats a refused permit as obsolete.
- Review holds its observation-write fence from exact-head validation until the Inbox callback commits. Within that interval, Inbox commits receipt reservation, status/cycle changes, and the emitted Inbox fact in one transaction. This explicit two-transaction fence is necessary because each context owns its writes; it prevents a newer Review head from landing in the validation-to-Inbox-commit interval, while the Inbox receipt makes an outer read-only commit failure replay-safe.
- A current `review.reply.observed` fact that overtakes `review.created` remains retryable: Inbox records no receipt until the item and Handling Cycle materialize. If the observation's Material Review Revision is ahead of Inbox, delivery likewise retries without a receipt; if Inbox is already newer, the observation receives an obsolete receipt. A fact whose Review head is already obsolete also receives an obsolete receipt even when no Inbox item exists.
- A current observed Google reply deletion reopens the active Review work when the Handling Cycle's material/cycle fences still permit it. An external live edit remains handled and does not reopen work. The retained legacy `diverged` value is receipt-only and never a reopen authority. A stale/replayed fact cannot close or reopen twice.
- Provider write acknowledgement and the internal `review.reply.published` lifecycle fact are not Google truth and cannot mutate Inbox status.
- Review source expiry/deletion preserves the stable Inbox row and manager-owned notes/assignment history while an Inbox-owned durable apply removes all legacy `rating`/`snippet`/`reviewer_name` copies, closes open work, and co-commits its status fact and receipt. A validated database check prevents those provider-controlled fields from being restored on Review-sourced items; feedback-sourced values remain Guest/Inbox-owned.
- `inbox_items.status` remains a write-side compatibility projection, synchronized atomically with the source Handling Cycle head. Active list, detail, and count reads require an exact item/Organization/Property/source Cycle Head and use only the head status for both Review and feedback; an orphan or mismatched compatibility row is repair-visible but never actionable. Generic status commands are reopen-only; source-specific Review authority and private-feedback outcomes own closure.

## Response Targets (IBX-01)

- Google Review Response and Private Feedback Handling Targets both default to 48 elapsed hours. Organization policy may replace either default; only feedback resolves an enabled Property override before Organization/default. There is no Portal override.
- Every measured Handling Cycle atomically snapshots duration, policy source/version, UTC start/due, and exactly one halfway plus one target-passed reminder slot. Policy changes affect only later cycles; overdue is a read-time derivation that never closes or escalates work.
- Feedback submission and reopen start timing. An approved `markFeedbackHandled` outcome completes it; guest withdrawal cancels it. Claim/read/assignment/note/escalation do not stop it, and outcome correction preserves the first completion/result.
- Review supplies content-free exact-current target provenance under its source fence. Ongoing initial work uses Google's source-created/reviewed time; a later Material Review Revision uses source-updated/observation time. Initial onboarding history and legacy-unknown timing remain excluded rather than inferred.
- Manual Review reopen and exact provider-reply deletion start a new measured target at the live operational reopen instant, even when the original imported cycle was excluded. A newer Material Review Revision cancels an unfinished superseded target before opening the new target; source ineligibility also terminalizes unfinished timing.
- Only an exact current live Google observation completes a Review target. Both `confirmed_on_google` and `external_current_live` count as observed-live completion; provider acknowledgement and `review.reply.published` do not. A current reply deletion can reopen work, while a live external edit remains closed.
- Analytics are Property-scope-authorized, target-family-specific, and never mix Review with feedback. Cancelled cycles are excluded; Google reporting separately counts onboarding-history and legacy-unknown exclusions.
- Reminder release is registered as an enabled five-minute job and co-commits one content-free, stable-ID outbox fact per due current slot. Notification resolves and revalidates current recipients: halfway prefers an eligible assignee, otherwise source responsibility/fallback; target-passed uses the de-duplicated union of both. Reminders never auto-escalate.
- These statements describe repository wiring, not hosted activation evidence. Deployed scheduler ticks, worker/outbox health, migration state, and end-user delivery must be evidenced separately; see `docs/operations/inbox-response-targets.md`.

## Events produced

| Tag                                           | Payload                                                                                    | When                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `inbox.inbox_item.created`                    | inboxItemId, organizationId, propertyId, sourceType, sourceId, occurredAt                  | New review or feedback triggers inbox item                                      |
| `inbox.inbox_item.status_changed`             | inboxItemId, organizationId, propertyId, userId, oldStatus, newStatus, occurredAt          | Status transition                                                               |
| `inbox.inbox_item.assigned`                   | inboxItemId, organizationId, propertyId, userId, assignedTo, occurredAt                    | Item assigned to user                                                           |
| `inbox.inbox_item.unassigned`                 | inboxItemId, organizationId, propertyId, userId, previousAssignee, occurredAt              | Item unassigned from user                                                       |
| `inbox.inbox_item.escalated`                  | inboxItemId, organizationId, propertyId, userId, occurredAt                                | Escalation flag set                                                             |
| `inbox.inbox_item.escalation_resolved`        | inboxItemId, organizationId, propertyId, userId, occurredAt                                | Escalation flag resolved                                                        |
| `inbox.inbox_note.added`                      | inboxItemId, organizationId, propertyId, userId, noteId, occurredAt                        | Internal note added to item                                                     |
| `inbox.inbox_item.bulk_status_changed`        | inboxItemId, organizationId, propertyId, userId, oldStatus, newStatus, bulkId, occurredAt  | Item status changed in bulk operation                                           |
| `inbox.inbox_items.bulk_assignment_completed` | organizationId, userId, bulkId, content-free assignment transitions, count, occurredAt     | Atomic bulk assignment command completes                                        |
| `inbox.handling_cycle.opened`                 | inbox/source/cycle/state revisions, openReason, actor identifiers, occurredAt              | Initial or source-revision Handling Cycle opens                                 |
| `inbox.handling_cycle.closed`                 | inbox/source/cycle/state revisions, closeReason, actor identifiers, occurredAt             | Current Handling Cycle closes                                                   |
| `inbox.handling_cycle.reopened`               | inbox/source/cycle/state revisions, reopenReason, actor identifiers, occurredAt            | Manual or provider-authoritative re-handling opens a new cycle                  |
| `inbox.response_target.reminder_due`          | inbox/cycle/Organization/Property/target/reminder identifiers and scheduled/occurred times | A halfway or target-passed slot is released once to the durable outbox boundary |
| `inbox.response_target.policy_changed`        | Organization/Property scope, target kind, duration/version, actor, occurredAt              | A compare-and-set policy revision commits                                       |

Note: `inbox.inbox_item.created` has no `userId` — it's emitted by sync pipeline event handlers, not user actions. Activity log attributes it to `'system'`.

Note (BQC-3.4): `inbox.inbox_note.added` carries the note ID, never the note text — notes remain context-owned content. Every fact above is committed atomically with its state change via the `InboxCommandStore` (one PostgreSQL transaction: state + outbox row; post-commit bus emit is best-effort). The `rebuildInboxProjection` repair command remains bounded, idempotent, report-first, and Review-specific; Guest lifecycle delivery owns feedback materialization, while active reads fail closed when its current Cycle Head is absent.

## Events consumed

| Tag                          | Source context | Handler action                                                                                                                                                                             |
| ---------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `review.created`             | review         | Create metadata-only inbox item (bus + durable `inbox.on-review-created`, applyOnce co-commits receipt)                                                                                    |
| `review.updated`             | review         | Metadata-only refresh of sourceDate/platform (durable `inbox.on-review-updated`, BQC-3.4)                                                                                                  |
| `review.source_transitioned` | review         | Preserve identity, scrub legacy provider fields, and close open unservable work (durable `inbox.on-review-source-transitioned`)                                                            |
| `guest.feedback.submitted`   | guest          | Create metadata-only feedback item (bus + durable `inbox.on-guest-feedback-submitted`)                                                                                                     |
| `guest.feedback.retracted`   | guest          | Close open feedback work after Guest purges the body; bus acceleration and durable delivery share the same receipt-coordinated Cycle Head apply seam (`inbox.on-guest-feedback-retracted`) |
| `review.reply.published`     | review         | Compatibility receipt only; never closes or reopens work (durable `inbox.on-reply-published`)                                                                                              |
| `review.reply.observed`      | review         | Request an exact-current Review permit; an exact live reply closes once, a deletion reopens once, and an external live edit stays closed (durable `inbox.on-reply-observed`)               |
| `review.reply.submitted`     | review         | Stamp `firstReplySubmittedAt` milestone on inbox item (bus only)                                                                                                                           |
| `review.expired`             | review         | Legacy transition compatibility: preserve identity and scrub provider copies only; the unversioned event never changes workflow status (bus + durable `inbox.on-review-expired`)           |

## Architecture layers

```
inbox/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts,
                      feedback-handling.ts
  application/
    ports/             inbox.repository.ts, inbox-note.repository.ts, review-lookup.port.ts,
                      feedback-lookup.port.ts, property-lookup.port.ts, new-counter.port.ts
    dto/               inbox.dto.ts (Zod schemas)
    use-cases/         get-inbox-items.ts, update-inbox-status.ts, bulk-update-inbox-status.ts,
                      assign-inbox-item.ts, add-inbox-note.ts, get-new-count.ts,
                      get-inbox-item-detail.ts, get-inbox-notes.ts, create-inbox-item.ts,
                      get-folder-counts.ts, mark-feedback-handled.ts,
                      correct-feedback-handling-outcome.ts
    public-api.ts      re-exports domain types, error types, cursor type
  infrastructure/
    adapters/          review-lookup.adapter.ts, feedback-lookup.adapter.ts,
                      property-lookup.adapter.ts, reply-lookup.adapter.ts,
                      review-source-lookup.adapter.ts
    mappers/           inbox.mapper.ts, inbox-note.mapper.ts
    repositories/      inbox.repository.ts, inbox-note.repository.ts (Drizzle)
    inbox-command-store.ts            atomic state+outbox+receipt commands (BQC-3.4)
    review-handling-cycle.store.ts    immutable cycle append + locked/CAS current head
    feedback-handling.store.ts        atomic feedback close + append-only outcome correction
    outbox-consumers.ts  durable consumers (applyOnce): review.created/.updated/.expired,
                      reply.published compatibility receipt, reply.observed authority
    event-handlers/    on-review-created.ts, on-review-expired.ts, on-feedback-submitted.ts,
                      on-reply-submitted.ts (bus paths); on-reply-published.ts is quarantined
    (test fake: src/shared/testing/sequential-inbox-command-store.ts)
  server/              inbox.ts, inbox-item-queries.ts, inbox-status.ts, inbox-item-actions.ts,
                      inbox-feedback-handling.ts,
                      inbox-queries.ts, inbox-shared.ts
  build.ts             composition root
  build-use-cases.ts   use-case factory
```

## Use cases

| Use case                         | Input                                                                                                       | Output                                      | Permission                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `getInboxItems`                  | organizationId, userId, role, filters (including sort), cursor?, limit?                                     | items, next cursor, filtered total          | `inbox.read` plus source read                                |
| `getInboxItemDetail`             | inboxItemId, organizationId, userId, role                                                                   | `InboxItemDetail`                           | `inbox.read` plus source read                                |
| `updateInboxStatus`              | inboxItemId, organizationId, newStatus, userId, role                                                        | updated item                                | `inbox.write` plus source handle                             |
| `bulkUpdateInboxStatus`          | inboxItemIds[], organizationId, newStatus, userId, role                                                     | bulk result                                 | `inbox.write` plus per-item source handle                    |
| `assignInboxItem`                | inboxItemId, organizationId, assignedToUserId?, userId, role                                                | updated item                                | source handle; `inbox.manage` for another assignee           |
| `addInboxNote`                   | inboxItemId, organizationId, authorUserId, text, role                                                       | `InboxNote`                                 | `inbox.write` plus source handle                             |
| `getInboxNotes`                  | inboxItemId, organizationId, userId, role                                                                   | notes                                       | `inbox.read` plus source read                                |
| `getLastVisitCount`              | organizationId, userId                                                                                      | open-since-last-visit count                 | `inbox.read` plus per-source read scope                      |
| `createInboxItem`                | organizationId, propertyId, sourceType, sourceId, rating?, sourceDate, platform?, snippet?                  | `InboxItem`                                 | internal only                                                |
| `getFolderCounts`                | organizationId, userId, role                                                                                | `InboxFolderCounts`                         | `inbox.read` plus per-source read scope                      |
| `escalateInboxItem`              | inboxItemId, organizationId, userId                                                                         | updated item                                | `inbox.write` plus source handle                             |
| `resolveEscalation`              | inboxItemId, organizationId, userId                                                                         | updated item                                | `inbox.write` plus source handle                             |
| `rebuildInboxProjection`         | organizationId, propertyId?, dryRun, batchSize?                                                             | repair report                               | internal repair command (BQC-3.4; operator surface is BQC-7) |
| `startReviewHandlingCycle`       | inboxItemId, Organization, expected cycle/material/state revisions, target Material Review Revision, reason | cycle + current head                        | internal workflow command; caller owns authorization         |
| `markFeedbackHandled`            | inboxItemId, exact command/cycle/source/state revisions, outcome, internal note?                            | updated item + handling history             | `inbox.write ∧ feedback.handle` in Property scope            |
| `correctFeedbackHandlingOutcome` | inboxItemId, exact command/cycle/source/state/outcome revisions, corrected outcome, internal note?          | updated item + append-only handling history | `inbox.write ∧ feedback.handle` in Property scope            |

## Public API

Exported from `application/public-api.ts`:

- Types: `InboxItem`, `InboxNote`, `InboxItemDetail`, `InboxStatus`, `SourceType`, `InboxSort`
- Error type: `InboxError`
- Port type: `Cursor` and paginated results with `totalCount`
- Constants: `INBOX_BULK_LIMIT` (100 item IDs per bulk status command), `PRIVATE_FEEDBACK_HANDLING_OUTCOMES`, `REVISION_CONFLICT_MESSAGE` (the manager-facing optimistic-concurrency refusal; components match rejected mutations on this message because a deserialized server-function error no longer carries the error code)
- Feedback handling exposes only the controlled outcome, state, and command-result vocabulary.
- Event types: `InboxItemCreated`, `InboxItemStatusChanged`, `InboxItemAssigned`, `InboxItemUnassigned`, `InboxItemEscalated`, `InboxNoteAdded`, `InboxItemBulkStatusChanged`, `InboxEvent`
- Read-model view type: `InboxNoteView`

## Server functions

| Function                           | Method | Permission                      | Route                                                       |
| ---------------------------------- | ------ | ------------------------------- | ----------------------------------------------------------- |
| `getInboxItemsFn`                  | GET    | `inbox.read`                    | Paginated inbox list with filters                           |
| `updateInboxStatusFn`              | POST   | `inbox.write`                   | Update single item status                                   |
| `bulkUpdateInboxStatusFn`          | POST   | `inbox.write`                   | Bulk reopen only; Bulk Close is unavailable in initial beta |
| `assignInboxItemFn`                | POST   | `inbox.write`                   | Assign/unassign item                                        |
| `addInboxNoteFn`                   | POST   | `inbox.write`                   | Add internal note                                           |
| `getLastVisitCountFn`              | GET    | `inbox.read` plus source read   | Open items since the caller's previous visit                |
| `getInboxNotesFn`                  | GET    | `inbox.read` plus source read   | Notes for an item                                           |
| `getInboxItemHistoryFn`            | GET    | `inbox.read` plus source read   | Ordered Handling History; internal note needs handle rights |
| `getInboxFolderCountsFn`           | GET    | `inbox.read` plus source read   | Open, escalated, and closed counts                          |
| `markFeedbackHandledFn`            | POST   | `inbox.write ∧ feedback.handle` | Close one open feedback cycle with one controlled outcome   |
| `correctFeedbackHandlingOutcomeFn` | POST   | `inbox.write ∧ feedback.handle` | Append one superseding outcome correction without reopening |

## Handling History (IBX-01-T5)

`getInboxItemHistory` is Inbox's own read of how an Item was handled. Recent
Activity is **never** evidence that an Inbox command committed, so history is
merged from Inbox's five append-only tables — `inbox_handling_cycles`,
`inbox_handling_cycle_transitions`, `inbox_assignment_history`,
`inbox_escalation_history` and `inbox_feedback_handling_outcomes` — and never
from the activity feed.

- **One reader for the transitions log.** `infrastructure/handling-cycle-transitions.read.ts`
  is the only module that queries `inbox_handling_cycle_transitions`. The
  private-feedback store's close-reason read and the history read model both go
  through it, so they cannot drift apart on ordering. `state_revision` is the
  ordering key; `transitioned_at` is a wall clock and is not.
- **One total order.** Entries sort by `(occurredAt, cycleNumber, stateRevision)`
  with a stable kind discriminator and then the entry id as the final tie-break.
  An entry with no state revision is a fact recorded alongside the cycle rather
  than a step in its state machine, so it sorts before the transitions of the
  same cycle — a cycle's opening row precedes the `opened` transition it caused.
- **Bounded.** Every source query carries an explicit LIMIT
  (`INBOX_HISTORY_SOURCE_LIMIT`, 200). `truncated` says the story shown is
  incomplete rather than pretending it is whole.
- **Authorization.** Reading requires `inbox.read` AND the source's own read
  permission in the item's Property scope, checked before the history store is
  touched. The manager-internal note on a private-feedback outcome is returned
  only to a caller who currently holds `inbox.write ∧ feedback.handle` in that
  Property; otherwise the field is **absent**, not null, so an unauthorized
  reader cannot infer that a note exists.
- **Legacy rows.** A cycle or transition whose reason is `legacy_backfill` is
  labelled `legacy` and carries no actor, no outcome and no deadline result.
  Nothing is inferred for it.

## Actor display names (IBX-01-T6)

`InboxActorDirectory` resolves a bounded batch of user ids to display names
inside one Organization (`member` INNER JOIN `user`; the join is the tenant
fence). It returns names only — never email, avatar, role or membership state.
Exactly one batched lookup runs per request for notes and for history, so entry
count never becomes query count. Ids outside the Organization, and users with a
blank profile name, are absent from the result; callers render "Unknown user".

## Organization Export (LIF-01-T6)

`build.ts` exposes `organizationExport.contributor`, Inbox's implementation of
Identity's `organization-export-contributor.port`. It is deliberately outside
`publicApi`: no request path may call it, and the composition root hands it to
Identity's `organizationExport.contributors`.

Reads: `inbox_items`, `inbox_handling_cycle_heads`, `inbox_handling_cycles`,
`inbox_handling_cycle_transitions`, `inbox_handling_cycle_response_targets`,
`inbox_assignment_history`, `inbox_escalation_history`,
`inbox_feedback_handling_outcomes`, `inbox_response_target_organization_policies`,
`inbox_private_feedback_target_property_overrides`, `inbox_notes`.

Deliberately excluded:

- `inbox_user_views` — personal read state, never tenant-visible evidence.
- `inbox_response_target_reminders` — control-plane scheduling, in the same
  family as queues/outbox/receipts that LIF-01 bullet 7 excludes.
- The denormalized source-content copies on `inbox_items` (`rating`, `snippet`,
  `reviewer_name`) — Google review content is provider-controlled and excluded
  outright; guest private-feedback text belongs to the Guest contributor, which
  owns its consent and its 90-day retention deadline.

Manager free text is carved into `inbox/notes.*` and `inbox/handling-notes.*` at
`manager_authored`; every other file is content-free workflow record at
`tenant_visible`. An Organization with no Inbox work answers `no_data` — an
empty CSV is never fabricated.

## Permissions

| Permission        | AccountAdmin | PropertyManager | Staff |
| ----------------- | ------------ | --------------- | ----- |
| `inbox.read`      | ✓            | ✓               | ✓     |
| `inbox.write`     | ✓            | ✓               | ✓     |
| `inbox.manage`    | ✓            | ✓               | —     |
| `feedback.read`   | ✓            | ✓               | —     |
| `feedback.handle` | ✓            | ✓               | —     |

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
- **Bulk status actions**: the contextual toolbar supports governed reopen and caps selection at `INBOX_BULK_LIMIT`; Bulk Close is unavailable because each source owns its close authority.
- **Recent Activity timeline**: Inbox detail reads Activity's bounded, privacy-aware
  `RecentActivityEntry` projection. It can show allowlisted workflow summaries but
  is never evidence that an Inbox command or provider effect committed.
- **Delivery and recovery**: source contexts own durable facts. Activity consumes
  them through the outbox/queue path with an in-process low-latency acceleration;
  projection, replay authority, and delivery receipt commit together. An exact
  source-event replay is idempotent, while conflicting evidence fails closed.
- **Content boundary**: entries may contain identifiers and allowlisted transition
  codes only. Inbox notes, private feedback, Review or Reply text, contact details,
  credentials, and raw network values must never enter the projection or replay
  fact.
- **Operational Action History is separate**: restricted action-history records
  use their own store, authorization, lifecycle, and vocabulary. Recent Activity is
  not an audit log, immutable ledger, provider-effect receipt, or authorization
  source.
- **Ownership**: Activity owns projection/recovery stores, scoped queries, and the
  public read interface. Inbox owns Handling Cycle state, notes, assignments, and
  the durable facts from which selected summaries are projected.
