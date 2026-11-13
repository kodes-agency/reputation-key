# Inbox — Context

**Audience:** Developers and agents working in `src/contexts/inbox/`.

A feature map: where each feature lives and the rules it must keep. The longer
narrative of earlier versions of this file is at the protected tag
`docs-archive-2026-11-05` (`git show docs-archive-2026-11-05:src/contexts/inbox/CONTEXT.md`).
Decisions are in `docs/adr/` (0046 notifications, 0055 handling cycles, 0057
queues, 0071 manual priority); operations are in
[`docs/operations/inbox-response-targets.md`](../../../docs/operations/inbox-response-targets.md).

## Responsibility

Unified triage for Reviews and private feedback: open/closed workflow state,
assignment, escalation, manager priority, internal notes, Handling Cycles,
Response Targets and new-item counts. An Inbox Item points to exactly one Review
or feedback source and carries only triage state; Review and Guest content is
read through context-owned lookup ports (`application/ports/`), never
cross-context SQL, and the handling stores stay content-free.

## Boundaries

- Review visibility is `inbox.read ∧ review.read`; private feedback is
  `inbox.read ∧ feedback.read`. Writes need `inbox.write ∧ review.read` or
  `inbox.write ∧ feedback.handle`. Assignment never grants either permission.
- Review owns exact Google reply truth. Guest owns ratings, feedback text,
  correction and withdrawal. Identity owns manager eligibility (membership, role,
  PropertyAccessGrant).
- Recent Activity is never evidence that an Inbox command committed. History is
  merged from Inbox's append-only tables (`inbox_handling_cycles`,
  `inbox_handling_cycle_transitions`, `inbox_assignment_history`,
  `inbox_escalation_history`, `inbox_priority_history`,
  `inbox_feedback_handling_outcomes`).

## Feature map

Server functions live in `server/`; use cases in `application/use-cases/`;
stores and read models in `infrastructure/`. The command, consumer and rebuild
implementations that need Review truth live in `../reputation/inbox/`. The
screens are in `src/components/inbox`, `../reputation/inbox/ui` and
`src/routes/_authenticated/inbox/`.

| Feature                              | Server function (file in `server/`)                                                                                                                                       | Use case or store                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List, filters, cursors               | `getInboxItemsFn` (`inbox-queries.ts`)                                                                                                                                    | `get-inbox-items.ts`, `inbox-view.repository.ts`                                                                                                                 |
| Queue and property counts            | `getInboxQueueCountsFn`, `getInboxPropertyCountsFn` (`inbox-queries.ts`)                                                                                                  | `get-inbox-queue-counts.ts`, `get-inbox-property-counts.ts`, `inbox-queues.ts`                                                                                   |
| New-item count since last visit      | `getLastVisitCountFn`, `stampLastInboxViewFn` (`inbox-queries.ts`)                                                                                                        | `get-last-visit-count.ts`, `stamp-last-inbox-view.ts`                                                                                                            |
| Item detail, notes, Handling History | `getInboxItemDetailFn`, `getInboxNotesFn`, `getInboxItemHistoryFn` (`inbox-item-queries.ts`)                                                                              | `get-inbox-item-detail.ts`, `get-inbox-notes.ts`, `get-inbox-item-history.ts`, `inbox-history.repository.ts`                                                     |
| Assignment and notes                 | `assignInboxItemFn`, `bulkAssignInboxItemsFn`, `addInboxNoteFn` (`inbox-item-actions.ts`)                                                                                 | `assign-inbox-item.ts`, `bulk-assign-inbox-items.ts`, `add-inbox-note.ts`                                                                                        |
| Status, escalation                   | `updateInboxStatusFn`, `bulkUpdateInboxStatusFn`, `escalateInboxItemFn`, `resolveEscalationFn` (`inbox-status.ts`)                                                        | `../reputation/inbox/update-inbox-status.server.ts`, `../reputation/inbox/bulk-update-inbox-status.server.ts`, `escalate-inbox-item.ts`, `resolve-escalation.ts` |
| Manager priority                     | `setInboxItemPriorityFn` (`inbox-priority.ts`)                                                                                                                            | `set-inbox-item-priority.ts`, `inbox-priority-history.ts`                                                                                                        |
| Private feedback outcome             | `markFeedbackHandledFn`, `correctFeedbackHandlingOutcomeFn` (`inbox-feedback-handling.ts`)                                                                                | `mark-feedback-handled.ts`, `correct-feedback-handling-outcome.ts`, `feedback-handling.store.ts`                                                                 |
| Check a review on Google             | `checkReviewOnGoogleFn` (`inbox-google-check.ts`)                                                                                                                         | `check-inbox-review-on-google.ts` over `GoogleReviewCheckPort`                                                                                                   |
| Response Target policy and analytics | `getResponseTargetPolicySettingsFn`, `setResponseTargetPolicyFn`, `getPrivateFeedbackTargetAnalyticsFn`, `getGoogleReviewTargetAnalyticsFn` (`inbox-response-targets.ts`) | `set-response-target-policy.ts`, `response-target-policy.store.ts`, `response-target-analytics.store.ts`                                                         |

AI reading of a Review item (`aiInsights`, "Not right?" correction) is bound to
Review's current source epoch in `src/composition/get-inbox-review-analysis.server.ts`;
Inbox stores nothing of it.

## Jobs and consumers

- **Job:** `release-response-target-reminders` (`infrastructure/jobs/release-response-target-reminders.job.ts`,
  use case `release-response-target-reminders.ts`), every five minutes. A
  Google-review reminder is checked against Google first and held while Review
  shows a live reply that answers the cycle; private-feedback slots are never
  checked; no transaction is held across the Google read.
- **Durable consumers** (registered in `build.ts` through `registerOutboxConsumers`,
  apply-once): `inbox.on-review-created`, `inbox.on-review-updated`,
  `inbox.on-review-expired`, `inbox.on-review-source-transitioned`,
  `inbox.on-reply-published`, `inbox.on-reply-observed`, `inbox.on-reply-submitted`
  (`../reputation/inbox/outbox-consumers.server.ts`);
  `inbox.on-guest-feedback-submitted`, `inbox.on-guest-feedback-retracted`
  (`infrastructure/guest-feedback-outbox-consumers.ts`); `inbox.on-member-removed`
  (`infrastructure/member-offboarding-outbox-consumers.ts`);
  `inbox.on-property-archived` (`infrastructure/property-lifecycle-outbox-consumers.ts`).
- **Maintenance:** `rebuildInboxProjection` (`../reputation/inbox/rebuild-inbox-projection.server.ts`,
  `pnpm ops rebuild-projection`) repairs from canonical data and records no
  facts; `pnpm ops inbox exclude-restated-revision-targets <propertyId>`
  (`infrastructure/restated-revision-target-exclusion.store.ts`) writes
  `inbox_response_target_exclusions`.

`build.ts` assembles adapters and durable registrations; `build-use-cases.ts`
constructs the use cases and projects `InboxPublicApi` for the production and
Storybook containers alike.

## Queues

Each queue is a key in `INBOX_QUEUES` (`application/inbox-queues.ts`) that
`queueToFilters` turns into list predicates; the same predicates count it (ADR
0057).

| Section          | Key                         | Holds                                                                  |
| ---------------- | --------------------------- | ---------------------------------------------------------------------- |
| Reviews          | `reply`                     | open Reviews outside the awaiting and waiting stages                   |
|                  | `approval`                  | open Reviews with a reply pending approval                             |
|                  | `waiting`                   | open Reviews whose reply is approved or being published                |
|                  | `replied`                   | every closed Review (archive, never counted)                           |
| Private feedback | `feedback`                  | open private feedback                                                  |
|                  | `handled`                   | every closed private feedback (archive, never counted)                 |
| Shared           | `mine`, `escalated`, `open` | assigned to the viewer, active unresolved escalations, every open item |

`closed` is a valid key the rail no longer lists; the client reads it as
`replied`. Without reply stages (`reply.manage` or `property.publish_reply`
missing) the Reviews section is one `reply` row holding every open Review, and
`approval`/`waiting` are refused. The server passes the reply policy's answer as
`replyQueuesEnabled`; a policy that cannot answer (`policy_unavailable`) refuses
the request. The counts carry it as `replyStages`.

## Invariants

1. Bare ratings (no feedback comment) create no Inbox Items.
2. A Handling Cycle is an immutable numbered episode anchored to one source
   revision; its compare-and-swap head selects the current episode and state
   revision. Human mutations compare-and-swap the observed item revision.
3. Every human command authorizes its complete unique `(principal, Property)`
   set once inside the write transaction, in stable order. A single-item command
   decides Property scope before it answers the revision.
4. Bulk Close does not exist. Bulk Reopen takes at most 100 distinct item/revision
   pairs, preauthorizes them once, writes in item-id order and commits one
   identifier-only `inbox.inbox_items.bulk_reopen_completed` fact.
5. Offboarding or an eligibility release clears assignments with one grouped
   `inbox.inbox_items.assignments_released` fact per Property (anchor item and
   count), never one entry per item.
6. Generic status commands never close work. Review closure is
   provider/source-authoritative; private feedback closes only through
   `markFeedbackHandled` with exactly one controlled outcome. Corrections append
   a superseding outcome and never rewrite the first.
7. Only an exact-current live Google observation (permit checked under Review's
   observation fence) completes a Review target, dated at Google's reply time
   clamped to `[target start_at, observed time]` and written once.
   `review.reply.observed` is a wake-up hint; acknowledgement and
   `review.reply.published` are not Google truth and cannot change status.
8. A guest edit on a closed Review cycle reopens it (`material_revision_changed`);
   an edit over an open cycle, or new private feedback, is an opening. A source
   epoch carry of unchanged material advances the head in place and opens
   nothing.
9. A stale or replayed observation cannot close or reopen work twice. An orphan
   or mismatched compatibility row is repair-visible, never actionable.
10. Response Targets default to 48 elapsed hours and never mix Review and
    feedback in analytics; reminders never auto-escalate. A row in
    `inbox_response_target_exclusions` (`src/shared/db/inbox-response-target-exclusions.ts`)
    leaves a target out of figures and reminders ("Not measured") but never
    blocks its closing.
11. Priority is human-owned: the command store refuses a write whose fact names
    no web actor and re-authorizes it in the transaction. AI levels are read
    live (`aiInsights`), never stored; setting a priority never notifies, opens,
    closes, escalates or changes a target.
12. The projection rebuild never changes an existing item's status. It creates an
    item closed only when, inside Review's exact-current permit, Google shows a
    reply answering the current revision; otherwise it creates it open.
13. List cursors are canonical bounded base64 JSON; malformed values are
    discarded before SQL. Seen watermarks advance monotonically after a
    successful first page.
14. Notes, private feedback, Review or Reply text, contact details, credentials
    and raw network values never enter the Activity projection or a replay fact.

## Verification

Unit tests sit beside domain rules, use cases, consumers, jobs, server contracts
and Handling History; PostgreSQL integration tests cover command atomicity,
authorization and revision races, exact-current Review callbacks, feedback
outcomes, Response Targets and lifecycle. These describe repository wiring, not
hosted activation evidence; deployed scheduler ticks, worker health and
delivery are evidenced separately (see the operations doc above).
