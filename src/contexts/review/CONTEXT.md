# Review — Context

**Audience:** Developers and agents working in `src/contexts/review/`.

## Responsibility

Stable external-review identity, provider observation/content lifecycle, and
RepKey-owned Reply workflow. Provider-controlled content is a bounded cache; it
is not the identity or history authority.

## Boundaries

- Property supplies only current source-epoch facts; Integration invokes Review's
  sync admission contracts. All credential-bearing provider work stays in this
  deployment.
- Inbox receives content-free exact-current reply and Response Target authority;
  Metric may project a verified reputation fact but cannot infer provider truth.
- The source fence is the Property row locked `FOR NO KEY UPDATE`, always
  before Reply truth and the Review. It excludes other fence holders and epoch
  writers but not foreign-key checks. An exact-current authority checks out
  both pool clients before it takes the fence, so it never waits for the
  consumer's client while holding it (ADR 0060).
- AI provider output is not a Reply. Only explicit adoption may create a draft,
  and Review receives only a boolean Portal Brand-current answer.
- Manager-authored Reply export and destructive lifecycle contributions stay
  outside `publicApi`; no request path may call them.
- Google-controlled Review/reply content, provider identifiers, observations, and
  reputation material are never exported as manager-authored data.

## Model

A stable Review survives source deletion and content expiry. Erasable source
content and immutable observations attach to numbered Material Review Revisions;
material changes and source-epoch carries create exact immutable bindings.

The Inbox projection permit covers the Review's revision history 1..N across
source epochs, ending at the current revision in the event's epoch, and Review
attests each carry (`sourceEpochCarry`, `infrastructure/source-epoch-carry.ts`,
shared with the reply-observation permit): the predecessor sits in an older
epoch and held the same normalized digest, or, for a predecessor recorded
before material digests existed, the observation that created the revision
recorded no material change. A guest edit is never a carry, including one
first seen in the new epoch, so `review.updated` reaches the Inbox after an
Archive/Restore, a relink or a reconnect.

Each revision's Response Target eligibility is fixed when it is created. The
first Google import of a Property source epoch fixes that epoch's history cutoff
(`review_provider_history_cutoffs`) when Review admits the import's sync, before
any run can observe the epoch, and the cutoff outlives the run. Whichever run
first observes a Review in the epoch, a first revision dated at or before the
cutoff is silent, unmeasured `historical_onboarding` only while the import is
still listing that history and only when Google published it before the
Property's first import. One a relink finds from while the Property was
disconnected, or one Google lists after that history was listed in full, is
`legacy_unknown`: unmeasured, but announced. Later revisions, and Reviews
published after the cutoff, are measured
(`docs/operations/inbox-response-targets.md`).

The end of that first import is itself a fact:
`review.property_history_import.finished`, written by the transaction that
makes a snapshot run terminal — `failLockedRun`, and the completion branch of
`applyDeletionBatch` — carrying identifiers, the unique reviews the run had
listed, and, on failure, one of four closed reasons
(`application/historical-import-outcome.ts`). It is what Feed announces in
place of the per-review flood PR #597 suppressed (ADR 0046, amended
2026-09-24). Which run ends the import needs no new column: the run's epoch has
a history cutoff, no earlier epoch of the Property has one, and no completed
run has listed that history yet — the verified reputation fact each completed
run writes is that proof, read before this run writes its own. A failure also
requires the run's own origin to be `historical_onboarding`, so an ordinary
poll failing on an imported Property is not the import failing.

An internal Reply moves from draft through approval and a numbered publication
cycle. Provider acknowledgement enters `pending_observation`; only an exact current
Google Reply Observation proves publication. Publication authorizations, attempts,
and observations are append-only evidence with tenant, source, material, Reply,
and cycle fences.
Terminal/ambiguous outcomes may enter `publish_failed`; rejected replies can be re-drafted.

Each reply command starts only from the states it names
(`domain/reply-command-preconditions.ts`): a draft save from a draft or a
rejected reply with no open publication, submit from such a draft, Confirm &
Publish and reject from `pending_approval`, Try publishing again from a settled
`publish_failed`, edit-and-republish from `published`, delete from a draft or a
rejected reply that was never authorized. The use case refuses anything else
with `invalid_transition`. The store does not trust the use case: every guarded
write (`infrastructure/reply-write-guards.ts`) repeats the rule as its
compare-and-set on status, publication state and cycle, and a publication write
also on the exact state and attempt count it read. A second entry point, or a
change between the read and the write, therefore matches no row and records no
fact. The status table (`REPLY_TRANSITIONS`) only says which status may follow
which; it has no `approved → draft`, because a Reply returns to draft only when
its open cycle is cancelled (`cancelledPublication`).

Confirm & Publish is bound to the Reply the manager read. The Inbox sends the
Reply's state revision as it stood when the confirmation was opened
(`expectedStateRevision`); the use case refuses a Reply that has moved past it
with the same error as a lost race, and the store's authorization write (an
approval, a retry or an edit) compares the state revision of the Reply it was
given. A Reply that was rejected, rewritten and submitted again while a
confirmation stood open is pending again in the same cycle; only that revision
tells it apart, and the authorization digests whatever text the row holds. A
caller with no screen (a seed, a script) sends no revision and confirms the
stored Reply.

An AI-assisted Reply is the unedited text of one AI suggestion a manager
adopted as a draft (`authorship = 'ai_assisted'`). AI output is advisory (ADR
0031; AI CONTEXT, Invariants 5 and 6), so that text stays held by the AI draft
binding (`infrastructure/ai-draft-binding.ts`): everything it was generated
from must still be current, and its ten-minute adoption window must not have
passed. The binding is a gate on AI text moving toward Google, not a lock on
the Reply, and `domain/reply-ai-text.ts` says which command does what:

- **It gates the three steps that move unedited AI text toward Google**:
  submit, Confirm & Publish, and the publish worker's claim. A stale binding
  refuses the first two with `ai_suggestion_stale` and a sentence that names
  the way out; the claim sends nothing and leaves the cycle `authorized`, which
  the sweep ends as `not_sent`.
- **Adoption ends when a manager acts on the text as their own.** A draft save
  (typing over the draft, or Edit & resubmit on a rejected Reply), Try
  publishing again and edit-and-republish never read the binding. Each records
  the Reply as human-authored and clears its AI provenance, through the same
  set clause (`reply-set-clause.ts`). `ai_assisted` therefore always means
  "still held by the binding", which is what the schema (every such row has an
  expiry), the AI draft purge and the worker's claim take it to mean.
- **Reject and delete never read it.** An approver can always send a Reply
  back.

So a stale AI draft can be typed over, a pending one rejected, and a Reply a
manager confirmed can be tried again or edited whenever its publication failed
or succeeded; none of that waits on a window that closed. A published
AI-assisted Reply nobody acted on again keeps its label, and nothing reads its
binding again. What the window still decides is whether AI text nobody has
touched may be put forward as it is.

A Reply that was ever authorized is never deleted. Its authorization and attempt
rows are the evidence of what a manager confirmed and what was sent, and they
reference it `ON DELETE RESTRICT`. A cancelled publication leaves such a Reply
as a draft; Delete is refused there with a sentence that says so, and the Reply
stays editable and can be submitted again.
The `review.reply.publish_failed` fact says how the publication ended, in a closed
`outcome`: `not_sent` (nothing was posted: never dispatched, or retryable
failures, an answered 429 included, ran out), `refused` (a terminal rejection by Google or by RepKey before sending), or
`unconfirmed` (ambiguous; the reply may be live and is never sent twice). The
notice words each one; none of them says Google rejected the reply.

The decision and publication facts (approved, rejected, published, publish
failed, publication cancelled) carry `authorId`, the reply's author as
`domain/reply-author.ts` defines it: whoever last submitted it
(`replies.submitted_by`, set by submit and kept by an edit-and-republish),
else its creator when no submitter was recorded. Feed addresses the outcome
notices to it. The Organization purge nulls `submitted_by` and the
Organization export includes it.

A guest edit does not inherit the answer to the revision it replaced. A live
Google reply whose text equals the previous head's, recorded in the same source
epoch at an earlier revision, is carried over, not added: it resolves
`unchanged` and raises no `review.reply.observed`, so it cannot close the cycle
the edit reopened in the Inbox. A changed reply, a reply first seen at the new
revision, or a RepKey reply confirmed for it answers the edit. A head from
another source epoch keeps the old reading, because Inbox carries its head on
that observation.

A failed provider write is classified by what actually reached Google (the
provider plane's `dispatch`: `not_sent`, `answered` with a status, or `unknown`).
A request RepKey refused before sending is retryable, except a malformed request,
which is a terminal rejection; a 4xx answer other than 429 is terminal; a 429 is
retryable; an unknown dispatch or any other answer is uncertain. An uncertain
attempt is never written again unless there is positive evidence it never left
RepKey (see Invariant 9). A write refused because the Google connection waits
for an AccountAdmin to reconnect it (`reauthorization_required`, whether refused
before sending or answered 401 for a revoked grant) is a terminal rejection,
and its `publish_failed` fact carries cause `google_reauthorization_required` so
the author is told to have Google reconnected rather than that Google rejected
the reply.

A Property reply library has at most one rendering profile and a retained set of
enabled or disabled templates. Settings edits templates by ID, so a title rename
updates in place. The operations importer deliberately remains title-keyed for
repeatability: re-importing a manager-renamed template&rsquo;s former source title
creates a separate row and never overwrites the renamed template.

## Runtime

`buildReviewContext` captures Review repositories, queues, use cases, and foreign public ports in one `registerWorkerJobs` runtime contribution. Composition supplies the canonical registry/background queue and Bootstrap invokes this one method with the parsed discovery interval; neither layer reconstructs Review job dependencies.

- **sync-property-reviews** — Fetches reviews from Google for a specific property/location. Triggered by `property.created` event or `refresh-expiring-reviews` job.
- **refresh-expiring-reviews** — Finds reviews expiring within 5 days, enqueues sync jobs to refresh them. Runs daily.
- **purge-expired-reviews** — compatibility entry point for the single Review source-content lifecycle authority. It keyset-checkpoints a frozen window and its recurring job accepts content-free eligibility `report` and expand/cache/observation/revision/legacy-reply `shadow` evidence only. Checkpoints bind mode, scope, window, and `(createdAt, ReviewId)` cursor. The connection/Property/Organization compatibility adapter and legacy raw-expiry repository seam also delegate here and are report-only in ordinary composition. The local authority has a bounded whole-page atomic `apply` path, but every page fails closed without both the exact apply confirmation and an injected approval seal that is revalidated on continuation; ordinary production composition supplies neither. The shared erasure/reconciliation/re-observation transaction has real-PostgreSQL concurrency, rollback, replay, and stable-identity coverage. Recurring activation still requires the REV-01 external shadow-parity seal, restore/erasure proof, and explicit cutover approval.
- **review.on-reply-publication-requested** — Durable worker consumer that independently recovers queue admission after a request-process interruption. It reloads the authoritative reply and only admits the intent's exact active cycle. Queue-add/receipt ambiguity is fenced by the deterministic reply+cycle BullMQ job ID.
- **review.on-property-archived** — Durable worker consumer that cancels, as a Google disconnect does (`findUndispatchedPublicationsByReviewIds`, cause `disconnect`), every publication cycle of the Property's reviews that is not yet dispatched (`requested`/`authorized`) and either belongs to a Property that is not active or was authorized at a source epoch the Property has since moved past (Archive and Restore both advance it). The Reply returns to draft and one `review.reply.publication_cancelled` fact (cause `policy`) is recorded per Reply, so the provider authorizer's refusal is never reported to the author as a Google rejection. Every cancellation fact carries the Reply's author (identifier only, null when unknown or on facts recorded before the field existed): the author was last told the reply was queued to publish to Google, so Feed has to be able to find them again. Because the rule keys on the epoch, a fact delivered after a quick Restore still clears the pre-archive cycles and leaves a reply approved at the restored epoch alone. A dispatched cycle (`sending`/`pending_observation`) may already be on Google and stays with the worker and the reconciliation sweep, which end it with the `unconfirmed` publish-failed notice when no read can prove it.
- **publish-reply** — Executes one guarded provider write for an approved current cycle. Claim revalidates the cycle's named manager against current membership, effective `reply.manage`, and Property scope in the claim transaction, and locks the Property to require it active at the cycle's source epoch; either denial cancels the cycle (cause `policy`) without provider egress. If an Archive or Restore commits after the claim, the provider authorizer refuses the write before sending (`stale_source`); the job cancels that cycle as `policy` too, never as a Google rejection. A fresh authorized attempt may write once. BullMQ allows five executions (exponential from 30 s with 0.5 jitter, so 15-30 s before the second); only a retryable failure spends them on another write, and a terminal rejection resolves at once. A persisted `sending` attempt is uncertain and is never written again: the job first asks for dispatch evidence (settling a never-dispatched attempt as not published), then makes one targeted read. An absent, unreadable or failed read inside the 15-minute propagation grace keeps the row `sending`, due in one minute and re-read on the sweep's next five-minute run; past the grace it becomes `ambiguous`, due at the next ladder rung after the attempt's age. Acknowledged writes remain `pending_observation`.
- **reconcile-ambiguous-publications** — Globally single-flight across replicas through a PostgreSQL session advisory lease. It keyset-walks due `requested`/`authorized` rows (ended as a retryable failure with no provider read, but only while still unclaimed: the write compares the exact state and attempt count the sweep read, so a row a worker claimed after the batch was read is left alone and comes back as an uncertain `sending` row) and `sending`/`pending_observation`/`ambiguous` rows, and performs provider reads only, after dispatch evidence for `sending` and `ambiguous` rows. A restore-fenced row (`approved` + `ambiguous`, left by the recovery fence) takes neither evidence nor a read: it ends as terminal ambiguity on its first due run. An ambiguous row is re-read on a ladder measured from the attempt start (`reply_publication_attempts.created_at`): 15 min, 30 min, 1 h, 2 h, 4 h, 8 h, 24 h, 48 h, 72 h, never sooner than one minute ahead. A non-confirming read — absent, unreadable, or failed — reschedules to the next rung; only the end of the ladder (or a missing attempt start on pre-RPL rows) makes the row terminal ambiguity (`reconcile_due_at` NULL, no more automatic checks). An accepted write whose echo is absent or unreadable waits out its own 15-minute propagation grace (an unreadable echo records no observation, so only the attempt's age bounds it), then becomes `ambiguous` at the next ladder rung. A 240-second monotonic start deadline leaves 60 seconds inside the worker's 300-second timeout for an already-started bounded provider read, its checkpoint, reporting, and lease release; an unstarted suffix remains due for the next run.

### Manager publication commands

- **Check Google again** (`reply.checkPublication`, `checkReplyPublicationFn`) — for `approved` + `sending`/`pending_observation`, `publish_failed` + `ambiguous`, and terminal ambiguity. Dispatch evidence first: a never-dispatched attempt is settled with no Google read (`never_sent`). Otherwise one targeted read, then the reply is re-read and returned with `checkedAt` and `nextAutomaticCheckAt` (its `reconcile_due_at`). Outcomes: `live_on_google`, `not_on_google`, `never_sent`, `different_reply_on_google`, `unreadable_on_google`, `review_missing_on_google`, `cancelled`. A reply with nothing to check is `invalid_transition`; an unreachable Google is `sync_failed`. It never authorizes a cycle or enqueues a job.
- **Confirm & Publish** (`reply.approve`) — only from `pending_approval`, and only for the Reply the manager read (`expectedStateRevision`, see Model). The authorization write records the approver and commits the `review.reply.approved` fact with the publication intent. A failed Reply is never approved again; it is retried, which keeps the non-dispatch proof of Invariant 9 in front of every resend. An AI-assisted Reply is confirmed only while its binding is current.
- **Publication scope** — Approve, edit-and-republish and **Try publishing again** refuse before any write, in words that match the Property's lifecycle, when it is not active: archived ("This property has been removed… Restore it from the Removed list…"), suspended while its Organization is being closed ("Your organization is being closed…"), or past its recovery window and being deleted ("This property is being deleted…"). They also refuse when the Review has not been observed at the Property's current source epoch since a Restore or relink ("…Try again after the next sync."). The provider authorizer would refuse any of these writes; these commands read the Property outside their authorization transaction, so the publish worker's claim repeats the lifecycle and epoch check under a lock.
- **Try publishing again** (`reply.retryPublish`) — re-authorizes a NEW cycle for a Reply whose publication failed (`publish_failed`), keeping its approval. It is a manager's own command on confirmed text: it never reads the AI draft binding and records the Reply as human-authored. A Reply still waiting for approval, or one whose cycle is still open, is refused. A reply descended from an uncertain attempt must first prove the attempt never dispatched (it is then settled and re-authorized); otherwise it refuses: "RepKey won't send this reply again because Google may already have it. Use Check Google again instead." It never reads Google.

## Invariants

1. Period reads use half-open bounds so adjacent Dashboard periods never
   double-count a Review.
2. A replay creates neither another observation nor another event; an older
   provider version cannot replace the current Review.
3. Serving reads deny provider content at its fetch-based hard expiry. Confirmed deletion/expiry removes the current cache and redacts provider-controlled values while preserving stable identity and manager history.
4. Provider-subject HMAC mappings, not erased Google identifiers, reconnect a
   re-observation. A collision fails closed.
5. Reply text must pass `replyCommentProblem` (`src/shared/google-provider-control/reply-comment.ts`): not blank, at most 4096 UTF-8 bytes (Google's documented limit), no C0 control other than line feed, carriage return and tab, no DEL, no lone surrogate. Draft save, submit, approve and edit-published refuse anything else with `invalid_reply`.
6. A changed grounded Brand Profile invalidates the pending AI operation and creates no draft; legacy provenance verification remains compatible.
7. Every publication cycle atomically commits Reply state and its identifier-only
   intent. Older cycles cannot admit or acknowledge newer work. The text a cycle
   authorized stays the Reply's text while the cycle is open and after it ends
   published or failed: no draft save rewrites it, and edit-and-republish
   changes published text only by authorizing a new cycle for the new text.
   The text a cycle authorizes is the text its caller read: the authorization
   write compares the Reply's state revision, so a Reply rewritten since
   matches no row.
8. Provider write acknowledgement persists the exact attempt/correlation outcome as `pending_observation`; it never marks the Reply published and never closes Inbox work.
9. A persisted `sending` attempt is an uncertain provider outcome. Positive
   non-dispatch evidence (below) settles it as not published without a Google
   read. Otherwise the worker does a targeted read: exact live truth (the
   google-reply-v1 digest, nothing looser) may confirm it and a different live
   reply may supersede it. An absent reply, a failed read, a reply Google shows
   without a recoverable original (`unreadable`: no observation is recorded) and
   live text that differs only by whitespace (recorded as resolution `diverged`:
   no confirmation, no supersede, no Inbox close) decide nothing, because Google
   may have accepted a reply without echoing it exactly. They wait out a
   15-minute propagation grace (due in one minute, re-read on the sweep's next
   five-minute run), then the row becomes `ambiguous` and is read again at the
   next of 15 min, 30 min, 1 h, 2 h, 4 h, 8 h, 24 h, 48 h and 72 h after the
   attempt started; only the end of that ladder (or a missing attempt start on
   pre-RPL rows) makes it terminal ambiguity. A missing Review is lifecycle evidence, not propagation,
   so it does not wait out the grace.
   No read outcome permits a second write for that attempt. RepKey may resend
   only on positive non-dispatch evidence: no `authorization_execution_permits`
   row with `route_key = 'reviews.reply'` and this reply, cycle and attempt number
   in its authorization vector (any state), once the dispatch window
   (`REPLY_DISPATCH_EVIDENCE_WINDOW_MS`, at least five minutes after the attempt
   started) has passed, and no recovery fence completed after the attempt started
   (a restore can lose a permit written after its restore point). The gateway
   cannot call Google without starting such a permit. The window is only a
   filter; the guarantee is a lock: permit admission holds FOR SHARE on the
   attempt row until its permit commits, and the settle locks that row and
   re-reads the permits before it writes, so a permit is either visible to the
   settle or denied because the attempt is no longer `sending`. That settle is
   the only transition from uncertainty to "safe to publish again", and the
   resend still needs a manager's new cycle. Nothing else authorizes one: the
   persisted machine has no `authorize` from `ambiguous`, and the store's
   authorization write refuses an uncertain Reply whether it is called as an
   approval or as a retry.
10. A stale observation or event cannot confirm a newer Reply cycle. Application
    agreement alone is not closure authority.
11. Count or average drift during or between reputation scans terminally fails the
    run. Zero Reviews is count `0` with average `null`.
12. Verified reputation facts contain no Review ID, provider identifier, reviewer,
    rating distribution, or text.
13. Reply profile and template field rules come from
    `application/dto/reply-library.dto.ts`; the Settings boundary, repository,
    and operations importer must not restate them.
14. Template edits and enabled-state changes are tenant-and-Property-scoped,
    versioned, attributed to the acting user, and leave version and attribution
    unchanged when the persisted value is unchanged.

## Verification

Unit tests stay beside material comparison, source lifecycle, Reply state,
observations, reconciliation, server contracts, workers, and build registration.
PostgreSQL integration tests cover immutable authorization, claim/revocation races,
atomic observation confirmation, replay, erasure, and verified snapshots.

The Reply workflow has a model-based suite. Its oracle is the workflow written
out by hand (`domain/__fixtures__/reply-workflow-oracle.ts`), never the
production transition tables. `domain/reply-workflow.property.test.ts` holds the
command preconditions and both tables to it;
`infrastructure/reply-workflow.model.integration.test.ts` runs generated
histories of commands, worker executions, sweeps and syncs against PostgreSQL
and checks Invariants 7 to 10 against what a stand-in Google received. Both
carry authorship (a manager's text or adopted AI text) and freshness (the AI
draft binding current or stale; a confirmation that names the Reply on screen
or an earlier one): AI suggestions are adopted through the real acceptance
store and judged by the real binding, and no stale AI text may leave RepKey.

Recurring activation remains quarantined until the external shadow-parity/cutover audit is complete.
