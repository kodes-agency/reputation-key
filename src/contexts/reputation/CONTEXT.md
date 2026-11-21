# Reputation — Context

**Audience:** Developers and agents working in `src/contexts/reputation/`.

Review, Inbox and Reputation are one bounded context (rule 7 of
[`docs/rules.md`](../../../docs/rules.md)), and all of their code is here. This
file is the feature map: where each feature lives and the rules it must keep.
The longer narrative of the former Review and Inbox guides is at the protected
tag `docs-archive-2026-11-05`
(`git show docs-archive-2026-11-05:src/contexts/review/CONTEXT.md`, and the same
for `src/contexts/inbox/CONTEXT.md`). Decisions are in `docs/adr/` (0046
notifications, 0055 handling cycles and reply truth, 0057 queues, 0060 property
fence, 0067 Google rating goal, 0071 manual priority); operations are in
[`docs/operations/runbooks.md`](../../../docs/operations/runbooks.md),
[`docs/operations/review-lifecycle-recovery-approval.md`](../../../docs/operations/review-lifecycle-recovery-approval.md)
and
[`docs/operations/inbox-response-targets.md`](../../../docs/operations/inbox-response-targets.md).

## Responsibility

- **Review**: stable external-review identity, provider observation and content
  lifecycle, and the RepKey-owned Reply workflow. Provider-controlled content is
  a bounded cache, never the identity or history authority.
- **Inbox**: unified triage for Reviews and private feedback: open/closed
  workflow state, assignment, escalation, manager priority, internal notes,
  Handling Cycles, Response Targets and new-item counts. An Inbox Item points to
  exactly one Review or feedback source and carries only triage state; Review and
  Guest content is read through context-owned lookup ports
  (`inbox/*-lookup.port.server.ts`), never cross-context SQL, and the handling
  stores stay content-free.

## Area root

- `build-review.ts` assembles provider transport, source authorities, consumer
  registration and the `registerWorkerJobs` contribution.
  `build-reply-use-cases.server.ts` builds the Reply workflow and library
  commands and keeps worker and maintenance capabilities out of
  `publicApi.reply`.
- `build-inbox.ts` assembles Inbox's adapters and durable registrations;
  `build-inbox-use-cases.ts` constructs the use cases and projects
  `InboxPublicApi` for the production and Storybook containers alike.
- `public-api.ts` is the one file another area may import. It is server code: it
  re-exports Reputation's server writers. A browser file takes only types from
  it (`import type`) and takes values from the feature contracts.
- `server/` holds the server functions: `reply*.ts` for Review, `inbox-*.ts` for
  Inbox, and the `inbox.ts` barrel that re-exports the Inbox ones.

## Domain

`domain/` holds the pure types, rules, constructors, events and errors of Review
and Inbox. It imports no I/O, no framework and no clock.

Where both had a module for the same job, the name says whose it is:
`review-types.ts`/`inbox-types.ts`, `review-errors.ts`/`inbox-errors.ts`,
`review-rules.ts`/`inbox-rules.ts` and `review-events.ts`/`inbox-events.ts`.
Inbox's constructors and manager priority are `inbox-constructors.ts` and
`inbox-priority.ts`.

Event modules end in `-events.ts`: they are the only domain modules
`src/shared/events` may import.

The Reply workflow's hand-written oracle is `reply-workflow-oracle.test-fixtures.ts`.
`reply-workflow.property.test.ts` here and
`replies/reply-workflow.model.integration.test.ts` use it.

Reputation's own code imports these files directly. Other areas reach them only
through `public-api.ts`. Feature screens may not import them: they take the types
through `public-api.ts` and the values the browser runs (priority levels and the
effective priority, the feedback outcomes, the revision-conflict check, the
unfilled-slot message) through `inbox/contracts.ts` and `replies/contracts.ts`.

## Contracts and ports

The browser contracts are `inbox/contracts.ts` (Inbox schemas and the bulk
limit), `inbox/inbox-queues.contracts.ts` (the queues), `library/contracts.ts`
(Reply library and draft-check schemas), `library/reply-library-resolver.contracts.ts`
(resolves built-in and stored templates; the library commands and the Storybook
library fixture run it) and `replies/contracts.ts`. A contract may not import a
server port, so a port type a contract needs (the Inbox filter shape, the stored
template shapes) comes through `public-api.ts`, as a type.

Each port sits beside its implementation as `<impl>.port.server.ts`. A port
implemented in a build, in composition or by another area sits with its
callers: `sync/google-review-api.port.server.ts` and
`sync/targeted-google-review-reference.port.server.ts` (Integration's
review-sync adapters implement them, taking their types through `public-api.ts`),
`sync/review-queue.port.server.ts` and `replies/reply-writer.port.server.ts`.
Inbox's copies of Review's authority ports are `inbox/review-*.port.server.ts`.

## Feature layout

`inbox/ui/inbox-list.tsx` owns the Inbox list panel, its loading/error/empty
content choice, pagination and selectable rows. Its Storybook states live beside
it in `inbox-list.stories.tsx`; their titles and state names remain stable.

`replies/ui/` owns the browser reply composer: its controller, the autosave
coordinator, the draft session and its context, edit measurement, composer
transitions and the `use-reply-*` hooks, with their tests. The composer
components (the form, editor, dock, footer, suggestion and template menus, the
draft-waiting state and their stories) are in `replies/ui/composer/`, and the
reply as shown in the thread, with its commands and check, is in
`replies/ui/message/`. `use-reply-actions.ts` and its helper
`reply-draft-stream.ts` stay in `src/components/inbox`: the first imports Review
and AI server functions as values and the second a type from an AI `*.server`
module, which the feature-UI import rules refuse, and the Storybook stubs and
the draft session import them from there.

`inbox/ui/` also owns the Inbox detail: the panel and sheet, case toolbar,
conversation thread, notes, history lines, feedback handling, review cause and
correction, the Google check, and the `use-inbox-detail*` hooks, with their
tests and stories.

The Inbox page, queue, filter, row, selection, shortcut and cache primitives are
in `inbox/ui/page/`, with their tests and stories. The Response Target chip and
the deadline refresh that reloads the detail are in `response-targets/ui/`. The
panel receives commands as props, reads Inbox types through `public-api.ts` and
runs the Inbox values from `inbox/contracts.ts`.

`response-targets/` owns Response Targets end to end: the stores (`store`,
`policy.store`, `analytics.store` and `reminder-release.store`, each
`*.server.ts`) with their ports; `get-response-targets` and
`set-response-target-policy`; the reminder release decision, the tick
(`reminder-release.server.ts`, `release-reminders.server.ts`) and the
`release-reminders.job.server.ts` scheduler job; `google-review-target-completion`
and the archive consumer; the restated-revision exclusion store and its Review
read; and, in `ui/`, the Organization settings card and analytics summary. The
target rules stay in `domain/response-target.ts`. Inbox's command and projection
code imports these server files directly. Its server functions are in
`server/inbox-response-targets.ts`.

## Reply writes

`replies/store.server.ts` builds the Reply writer (`createReplyWriter`): draft
writes and guarded command updates. Each interactive write takes the observation
fence, then locks Review before Reply; a draft save that names the revision it
read is refused when the row has moved. The `ReplyWriter` port is
`replies/reply-writer.port.server.ts`; `replies/reply-writer.server.ts` supplies
the row helpers when it builds the writer, and Review's build receives the
writer from there.

`replies/scope-effects.server.ts` holds the effects that need no Review helper:
bulk AI-draft withdrawal, restore fencing and Organization closing and scrub.
They run in the caller's transaction and lock Reviews in tenant/id order before
touching Replies. Shared AI purge and restore recovery cannot import a context,
so they take them as a port type declared in `shared/db/reply-scope-effects.ts`
and every entry point that can reach them is handed the writer where it is built.

`replies/contracts.ts` is the browser contract: the revision identity (from
`shared/reply/reply-revision.ts`, also used by Review) and the editor fence that keeps
an active editor bound to it and sequences its own mutations, so background reads
cannot authorize stale text and delayed responses cannot revive a deleted draft.

`replies/row-commands.server.ts` holds the writes that need only the caller's
transaction: the provider mirror refresh and removal, cancellation and
confirmation at an observation, source-change and guest-edit returns to draft,
and AI adoption. Review's stores call them through
`public-api.ts` under the Review lock they already hold; the source,
attempt and measurement fences stay in those stores. Nothing outside
`replies/` writes the `replies` table, and `shared/architecture/reply-single-writer.test.ts`
fails on a new writer. Shared code reaches the effects only through the port.
`composition/reply-scope-effects.ts` supplies the writer to the context builds,
the declared-capability deploy step, the AI control, restore-verify and purge
scripts; there is no global binding. An entry point built without it refuses at
the first purge or fence, and `composition/reply-scope-effects.test.ts` proves
each one passes it.

## Provider content

`content/store.server.ts` writes the stable Review identity and the independently
expiring `review_source_contents` row in the observation transaction. Provider
values and renewable fetch clocks are written only to that content row; the nullable old
columns remain in the schema and erasure still clears retained copies. Review's
observation repository keeps material-revision comparison and history, including
the observation text comparison needs. Serving, AI freshness, sync and lifecycle
reads use the content row. Only a provider fetch can renew its expiry. The Review retains its connection
for the database publication guard and its first-fetch history for re-observation
after erasure; neither is served as provider content.

## Inbox commands

`inbox/command-store.server.ts` builds the atomic Inbox command store from
cohorts that share one runtime (`command-runtime.server.ts`: the transaction
authority check and the single-row transition runner): `assignment-commands`
(assign, bulk assign, release and manual reopen), `status-commands` (bulk
reopen, escalation and priority), `note-commands` and `source-commands`
(create, source projection, withdrawal, transition, reply observation and
receipts). Helpers shared with the other Inbox stores sit beside them in
`inbox/` (guards, cycle head, projection, histories, mappers).

## Review sync

`sync/` holds the code that reads Google into Review: `admit-review-sync`
(Integration's entry), discovery and the refresh sweep, provider snapshots and
their runs, head checks, targeted reads, the check of one review on Google,
provider subject keys and their inventory, the Google review port and the one
translation of a provider failure into the Review error
(`google-review-api-error.server.ts`), the review queue port, and the worker
runtime (`review-worker-runtime.server.ts`) that registers the Review jobs. Each
job is `<name>-job.server.ts`; "Review jobs and consumers" below names every
job and what it does.

## Reply publication

`publication/` holds the path from an approved Reply to Google: the publish job
with its pre-read and scope resolver, reconciliation of ambiguous attempts,
dispatch evidence, the Google reply observation store with its fence and clock,
cancellations and `publication-outbox-consumers.server.ts`.

## Reviews

`reviews/` holds the Review record: its repository, command store and Review
writer, the observation repository and its retention, the exact-current
authorities for reply observation, source transition and Response Targets, the
governed reads (eligible reviews, serving stats, Google rating reads and weekly
history) and the AI review source.

## Content lifecycle

`content/` holds provider content lifecycle: the content store, source-content
purge, the lifecycle store and its sweeps, the checkpointed lifecycle run
(`run-source-content-lifecycle.server.ts`), its report
(`collect-source-content-lifecycle-report.server.ts`) and the destructive
quarantine (`review-lifecycle-safety.server.ts`), expiry activation, and
operator recovery (evidence, approval and executor). Operator scripts reach the
run and the report through `public-api.ts`.

## Reply library

`library/` holds the manager's voice and templates: the library repository, the
layer operations, the template picker and draft check
(`layered-reply-template-operations.server.ts`), the template frame choices and
the AI reply frames. Its browser contract is `library/contracts.ts`, and the
resolver is `library/reply-library-resolver.contracts.ts`.

## Review

### Boundaries

- Property supplies only current source-epoch facts; Integration invokes Review's
  sync admission (`sync/admit-review-sync.server.ts`). All credential-bearing
  provider work stays in this deployment.
- Inbox receives content-free exact-current reply and Response Target authority
  (`reviews/reply-observation-authority.port.server.ts`,
  `reviews/response-target-authority.port.server.ts`); Metric may project a
  verified reputation fact but cannot infer provider truth.
- The source fence is the Property row locked `FOR NO KEY UPDATE`, always before
  Reply truth and the Review (ADR 0060). An exact-current authority runs its
  consumer on the Review transaction's own client, so it never waits for a
  second client while holding the fence.
- AI provider output is not a Reply. Only explicit adoption creates a draft, and
  Review receives only a boolean Portal Brand-current answer.
- Manager-authored Reply export and destructive lifecycle contributions stay
  outside `public-api.ts`; no request path may call them.
- Google-controlled content, provider identifiers, observations and reputation
  material are never exported as manager-authored data.
- Reporting reads the cache only through ports: `ReviewGoogleRatingReads`
  (`reviews/google-rating-reads.port.server.ts`; counts and star sums of
  servable Google reviews, no window sum under ten reviews, weekly history in
  `reviews/google-rating-week-history.server.ts`) and `ReviewServingStats`
  (`reviews/serving-stats.port.server.ts`; reply rate and reply time from the
  head's state and Google's time, never reply text). A review is replied once
  when its Google reply observation head is `live` or RepKey published a reply.

### Feature map

The server functions are the `reply*.ts` files in `server/`. The Reply commands
that need Inbox and Review truth together are in `replies/`; the observation,
source transition and Response Target authorities are in `reviews/`. Its pure
types, rules, events and errors are in `domain/`: `review-types.ts`,
`review-rules.ts`, `review-events.ts`, `review-errors.ts`, and the `reply-*`,
`discovery-*`, `head-*`, `google-reply-observation`, `material-review-revision`
and `snapshot-failure-backoff` modules.

| Feature                          | Server function (file in `server/`)                                                                                                     | Use case or store                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft, submit, confirm, edit     | `draftReplyFn`, `submitReplyFn`, `approveReplyFn`, `editPublishedReplyFn` (`reply-draft.ts`)                                            | `replies/reply-operations.server.ts`, `replies/reply-command-store.server.ts`, `replies/reply-writer.server.ts`                             |
| Reject, delete, try again        | `rejectReplyFn`, `deleteReplyFn`, `retryPublishFn` (`reply.ts`)                                                                         | `replies/reply-operations.server.ts`, `replies/reply-command-store.server.ts`                                                               |
| Check Google again               | `checkReplyPublicationFn` (`reply.ts`)                                                                                                  | `publication/check-reply-publication.server.ts`, `publication/reconcile-reply-publication.server.ts`                                        |
| Reply library (voice, templates) | `getReplyLibraryFn`, `saveReplyVoiceFn`, `saveReplyTemplateFn`, `setReplyTemplateHiddenFn`, `resetReplyTemplateFn` (`reply-library.ts`) | `library/reply-library-layer-operations.server.ts`, `library/reply-library-resolver.contracts.ts`                                           |
| Template picker and draft check  | `listReplyTemplatesFn`, `loadReplyTemplateFn`, `checkReplyDraftFn` (`reply-templates.ts`)                                               | `library/layered-reply-template-operations.server.ts`, `library/template-frame-choices.server.ts`, `replies/reply-content-policy.server.ts` |
| Check a review on Google (Inbox) | none (public API `ReviewGoogleReviewCheck`)                                                                                             | `sync/check-review-on-google.server.ts`                                                                                                     |

Reads for the Review screens go through `public-api.ts` and the eligible-read
helpers in `reviews/eligible-reads.server.ts`; no Review server function lists
Reviews.

### Review jobs and consumers

Registered by `registerReviewWorkerJobs`
(`sync/review-worker-runtime.server.ts`) and
`publication/publication-outbox-consumers.server.ts`. Each is named once here.

| Name                                    | Entry point                                                  | Does                                                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discover-new-reviews`                  | `sync/discover-new-reviews-job.server.ts`                    | 15-minute sweep: per due connected Property enqueue a sync, or write only a later `next_incremental_at` when a completed reconciliation is inside the window (`domain/discovery-reconciliation.ts`)         |
| `sync-property-reviews`                 | `sync/sync-property-reviews-job.server.ts`                   | Full snapshot, targeted read of one pushed review, or head check (`sync/run-review-provider-snapshot.server.ts`, `sync/run-targeted-google-review-fetch.server.ts`, `sync/run-review-head-check.server.ts`) |
| `refresh-expiring-reviews`              | `sync/refresh-expiring-reviews-job.server.ts`                | Hourly: pull a Property's next discovery look forward when its reviews near expiry and it was last reconciled over a day ago; enqueues no sync itself                                                       |
| `purge-expired-reviews`                 | `content/purge-expired-reviews-job.server.ts`                | Checkpointed source-content lifecycle (`content/run-source-content-lifecycle.server.ts`); defaults to read-only `report`, `shadow` compares provider copies                                                 |
| `expire-review-provider-source`         | `content/review-provider-lifecycle-sweeps-job.server.ts`     | Expire provider source content past its clock                                                                                                                                                               |
| `sweep-review-provider-tombstones`      | `content/review-provider-lifecycle-sweeps-job.server.ts`     | Sweep tombstoned provider subjects                                                                                                                                                                          |
| `publish-reply`                         | `publication/publish-reply-job.server.ts`                    | One guarded provider write for an approved current cycle, after a Google read recorded through the observation writer (`publication/publish-reply-preread.server.ts`)                                       |
| `reconcile-ambiguous-publications`      | `publication/reconcile-ambiguous-publications-job.server.ts` | Single-flight sweep (PostgreSQL session advisory lease) that settles uncertain attempts with provider reads only                                                                                            |
| `review.on-reply-publication-requested` | `publication/publication-outbox-consumers.server.ts`         | Re-admits the exact active cycle to the queue after a request-process interruption                                                                                                                          |
| `review.on-google-account-disconnected` | `publication/publication-outbox-consumers.server.ts`         | Cancels undispatched publication cycles for the disconnected account                                                                                                                                        |
| `review.on-property-archived`           | `publication/publication-outbox-consumers.server.ts`         | Cancels undispatched cycles of an archived Property or an older source epoch; each Reply returns to draft with one `review.reply.publication_cancelled` fact                                                |

Lifecycle recovery
(`content/{collect-lifecycle-recovery-evidence,prepare-lifecycle-recovery-approval,run-lifecycle-recovery-executor}.server.ts`)
is operator-driven and has no schedule. Operator commands (`scripts/ops/`):
`pnpm ops purge reviews-shadow --operator <id>` and `pnpm ops purge reviews`
(`enqueue-purge.ts`), `pnpm ops refresh reviews` (`enqueue-refresh.ts`),
`pnpm ops review-observations prune` (`review-observations.ts`; deletes repeated
`unchanged` observations), `pnpm ops reconcile-publication`
(`reconcile-publication.ts`), `pnpm ops rebuild-projection`
(`rebuild-projection.ts`).

Head checks store a reputation fact only behind `REVIEW_HEAD_CHECKS=persist`
(default dark). The writer rechecks the completed-listing proof and active
snapshot state first; when that fails it defers the fact and logs
`review_head_check_fact_not_recorded`. A delayed head page never replaces
numbers acquired later. Reconciliation-age health judges each Property against
its own window plus two hours (`REVIEW_RECONCILE_WITHIN_HOURS`); configure web
and worker alike.

A persisting head check follows to the next page (at most three) only when a
whole page was new, edited or reply-changed. A compared check that sees Google's
total below the stored live count stamps `review_sync_state.count_drop_seen_at`
and, 15 minutes later, requests a full read; `sync.count-drop-persistent` counts
Properties whose drop outlasted 72 hours of requested reads.

A full read is a provider snapshot run (`review_provider_snapshot_runs` and its
members; store in `sync/review-provider-snapshot*.server.ts`). A review Google
no longer lists keeps a counted hold on its provider mapping and a first-miss
time; removal needs two listings. A completed listing asks for a confirming full
read when a stored Review has a first miss it cannot confirm (the miss is less
than 15 minutes older than the listing's start); the sweep then runs that read
six hours after the listing, as it does for a count drop, instead of a whole
reconciliation window later. A listing that fails leaves the ask to the run that
completes next, and a later listing that misses the same Review again does not
ask twice. Nothing is written for a Property the sweep has never looked at. A
listing whose Google total or average moved mid-scan restarts without a failure
(`sync/snapshot-listing-change.server.ts`) unless the Property's runs keep
changing. The retention sweep (`sync/snapshot-run-retention-repository.server.ts`,
called from `src/shared/jobs/retention-sweep.job.ts`) deletes runs and members
no reader needs: it keeps the active run, the latest completed run of each
source epoch and the latest three runs of each Property.

### Review invariants

1. Period reads use half-open bounds; daily series bucket by the Property's
   calendar day (`properties.timezone`), not the UTC day.
2. A replay creates neither another observation nor another event; an older
   provider version cannot replace the current Review.
3. Serving reads deny provider content at its fetch-based hard expiry.
   Confirmed deletion or expiry removes the current cache and redacts
   provider-controlled values (including `content_expires_at`), keeping stable
   identity and manager history. An erased Review is a tombstone, not a
   readable `Review`.
4. Provider-subject HMAC mappings, not erased Google identifiers, reconnect a
   re-observation. A collision fails closed.
5. Reply text must pass `replyCommentProblem`
   (`src/shared/google-provider-control/reply-comment.ts`); draft save, submit,
   approve, edit-published and retry refuse anything else with `invalid_reply`.
6. A changed grounded Brand Profile invalidates the pending AI operation and
   creates no draft.
7. Every publication cycle atomically commits Reply state and its
   identifier-only intent. Older cycles cannot admit or acknowledge newer work.
   The authorization write compares the Reply's state revision, so a cycle
   authorizes exactly the text its caller read.
8. A provider write acknowledgement is recorded as `pending_observation`; it
   never marks the Reply published and never closes Inbox work.
9. A persisted `sending` attempt is an uncertain outcome. Only exact live truth
   (the `google-reply-v1` digest) confirms it and only a different live reply
   supersedes it; an absent, unreadable or whitespace-different reply decides
   nothing, and the row waits out a propagation grace and a re-read ladder
   before terminal ambiguity. No read outcome permits a second write for that
   attempt. RepKey resends only on positive non-dispatch evidence: no
   `reviews.reply` authorization permit for the attempt after the dispatch
   window (`REPLY_DISPATCH_EVIDENCE_WINDOW_MS`) and no recovery fence since.
   The guarantee is a lock: permit admission holds `FOR SHARE` on the attempt
   row, and the settle re-reads permits under the row lock. A `reviews.reply`
   permit is kept while its attempt may have dispatched, so the retention
   exclusion in the retention sweep must list every such state.
10. A stale observation or event cannot confirm a newer Reply cycle; application
    agreement alone is not closure authority.
11. Count or average drift during a reputation scan terminally fails the run.
    Zero Reviews is count `0` with average `null`.
12. Verified reputation facts contain no Review id, provider identifier,
    reviewer, rating distribution or text. `listing_complete` says whether a fact
    proves a listing; readers of Google's numbers order by
    `COALESCE(numbers_observed_at, evaluated_at)` so a long run cannot regress
    a fresher head fact.
13. Reply profile and template field rules come from `library/contracts.ts`; no
    other layer restates them.
14. Template edits and enabled-state changes are tenant-and-Property-scoped,
    versioned and attributed; an unchanged value leaves version and attribution
    unchanged.
15. Observing a Review again at the same source epoch and Material Review
    Revision never withdraws an AI-assisted Reply whose binding is current. Only
    an epoch or revision change, or source-content erasure, purges all AI
    drafts; the purge never deletes a Reply that publication evidence references.
16. Unedited AI text leaves RepKey only while its binding is current, or, once a
    worker has claimed it, after its adoption window alone has passed. A Reply
    whose AI text was withdrawn is blank, and a blank Reply is only a draft.
17. A guest edit returns every Reply awaiting approval or with a failed
    publication to draft with its text and one `source_changed` fact, and closes
    an attempt of unknown outcome as superseded.
18. A Reply is never written over a Google reply RepKey has not recorded: the
    publish worker reads and records the review before it claims, and the claim
    compares the observation head with the one the manager authorized against.
    The cycle ends as `provider_truth` with nothing sent. Only a reply typed
    between that read and Google's upsert can still be replaced.

### Review verification

Unit tests sit beside the code. PostgreSQL integration tests
(`*.integration.test.ts`, beside the code in its feature) cover immutable
authorization, claim and revocation races, observation confirmation, replay,
erasure and verified snapshots. The Reply workflow has a model-based suite whose
oracle is written by hand (`domain/reply-workflow-oracle.test-fixtures.ts`),
never taken from the production transition tables:
`domain/reply-workflow.property.test.ts` and
`replies/reply-workflow.model.integration.test.ts` (Review invariants 7 to 10),
with `domain/reply-publication-workflow.property.test.ts` checking every cell of
the persisted publication machine.

## Inbox

### Boundaries

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

### Feature map

The server functions are the `inbox-*.ts` files in `server/`, re-exported by
`server/inbox.ts`; the use cases, stores, read models, lookups, consumers and
projection rebuild live in `inbox/`, and Response Target code in
`response-targets/`. The screens are in `inbox/ui` (the page, queue, filter and
row primitives in `page/`), `replies/ui` and `src/routes/_authenticated/inbox/`;
`src/components/inbox` keeps only the reply actions hook. Its pure types, rules,
events and errors are in `domain/`: `inbox-types.ts`, `inbox-rules.ts`,
`inbox-events.ts`, `inbox-errors.ts`, `inbox-constructors.ts`,
`inbox-priority.ts`, `feedback-handling.ts`, `handling-cycles.ts`,
`handling-history.ts`, `handling-outcome-authority.ts` and `response-target.ts`.

| Feature                              | Server function (file in `server/`)                                                                                                                                       | Use case or store                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List, filters, cursors               | `getInboxItemsFn` (`inbox-queries.ts`)                                                                                                                                    | `inbox/get-inbox-items.server.ts`, `inbox/inbox-view-repository.server.ts`                                                                                       |
| Queue and property counts            | `getInboxQueueCountsFn`, `getInboxPropertyCountsFn` (`inbox-queries.ts`)                                                                                                  | `inbox/get-inbox-queue-counts.server.ts`, `inbox/get-inbox-property-counts.server.ts`, `inbox/inbox-queues.contracts.ts`                                         |
| New-item count since last visit      | `getLastVisitCountFn`, `stampLastInboxViewFn` (`inbox-queries.ts`)                                                                                                        | `inbox/get-last-visit-count.server.ts`, `inbox/stamp-last-inbox-view.server.ts`                                                                                  |
| Item detail, notes, Handling History | `getInboxItemDetailFn`, `getInboxNotesFn`, `getInboxItemHistoryFn` (`inbox-item-queries.ts`)                                                                              | `inbox/get-inbox-item-detail.server.ts`, `inbox/get-inbox-notes.server.ts`, `inbox/get-inbox-item-history.server.ts`, `inbox/inbox-history-repository.server.ts` |
| Assignment and notes                 | `assignInboxItemFn`, `bulkAssignInboxItemsFn`, `addInboxNoteFn` (`inbox-item-actions.ts`)                                                                                 | `inbox/assign-inbox-item.server.ts`, `inbox/bulk-assign-inbox-items.server.ts`, `inbox/add-inbox-note.server.ts`                                                 |
| Status, escalation                   | `updateInboxStatusFn`, `bulkUpdateInboxStatusFn`, `escalateInboxItemFn`, `resolveEscalationFn` (`inbox-status.ts`)                                                        | `inbox/update-inbox-status.server.ts`, `inbox/bulk-update-inbox-status.server.ts`, `inbox/escalate-inbox-item.server.ts`, `inbox/resolve-escalation.server.ts`   |
| Manager priority                     | `setInboxItemPriorityFn` (`inbox-priority.ts`)                                                                                                                            | `inbox/set-inbox-item-priority.server.ts`, `inbox/inbox-priority-history.server.ts`                                                                              |
| Private feedback outcome             | `markFeedbackHandledFn`, `correctFeedbackHandlingOutcomeFn` (`inbox-feedback-handling.ts`)                                                                                | `inbox/mark-feedback-handled.server.ts`, `inbox/correct-feedback-handling-outcome.server.ts`, `inbox/feedback-handling-store.server.ts`                          |
| Check a review on Google             | `checkReviewOnGoogleFn` (`inbox-google-check.ts`)                                                                                                                         | `inbox/check-inbox-review-on-google.server.ts` over `inbox/google-review-check.port.server.ts`                                                                   |
| Response Target policy and analytics | `getResponseTargetPolicySettingsFn`, `setResponseTargetPolicyFn`, `getPrivateFeedbackTargetAnalyticsFn`, `getGoogleReviewTargetAnalyticsFn` (`inbox-response-targets.ts`) | `response-targets/{set-response-target-policy,get-response-targets,policy.store,analytics.store}.server.ts`                                                      |

AI reading of a Review item (`aiInsights`, "Not right?" correction) is bound to
Review's current source epoch in `src/composition/get-inbox-review-analysis.server.ts`;
Inbox stores nothing of it.

### Inbox jobs and consumers

- **Job:** `release-response-target-reminders`
  (`response-targets/release-reminders.job.server.ts`, use case
  `release-reminders.server.ts`), every five minutes. A Google-review reminder
  is checked against Google first and held while Review shows a live reply that
  answers the cycle; private-feedback slots are never checked; no transaction is
  held across the Google read.
- **Durable consumers** (registered in `build-inbox.ts` through
  `registerOutboxConsumers`, apply-once): `inbox.on-review-created`,
  `inbox.on-review-updated`, `inbox.on-review-expired`,
  `inbox.on-review-source-transitioned`, `inbox.on-reply-published`,
  `inbox.on-reply-observed`, `inbox.on-reply-submitted`
  (`inbox/outbox-consumers.server.ts`); `inbox.on-guest-feedback-submitted`,
  `inbox.on-guest-feedback-retracted`
  (`inbox/guest-feedback-outbox-consumers.server.ts`); `inbox.on-member-removed`
  (`inbox/member-offboarding-outbox-consumers.server.ts`);
  `inbox.on-property-archived`
  (`response-targets/property-lifecycle-outbox-consumers.server.ts`).
- **Maintenance:** `rebuildInboxProjection`
  (`inbox/rebuild-inbox-projection.server.ts`, `pnpm ops rebuild-projection`)
  repairs from canonical data and records no facts;
  `pnpm ops inbox exclude-restated-revision-targets <propertyId>`
  (`response-targets/restated-revision-target-exclusion-store.server.ts`) writes
  `inbox_response_target_exclusions`.

### Queues

Each queue is a key in `INBOX_QUEUES` (`inbox/inbox-queues.contracts.ts`) that
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

### Inbox invariants

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

### Inbox verification

Unit tests sit beside domain rules, use cases, consumers, jobs, server contracts
and Handling History; PostgreSQL integration tests cover command atomicity,
authorization and revision races, exact-current Review callbacks, feedback
outcomes, Response Targets and lifecycle. These describe repository wiring, not
hosted activation evidence; deployed scheduler ticks, worker health and
delivery are evidenced separately (see the operations doc above).
