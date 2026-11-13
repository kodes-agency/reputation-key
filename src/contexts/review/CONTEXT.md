# Review — Context

**Audience:** Developers and agents working in `src/contexts/review/`.

A feature map: where each feature lives and the rules it must keep. The longer
narrative of earlier versions of this file is at the protected tag
`docs-archive-2026-11-05` (`git show docs-archive-2026-11-05:src/contexts/review/CONTEXT.md`).
Decisions are in `docs/adr/` (0055 handling cycles and reply truth, 0060
property fence, 0067 Google rating goal); operations are in
[`docs/operations/runbooks.md`](../../../docs/operations/runbooks.md) and
[`docs/operations/review-lifecycle-recovery-approval.md`](../../../docs/operations/review-lifecycle-recovery-approval.md).

## Responsibility

Stable external-review identity, provider observation and content lifecycle, and
the RepKey-owned Reply workflow. Provider-controlled content is a bounded cache,
never the identity or history authority.

## Boundaries

- Property supplies only current source-epoch facts; Integration invokes Review's
  sync admission (`application/use-cases/admit-review-sync.ts`). All
  credential-bearing provider work stays in this deployment.
- Inbox receives content-free exact-current reply and Response Target authority
  (`application/ports/reply-observation-authority.port.ts`,
  `application/ports/response-target-authority.port.ts`); Metric may project a
  verified reputation fact but cannot infer provider truth.
- The source fence is the Property row locked `FOR NO KEY UPDATE`, always before
  Reply truth and the Review (ADR 0060). An exact-current authority runs its
  consumer on the Review transaction's own client, so it never waits for a
  second client while holding the fence.
- AI provider output is not a Reply. Only explicit adoption creates a draft, and
  Review receives only a boolean Portal Brand-current answer.
- Manager-authored Reply export and destructive lifecycle contributions stay
  outside `application/public-api.ts`; no request path may call them.
- Google-controlled content, provider identifiers, observations and reputation
  material are never exported as manager-authored data.
- Reporting reads the cache only through ports: `ReviewGoogleRatingReads`
  (`application/ports/google-rating-reads.port.ts`; counts and star sums of
  servable Google reviews, no window sum under ten reviews, weekly history in
  `application/google-rating-week-history.ts`) and `ReviewServingStats`
  (`application/ports/serving-stats.port.ts`; reply rate and reply time from the
  head's state and Google's time, never reply text). A review is replied once
  when its Google reply observation head is `live` or RepKey published a reply.

## Feature map

Server functions live in `server/`; use cases in `application/use-cases/`;
stores, jobs and consumers in `infrastructure/`. `build.ts` assembles provider
transport, source authorities, consumer registration and the
`registerWorkerJobs` contribution; `build-reply-use-cases.server.ts` builds the
Reply workflow and library commands and keeps worker and maintenance
capabilities out of `publicApi.reply`. The Reply commands that need Inbox and
Review truth together are in `../reputation/replies/`; the observation, source
transition and Response Target authorities are in `../reputation/reviews/`.

| Feature                          | Server function (file in `server/`)                                                                                                     | Use case or store                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Draft, submit, confirm, edit     | `draftReplyFn`, `submitReplyFn`, `approveReplyFn`, `editPublishedReplyFn` (`reply-draft.ts`)                                            | `reply-operations.ts`, `reply-command-store.ts`, `reply-writer.ts`                                       |
| Reject, delete, try again        | `rejectReplyFn`, `deleteReplyFn`, `retryPublishFn` (`reply.ts`)                                                                         | `reply-operations.ts`, `reply-command-store.ts`                                                          |
| Check Google again               | `checkReplyPublicationFn` (`reply.ts`)                                                                                                  | `check-reply-publication.ts`, `reconcile-reply-publication.ts`                                           |
| Reply library (voice, templates) | `getReplyLibraryFn`, `saveReplyVoiceFn`, `saveReplyTemplateFn`, `setReplyTemplateHiddenFn`, `resetReplyTemplateFn` (`reply-library.ts`) | `reply-library-layer-operations.ts`, `layered-reply-template-operations.ts`, `reply-library-resolver.ts` |
| Template picker and draft check  | `listReplyTemplatesFn`, `loadReplyTemplateFn`, `checkReplyDraftFn` (`reply-templates.ts`)                                               | `template-frame-choices.ts`, `reply-content-policy.ts`                                                   |
| Check a review on Google (Inbox) | none (public API `ReviewGoogleReviewCheck`)                                                                                             | `check-review-on-google.ts`                                                                              |

Reads for the Review screens go through `application/public-api.ts` and the
eligible-read helpers in `application/eligible-reads.ts`; no server function in
this context lists Reviews.

## Jobs and consumers

Registered by `registerReviewWorkerJobs` (`infrastructure/worker-runtime.ts`)
and `infrastructure/outbox-consumers.ts`. Each is named once here.

| Name                                    | Entry point (`infrastructure/jobs/` unless noted) | Does                                                                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discover-new-reviews`                  | `discover-new-reviews.job.ts`                     | 15-minute sweep: per due connected Property enqueue a sync, or write only a later `next_incremental_at` when a completed reconciliation is inside the window (`domain/discovery-reconciliation.ts`) |
| `sync-property-reviews`                 | `sync-property-reviews.job.ts`                    | Full snapshot, targeted read of one pushed review, or head check (`run-review-provider-snapshot.ts`, `run-targeted-google-review-fetch.ts`, `run-review-head-check.ts`)                             |
| `refresh-expiring-reviews`              | `refresh-expiring-reviews.job.ts`                 | Hourly: pull a Property's next discovery look forward when its reviews near expiry and it was last reconciled over a day ago; enqueues no sync itself                                               |
| `purge-expired-reviews`                 | `purge-expired-reviews.job.ts`                    | Checkpointed source-content lifecycle (`run-source-content-lifecycle.ts`); defaults to read-only `report`, `shadow` compares provider copies                                                        |
| `expire-review-provider-source`         | `review-provider-lifecycle-sweeps.job.ts`         | Expire provider source content past its clock                                                                                                                                                       |
| `sweep-review-provider-tombstones`      | `review-provider-lifecycle-sweeps.job.ts`         | Sweep tombstoned provider subjects                                                                                                                                                                  |
| `publish-reply`                         | `publish-reply.job.ts`                            | One guarded provider write for an approved current cycle, after a Google read recorded through the observation writer (`publish-reply-preread.ts`)                                                  |
| `reconcile-ambiguous-publications`      | `reconcile-ambiguous-publications.job.ts`         | Single-flight sweep (PostgreSQL session advisory lease) that settles uncertain attempts with provider reads only                                                                                    |
| `review.on-reply-publication-requested` | `outbox-consumers.ts`                             | Re-admits the exact active cycle to the queue after a request-process interruption                                                                                                                  |
| `review.on-google-account-disconnected` | `outbox-consumers.ts`                             | Cancels undispatched publication cycles for the disconnected account                                                                                                                                |
| `review.on-property-archived`           | `outbox-consumers.ts`                             | Cancels undispatched cycles of an archived Property or an older source epoch; each Reply returns to draft with one `review.reply.publication_cancelled` fact                                        |

Lifecycle recovery (`collect-lifecycle-recovery-evidence.ts`,
`prepare-lifecycle-recovery-approval.ts`, `run-lifecycle-recovery-executor.ts`)
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
members; store in `infrastructure/repositories/review-provider-snapshot*.ts`). A
review Google no longer lists keeps a counted hold on its provider mapping and a
first-miss time; removal needs two listings, and a listing that recorded a
first miss requests one more full read. A listing whose
Google total or average moved mid-scan restarts without a failure
(`application/snapshot-listing-change.ts`) unless the Property's runs keep
changing. The retention sweep (`infrastructure/repositories/snapshot-run-retention.repository.ts`,
called from `src/shared/jobs/retention-sweep.job.ts`) deletes runs and members
no reader needs: it keeps the active run, the latest completed run of each
source epoch and the latest three runs of each Property.

## Invariants

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
13. Reply profile and template field rules come from
    `application/dto/reply-library.dto.ts`; no other layer restates them.
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

## Verification

Unit tests sit beside the code. PostgreSQL integration tests
(`*.integration.test.ts` in `infrastructure/`) cover immutable authorization,
claim and revocation races, observation confirmation, replay, erasure and
verified snapshots. The Reply workflow has a model-based suite whose oracle is
written by hand (`domain/__fixtures__/reply-workflow-oracle.ts`), never taken
from the production transition tables: `domain/reply-workflow.property.test.ts`
and `infrastructure/reply-workflow.model.integration.test.ts` (invariants 7 to
10), with `domain/reply-publication-workflow.property.test.ts` checking every
cell of the persisted publication machine.
