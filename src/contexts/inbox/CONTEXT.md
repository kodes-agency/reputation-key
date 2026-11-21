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
read through context-owned lookup ports (`../reputation/inbox/*-lookup.port.server.ts`), never
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

Server functions live in `server/`; the use cases, stores, read models,
lookups, consumers and projection rebuild live in `../reputation/inbox/` (each
port beside its implementation as `*.port.server.ts`), and Response Target code
in `../reputation/response-targets/`. The screens are in `../reputation/inbox/ui` (the page, queue, filter and row
primitives in `page/`), `../reputation/replies/ui` and
`src/routes/_authenticated/inbox/`; `src/components/inbox` keeps only the reply
actions hook. Its pure types, rules, events and errors are in
`../reputation/domain/`: `inbox-types.ts`, `inbox-rules.ts`, `inbox-events.ts`,
`inbox-errors.ts`, `inbox-constructors.ts`, `inbox-priority.ts`,
`feedback-handling.ts`, `handling-cycles.ts`, `handling-history.ts`,
`handling-outcome-authority.ts` and `response-target.ts`.

| Feature                              | Server function (file in `server/`)                                                                                                                                       | Use case or store                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| List, filters, cursors               | `getInboxItemsFn` (`inbox-queries.ts`)                                                                                                                                    | `../reputation/inbox/get-inbox-items.server.ts`, `../reputation/inbox/inbox-view-repository.server.ts`                                                                                                                   |
| Queue and property counts            | `getInboxQueueCountsFn`, `getInboxPropertyCountsFn` (`inbox-queries.ts`)                                                                                                  | `../reputation/inbox/get-inbox-queue-counts.server.ts`, `../reputation/inbox/get-inbox-property-counts.server.ts`, `application/inbox-queues.ts`                                                                         |
| New-item count since last visit      | `getLastVisitCountFn`, `stampLastInboxViewFn` (`inbox-queries.ts`)                                                                                                        | `../reputation/inbox/get-last-visit-count.server.ts`, `../reputation/inbox/stamp-last-inbox-view.server.ts`                                                                                                              |
| Item detail, notes, Handling History | `getInboxItemDetailFn`, `getInboxNotesFn`, `getInboxItemHistoryFn` (`inbox-item-queries.ts`)                                                                              | `../reputation/inbox/get-inbox-item-detail.server.ts`, `../reputation/inbox/get-inbox-notes.server.ts`, `../reputation/inbox/get-inbox-item-history.server.ts`, `../reputation/inbox/inbox-history-repository.server.ts` |
| Assignment and notes                 | `assignInboxItemFn`, `bulkAssignInboxItemsFn`, `addInboxNoteFn` (`inbox-item-actions.ts`)                                                                                 | `../reputation/inbox/assign-inbox-item.server.ts`, `../reputation/inbox/bulk-assign-inbox-items.server.ts`, `../reputation/inbox/add-inbox-note.server.ts`                                                               |
| Status, escalation                   | `updateInboxStatusFn`, `bulkUpdateInboxStatusFn`, `escalateInboxItemFn`, `resolveEscalationFn` (`inbox-status.ts`)                                                        | `../reputation/inbox/update-inbox-status.server.ts`, `../reputation/inbox/bulk-update-inbox-status.server.ts`, `../reputation/inbox/escalate-inbox-item.server.ts`, `../reputation/inbox/resolve-escalation.server.ts`   |
| Manager priority                     | `setInboxItemPriorityFn` (`inbox-priority.ts`)                                                                                                                            | `../reputation/inbox/set-inbox-item-priority.server.ts`, `../reputation/inbox/inbox-priority-history.server.ts`                                                                                                          |
| Private feedback outcome             | `markFeedbackHandledFn`, `correctFeedbackHandlingOutcomeFn` (`inbox-feedback-handling.ts`)                                                                                | `../reputation/inbox/mark-feedback-handled.server.ts`, `../reputation/inbox/correct-feedback-handling-outcome.server.ts`, `../reputation/inbox/feedback-handling-store.server.ts`                                        |
| Check a review on Google             | `checkReviewOnGoogleFn` (`inbox-google-check.ts`)                                                                                                                         | `../reputation/inbox/check-inbox-review-on-google.server.ts` over `google-review-check.port.server.ts`                                                                                                                   |
| Response Target policy and analytics | `getResponseTargetPolicySettingsFn`, `setResponseTargetPolicyFn`, `getPrivateFeedbackTargetAnalyticsFn`, `getGoogleReviewTargetAnalyticsFn` (`inbox-response-targets.ts`) | `../reputation/response-targets/{set-response-target-policy,get-response-targets,policy.store,analytics.store}.server.ts`                                                                                                |

AI reading of a Review item (`aiInsights`, "Not right?" correction) is bound to
Review's current source epoch in `src/composition/get-inbox-review-analysis.server.ts`;
Inbox stores nothing of it.

## Jobs and consumers

- **Job:** `release-response-target-reminders`
  (`../reputation/response-targets/release-reminders.job.server.ts`, use case
  `release-reminders.server.ts`), every five minutes. A
  Google-review reminder is checked against Google first and held while Review
  shows a live reply that answers the cycle; private-feedback slots are never
  checked; no transaction is held across the Google read.
- **Durable consumers** (registered in `build.ts` through `registerOutboxConsumers`,
  apply-once): `inbox.on-review-created`, `inbox.on-review-updated`,
  `inbox.on-review-expired`, `inbox.on-review-source-transitioned`,
  `inbox.on-reply-published`, `inbox.on-reply-observed`, `inbox.on-reply-submitted`
  (`../reputation/inbox/outbox-consumers.server.ts`);
  `inbox.on-guest-feedback-submitted`, `inbox.on-guest-feedback-retracted`
  (`../reputation/inbox/guest-feedback-outbox-consumers.server.ts`); `inbox.on-member-removed`
  (`../reputation/inbox/member-offboarding-outbox-consumers.server.ts`);
  `inbox.on-property-archived` (`../reputation/response-targets/property-lifecycle-outbox-consumers.server.ts`).
- **Maintenance:** `rebuildInboxProjection` (`../reputation/inbox/rebuild-inbox-projection.server.ts`,
  `pnpm ops rebuild-projection`) repairs from canonical data and records no
  facts; `pnpm ops inbox exclude-restated-revision-targets <propertyId>`
  (`../reputation/response-targets/restated-revision-target-exclusion-store.server.ts`) writes
  `inbox_response_target_exclusions`.

`build.ts` assembles adapters and durable registrations; `build-use-cases.ts`
constructs the use cases and projects `InboxPublicApi` for the production and
Storybook containers alike.

### Still in `application/`

Three files stay, each reached by the browser, so none can be a `*.server.ts`:

- `public-api.ts`: other areas import it, and lint names an area's public API by this path.
- `dto/inbox.dto.ts`: `response-targets/ui` (the settings card and the
  private-feedback target card) import it as a value and the public API
  re-exports it as a value. All eight `server/` files import it, and no lint
  policy lets a Review or Inbox layer file import a Reputation `contracts.ts`, so
  it is not a contract either.
- `inbox-queues.ts` (with its test): `inbox/ui/page/inbox-search-schema.ts` in
  Reputation imports it as a value, and the public API and `inbox.dto.ts`
  re-export it. `server/inbox-queries.ts` imports it, so it is not a contract.

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
