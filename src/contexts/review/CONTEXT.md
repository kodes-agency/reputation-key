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
  sync admission (`../reputation/sync/admit-review-sync.server.ts`). All
  credential-bearing provider work stays in this deployment.
- Inbox receives content-free exact-current reply and Response Target authority
  (`../reputation/reviews/reply-observation-authority.port.server.ts`,
  `../reputation/reviews/response-target-authority.port.server.ts`); Metric may project a
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
  (`../reputation/reviews/google-rating-reads.port.server.ts`; counts and star
  sums of servable Google reviews, no window sum under ten reviews, weekly history
  in `../reputation/reviews/google-rating-week-history.server.ts`) and
  `ReviewServingStats` (`../reputation/reviews/serving-stats.port.server.ts`; reply
  rate and reply time from the
  head's state and Google's time, never reply text). A review is replied once
  when its Google reply observation head is `live` or RepKey published a reply.

## Feature map

Server functions live in `server/`. The code behind them lives in Reputation:

- `../reputation/sync/`: discovery, snapshots, head checks, targeted reads, the
  refresh sweep, provider subject keys and `review-worker-runtime.server.ts`.
- `../reputation/publication/`: the publish job and its pre-read, reconciliation,
  dispatch evidence, the Google reply observation store, cancellations and
  `publication-outbox-consumers.server.ts`.
- `../reputation/replies/`: Reply commands, command store, repository, writer and
  AI drafts.
- `../reputation/library/`: voice, templates and AI frames.
- `../reputation/reviews/`: repository, Review writer, observations, authorities,
  eligible, serving and rating reads, and the AI source.
- `../reputation/content/`: content lifecycle, purge and recovery.

`build.ts` assembles provider transport, source authorities, consumer
registration and the `registerWorkerJobs` contribution; `build-reply-use-cases.server.ts` builds the
Reply workflow and library commands and keeps worker and maintenance
capabilities out of `publicApi.reply`. The Reply commands that need Inbox and
Review truth together are in `../reputation/replies/`; the observation, source
transition and Response Target authorities are in `../reputation/reviews/`. Its
pure types, rules, events and errors are in `../reputation/domain/`:
`review-types.ts`, `review-rules.ts`, `review-events.ts`, `review-errors.ts`, and
the `reply-*`, `discovery-*`, `head-*`, `google-reply-observation`,
`material-review-revision` and `snapshot-failure-backoff` modules.

| Feature                          | Server function (file in `server/`)                                                                                                     | Use case or store (in `../reputation/`)                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft, submit, confirm, edit     | `draftReplyFn`, `submitReplyFn`, `approveReplyFn`, `editPublishedReplyFn` (`reply-draft.ts`)                                            | `replies/reply-operations.server.ts`, `replies/reply-command-store.server.ts`, `replies/reply-writer.server.ts`                                   |
| Reject, delete, try again        | `rejectReplyFn`, `deleteReplyFn`, `retryPublishFn` (`reply.ts`)                                                                         | `replies/reply-operations.server.ts`, `replies/reply-command-store.server.ts`                                                                     |
| Check Google again               | `checkReplyPublicationFn` (`reply.ts`)                                                                                                  | `publication/check-reply-publication.server.ts`, `publication/reconcile-reply-publication.server.ts`                                              |
| Reply library (voice, templates) | `getReplyLibraryFn`, `saveReplyVoiceFn`, `saveReplyTemplateFn`, `setReplyTemplateHiddenFn`, `resetReplyTemplateFn` (`reply-library.ts`) | `library/reply-library-layer-operations.server.ts`; `layered-reply-template-operations.ts` and `reply-library-resolver.ts` stay in `application/` |
| Template picker and draft check  | `listReplyTemplatesFn`, `loadReplyTemplateFn`, `checkReplyDraftFn` (`reply-templates.ts`)                                               | `library/template-frame-choices.server.ts`, `replies/reply-content-policy.server.ts`                                                              |
| Check a review on Google (Inbox) | none (public API `ReviewGoogleReviewCheck`)                                                                                             | `sync/check-review-on-google.server.ts`                                                                                                           |

Reads for the Review screens go through `application/public-api.ts` and the
eligible-read helpers in `../reputation/reviews/eligible-reads.server.ts`; no
server function in this context lists Reviews.

### Still in `application/`

Twelve files stay, each because the browser, a foreign adapter or an operator
script reaches it and a `*.server.ts` file in Reputation could not be imported
there. Screen folders named below (`library/ui`, `replies/ui`) are in
`../reputation/`.

- `public-api.ts`: other areas and `scripts/ops/restore-verify.ts` import it. It stays
  here until Review's server functions move into Reputation and it folds into
  `reputation/public-api.ts`.
- `dto/reply-library.dto.ts`: `library/ui` and `replies/ui` screens import it and
  the public API re-exports it; `server/reply-library.ts` and `reply-templates.ts`
  import it, so it cannot be a contract.
- `reply-library-resolver.ts`: the `library/ui` stories fixture is a browser entry
  point and runs it; it imports the DTO and the library port.
- `google-review-api-error.ts`: the public API re-exports its functions as values,
  and `replies/ui/use-reply-composer.ts` reaches it through the public API.
- `ports/google-review-api.port.ts`: the public API re-exports values from it,
  Integration's review-sync adapters implement it, and a foreign adapter may import
  only `application/ports/`. `google-provider-seams.test.ts` reads it by path.
- `ports/reply-writer.port.ts`: the public API re-exports
  `UNCERTAIN_ATTEMPT_OUTCOMES` as a value, which makes it browser-reachable.
- `ports/review-queue.port.ts`: the public API re-exports
  `GBP_PUSH_SYNC_INITIATOR_ID` as a value; Integration enqueues through it.
- `ports/targeted-google-review-reference.port.ts`: Integration's push target
  resolver adapter implements it, and a foreign adapter may import only
  `application/ports/`.
- `review-lifecycle-safety.ts`: browser-reachable through
  `run-source-content-lifecycle.ts`, which the public API re-exports as a value.
- `use-cases/run-source-content-lifecycle.ts`: the public API re-exports
  `REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE` as a value;
  `scripts/ops/enqueue-purge.ts` imports it, and operator scripts may not import
  feature `*.server.ts` files. `single-entry-authorities.test.ts` names it as the
  only `applyLifecycleBatch` caller.
- `use-cases/collect-source-content-lifecycle-report.ts`: the public API
  re-exports it as a value and `scripts/ops/enqueue-purge.ts` imports it.
- `use-cases/layered-reply-template-operations.ts`: `replies/ui/composer` files
  type-import `ReplyTemplateListResult` from it, and feature UI may not import a
  `*.server.ts`, even for types. Its dependencies moved, which lint allows for an
  application file.

## Jobs and consumers

Registered by `registerReviewWorkerJobs`
(`../reputation/sync/review-worker-runtime.server.ts`) and
`../reputation/publication/publication-outbox-consumers.server.ts`. Each is named
once here.

| Name                                    | Entry point (in `../reputation/`)                            | Does                                                                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discover-new-reviews`                  | `sync/discover-new-reviews-job.server.ts`                    | 15-minute sweep: per due connected Property enqueue a sync, or write only a later `next_incremental_at` when a completed reconciliation is inside the window (`../reputation/domain/discovery-reconciliation.ts`) |
| `sync-property-reviews`                 | `sync/sync-property-reviews-job.server.ts`                   | Full snapshot, targeted read of one pushed review, or head check (`sync/run-review-provider-snapshot.server.ts`, `sync/run-targeted-google-review-fetch.server.ts`, `sync/run-review-head-check.server.ts`)       |
| `refresh-expiring-reviews`              | `sync/refresh-expiring-reviews-job.server.ts`                | Hourly: pull a Property's next discovery look forward when its reviews near expiry and it was last reconciled over a day ago; enqueues no sync itself                                                             |
| `purge-expired-reviews`                 | `content/purge-expired-reviews-job.server.ts`                | Checkpointed source-content lifecycle (`application/use-cases/run-source-content-lifecycle.ts`); defaults to read-only `report`, `shadow` compares provider copies                                                |
| `expire-review-provider-source`         | `content/review-provider-lifecycle-sweeps-job.server.ts`     | Expire provider source content past its clock                                                                                                                                                                     |
| `sweep-review-provider-tombstones`      | `content/review-provider-lifecycle-sweeps-job.server.ts`     | Sweep tombstoned provider subjects                                                                                                                                                                                |
| `publish-reply`                         | `publication/publish-reply-job.server.ts`                    | One guarded provider write for an approved current cycle, after a Google read recorded through the observation writer (`publication/publish-reply-preread.server.ts`)                                             |
| `reconcile-ambiguous-publications`      | `publication/reconcile-ambiguous-publications-job.server.ts` | Single-flight sweep (PostgreSQL session advisory lease) that settles uncertain attempts with provider reads only                                                                                                  |
| `review.on-reply-publication-requested` | `publication/publication-outbox-consumers.server.ts`         | Re-admits the exact active cycle to the queue after a request-process interruption                                                                                                                                |
| `review.on-google-account-disconnected` | `publication/publication-outbox-consumers.server.ts`         | Cancels undispatched publication cycles for the disconnected account                                                                                                                                              |
| `review.on-property-archived`           | `publication/publication-outbox-consumers.server.ts`         | Cancels undispatched cycles of an archived Property or an older source epoch; each Reply returns to draft with one `review.reply.publication_cancelled` fact                                                      |

Lifecycle recovery
(`content/{collect-lifecycle-recovery-evidence,prepare-lifecycle-recovery-approval,run-lifecycle-recovery-executor}.server.ts`
in `../reputation/`) is operator-driven and has no schedule. Operator commands (`scripts/ops/`):
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
members; store in `../reputation/sync/review-provider-snapshot*.server.ts`). A
review Google no longer lists keeps a counted hold on its provider mapping and a
first-miss time; removal needs two listings. A completed listing asks for a
confirming full read when a stored Review has a first miss it cannot confirm
(the miss is less than 15 minutes older than the listing's start); the sweep
then runs that read six hours after the listing, as it does for a count drop,
instead of a whole reconciliation window later. A listing that fails leaves the
ask to the run that completes next, and a later listing that misses the same
Review again does not ask twice. Nothing is written for a Property the sweep
has never looked at. A listing whose
Google total or average moved mid-scan restarts without a failure
(`../reputation/sync/snapshot-listing-change.server.ts`) unless the Property's runs keep
changing. The retention sweep (`../reputation/sync/snapshot-run-retention-repository.server.ts`,
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
(`*.integration.test.ts`, beside the code in `../reputation/<feature>/`) cover immutable authorization,
claim and revocation races, observation confirmation, replay, erasure and
verified snapshots. The Reply workflow has a model-based suite whose oracle is
written by hand (`../reputation/domain/reply-workflow-oracle.test-fixtures.ts`), never taken
from the production transition tables: `../reputation/domain/reply-workflow.property.test.ts`
and `../reputation/replies/reply-workflow.model.integration.test.ts` (invariants 7 to
10), with `../reputation/domain/reply-publication-workflow.property.test.ts` checking every
cell of the persisted publication machine.
