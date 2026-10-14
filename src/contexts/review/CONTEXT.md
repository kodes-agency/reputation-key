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
also on the exact state and attempt count it read. A write that puts the text
forward (submit, an approval, a retry, an edit) compares the Reply's state
revision too: the AI draft purge (below) empties a draft in place, in the same
status, publication state and cycle, and a submit that had read the AI text
would otherwise hand an approver a Reply with no text. A second entry point, or
a change between the read and the write, therefore matches no row and records
no fact. The status table (`REPLY_TRANSITIONS`) only says which status may
follow which; it has no `approved → draft`, because no reply command makes that
move. A Reply returns to draft when its open cycle is cancelled (a disconnect,
a policy stop, a refused claim: `cancelledPublication`), superseded by what
Google shows or by a changed Review (the observation and Review stores' own
guarded writes), or withdrawn by the AI draft purge. Each of those writers
clears the cancelled cycle's recovery deadline and last error class, so a
cancelled Reply never names a next automatic check. A guest edit also returns
to draft a Reply that was put forward and has no open cycle (below).

Confirm & Publish is bound to the Reply the manager read. The Inbox sends
which Reply its screen showed and that Reply's state revision, both as they
stood when the confirmation was opened (`expectedReply`: id and
`stateRevision`). The use case refuses, with the same error as a lost race, a
stored Reply that is another one or has moved past that revision; the store's
authorization write (an approval, a retry or an edit) names the Reply it was
given by id and compares its state revision. Both are needed. A Reply that was
rejected, rewritten and submitted again while a confirmation stood open is
pending again in the same cycle, at a later revision. One that was rejected,
deleted and written anew (a manager's Delete, or the AI draft purge followed by
a new draft) is another Reply, and its revision counts from 1 again: created
then submitted is revision 2 for every Reply, so the revision alone cannot tell
the two apart. The authorization digests whatever text the row holds. A caller
with no screen (a seed, a script) names no Reply and confirms the stored one.

An AI-assisted Reply is the unedited text of one AI suggestion a manager
adopted as a draft (`authorship = 'ai_assisted'`). AI output is advisory (ADR
0031; AI CONTEXT, Invariants 5 and 6), so that text is held by the AI draft
binding (`infrastructure/ai-draft-binding.ts`): everything it was generated
from must still be current, and its ten-minute adoption window must not have
passed. The binding is a gate on AI text moving toward Google, not a lock on
the Reply, and `domain/reply-ai-text.ts` says which command does what:

- **It gates AI text on its way to Google, and a first claim excuses only the
  window.** Submit and Confirm & Publish need a current binding and refuse a
  stale one with `ai_suggestion_stale` and a sentence that names the way out.
  So does the publish worker's claim, the last step before a request leaves
  RepKey. A claim that passes writes an attempt carrying the digest of the
  text; an attempt for the text the Reply holds now is the evidence that these
  words passed every gate while they were current
  (`reply-write-guards.ts`, `aiTextMayBeClaimed`). A later attempt for them,
  in the same cycle or in the cycle of a retry, does not wait on the adoption
  window again. Nothing else is excused: once something the text was generated
  from has changed, the claim refuses it, claimed before or not
  (`ai-draft-binding.ts`, `aiDraftInputsAreCurrent`). That is the text the AI
  draft purge withdraws wherever it can still reach it.
- **A claim the gate refuses withdraws the Reply, as the AI draft purge would**
  (below; `infrastructure/unclaimable-publication.ts`). Nothing is sent, the
  cycle is cancelled, the AI text is removed, and one
  `review.reply.publication_cancelled` fact with the purge's cause,
  `ai_draft_withdrawn`, tells its author and approvers. What is left is an
  empty draft that claims no AI authorship, with its authorization and
  attempts kept. The purge and the claim leave one shape, whichever reaches
  the Reply first; a draft that kept its AI text here would be emptied by the
  next sync with nobody told.
- **Adoption ends when a manager writes the text.** A draft save (typing over
  the draft, or Edit & resubmit on a rejected Reply) and edit-and-republish
  never read the binding; each records the Reply as human-authored and clears
  its AI provenance, through the same set clause (`reply-set-clause.ts`).
- **Reject, delete and Try publishing again never read it** and change no
  authorship. An approver can always send a Reply back. A retry changes no
  text and sends nothing: it authorizes a cycle, and the claim of that cycle
  decides. Text that was claimed before goes, unless an input has changed
  since; text that never was (the sweep ended a cycle no worker reached in
  time) meets the whole binding there. What the claim refuses is withdrawn.

So a stale AI draft can be typed over, a pending one rejected, and a Reply
whose publication failed or succeeded can be tried again or edited; none of
that waits on a window that closed, and no state is left without a command. A
withdrawn Reply is a draft like any other, with no text: a draft save writes
the manager's reply into it, an AI suggestion can be adopted into it, submit
refuses it as blank (Invariant 5), and Delete refuses it because its
publication record keeps it.
Authorship says where the words came from and changes only when they do: a
Reply that still holds the suggestion's text stays `ai_assisted` through
approval, failure, a retry and publication, and the Organization export says
so. What the binding still decides is whether AI text nobody has touched may be
put forward, or sent for the first time, as it is.

A manager's Delete never removes a Reply that was ever authorized. Its
authorization and attempt rows are the evidence of what a manager confirmed and
what was sent, and they reference it `ON DELETE RESTRICT`. A cancelled
publication leaves such a Reply as a draft; Delete is refused there with a
sentence that says so, and the Reply stays editable and can be submitted again.
(The Organization purge removes the evidence and the Reply together; the AI
draft purge is a lifecycle path of its own.)
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

An AI-assisted Reply is the unedited output of one AI operation; the first
manager edit makes it human-authored. It is bound to what it was generated from
(`infrastructure/ai-draft-binding.ts`): the Review's source epoch and Material
Review Revision, the Property's processing profile, the Merchant AI
Authorization and the AI execution controls. The binding also ends by time
alone, when `ai_draft_expires_at` passes: the adoption window
(`AI_REPLY_ADOPTION_WINDOW_MILLIS`, ten minutes) after the suggestion was
issued. Submit, approve and the publish worker's claim refuse it once the
binding is stale (the claim with the one exception above: text claimed before,
when only its window has passed), and the transaction that moves an input runs
the AI draft purge (`src/shared/db/ai/ai-draft-purge.ts`) for the scope it
changed: a
control transition, an Authorization or profile change, a Property archive or
Google binding change, an Organization closing, a new Material Review Revision
or source epoch, or source-content erasure. No transaction marks the moment the
time runs out, so the next observation of the Review withdraws the Replies
whose time has passed, and only those. The purge withdraws the AI-assisted
Replies whose text has not gone to Google:

- one no manager ever confirmed (a draft, awaiting approval, rejected) is
  deleted;
- one that was confirmed but not dispatched (`requested`/`authorized`), or that
  is back in draft after a cancelled cycle, is kept, because its authorization
  and attempts reference it and must survive. An open cycle is cancelled as a
  policy stop cancels one, its AI-derived text is emptied, and the row stops
  claiming AI authorship, so a manager can write a new reply into it;
- one that was dispatched, published or ended as `publish_failed` is left to the
  publish worker, the reconciliation sweep and the cancellation paths above.
  When a guest edit stops a dispatched cycle (`source_changed`), the Reply it
  returns to draft is emptied in the same transaction: its text answered the
  revision the guest replaced. A failed Reply keeps its text and its Try
  publishing again; the claim of the cycle that retry authorizes withdraws it
  when an input has changed since, so the text is not sent after all.

Each Reply that was awaiting approval or confirmed and waiting to be sent
records one `review.reply.publication_cancelled` fact with cause
`ai_draft_withdrawn`, so its author and approvers are told and the approval
request is retired (ADR 0046, amended 2026-10-12). A draft nobody was asked
about goes without one, and so does a Reply whose cancellation already
recorded a fact of its own. The publish worker's claim records the same cause
for a Reply it withdraws.

The purge writes SQL of its own, from the transactions of other contexts, and
goes through none of the reply guards. The two are held together by tests
(`infrastructure/reply-ai-withdrawal.integration.test.ts`, and the purge as a
step of the model suite): a command that read the Reply before the purge
matches no row after it, a claim or a confirmation that waited for the purge's
locks finds the Reply withdrawn or gone, and a draft save that waited writes
the manager's text into the emptied Reply. A cycle that is waiting for its
next execution when the window passes is sent if the worker reaches it first
and withdrawn if a sync does; both are a rule keeping its word.

A guest edit does not inherit the answer to the revision it replaced. A live
Google reply whose text equals the previous head's, recorded in the same source
epoch at an earlier revision, is carried over, not added: it resolves
`unchanged` and raises no `review.reply.observed`, so it cannot close the cycle
the edit reopened in the Inbox. A changed reply, a reply first seen at the new
revision, or a RepKey reply confirmed for it answers the edit. A head from
another source epoch keeps the old reading, because Inbox carries its head on
that observation.

A guest edit takes back what was put forward for the review it replaced
(docs/BETA.md §3 "Inbox"; ADR 0055 decision 11). The transaction that records
the observation does it (`infrastructure/review-command-store.ts`), in three
parts:

- A publication cycle authorized for an older source that is still open or of
  unknown outcome (`requested`, `authorized`, `sending`, `pending_observation`,
  `ambiguous`) is cancelled, its attempt marked superseded, and the Reply
  returns to draft. The authorization names the source it was given for, so
  this part runs on any applied observation that moves the source, a
  source-epoch carry included.
- A Reply a manager wrote that has no open cycle and was still put forward
  returns to draft: one awaiting approval, and one whose publication failed
  and whose cycle has ended (`publish_failed`, `terminal`). These are the
  Replies Confirm & Publish and Try publishing again may start from
  (`domain/reply-command-preconditions.ts`, `takenBackByGuestEdit`), the two
  commands that publish stored text with one click, the second under the
  approval the Reply got for the earlier review. The Reply keeps its text, and
  the authorization and attempts of a failed cycle stay as they are, except
  the attempt of unknown outcome described below. This part runs only on a
  guest edit, a changed rating or changed normalized text (`isGuestEdit`):
  after a carry of unchanged material the review the Reply answers is the
  same.
- Unedited AI text is withdrawn by the AI draft purge (above).

Terminal ambiguity (`terminal`, last error `ambiguous`: the read ladder ended
without an answer) is taken back with the other failures, and its attempt is
marked superseded, as the first part does for an attempt still on the ladder.
Try publishing again does not start from it as it stands, but proof that the
attempt never left RepKey settles it as a failure the retry does start from
(Invariant 9), and that proof can be found after the edit, by the retry itself
or by Check Google again. Nor is the attempt evidence any longer. The
observation authority confirms or supersedes an attempt only for the source
epoch and revision it was authorized at (`isConfirmableCurrentAttempt`,
`domain/google-reply-observation.ts`), and every read after the edit is
recorded for the new revision. Left as it was, such a Reply could not be
confirmed by any later read and, without that proof, could not be tried
again, edited or deleted, so the edited review could not be answered from
RepKey at all. Once it is submitted and confirmed again the write is an upsert
on Google: if the earlier request did land, the new reply replaces it.

Each Reply the first two parts return to draft records one
`review.reply.publication_cancelled` fact with cause `source_changed`. Its
author and the people who can approve are told, and the approval request or
failure notice that was waiting on it is retired (ADR 0046, amended
2026-10-13). It is published only once it is submitted and confirmed again,
for the review as it is now.

A manager's draft and a rejected Reply are in nobody's queue and stay as they
are, text and all; a published Reply is what Google shows and stays published.
Nothing marks such a draft as written before the edit: that would take a
revision on a human Reply, which the schema keeps for AI-assisted ones only.

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
updates in place, and creates by insert: a title another template of the
Property already holds is refused as `invalid_input`, on create and on rename,
and never overwrites that template. The operations importer deliberately
remains title-keyed for repeatability: re-importing a manager-renamed
template&rsquo;s former source title creates a separate row and never
overwrites the renamed template.

## Runtime

`buildReviewContext` captures Review repositories, queues, use cases, and foreign public ports in one `registerWorkerJobs` runtime contribution. Composition supplies the canonical registry/background queue and Bootstrap invokes this one method with the parsed discovery interval; neither layer reconstructs Review job dependencies.

- **sync-property-reviews** — Fetches reviews from Google for a specific property/location. Triggered by `property.created` event or `refresh-expiring-reviews` job. A failed snapshot records its code on `review_sync_state` and fails the job so the queue retries it, except a location over the review or page cap (`review_cap_exceeded`, `page_cap_exceeded`, reason `location_too_large`): it fails the same way every run, so the code is recorded, the next poll is parked a day out and the job ends without a retry or a quarantine entry.
- **refresh-expiring-reviews** — Finds reviews expiring within 5 days, enqueues sync jobs to refresh them. Runs hourly. Walks live Reviews only: an erased Review has no content to refresh, so the sweep never selects it and one deleted Review cannot stop the sweep for every Organization. It also walks only the Reviews of a Property a sync can still be authorized for (live, not deleted, bound to Google through the Review's own connection, connection active and usable): the Reviews of an archived, suspended or disconnected Property are left to reach their 30-day expiry instead of queueing syncs that can only fail and end in the quarantine.
- **purge-expired-reviews** — compatibility entry point for the single Review source-content lifecycle authority. It keyset-checkpoints a frozen window and its recurring job accepts content-free eligibility `report` and expand/cache/observation/revision/legacy-reply `shadow` evidence only. Checkpoints bind mode, scope, window, and `(createdAt, ReviewId)` cursor. The connection/Property/Organization compatibility adapter and legacy raw-expiry repository seam also delegate here and are report-only in ordinary composition. The local authority has a bounded whole-page atomic `apply` path, but every page fails closed without both the exact apply confirmation and an injected approval seal that is revalidated on continuation; ordinary production composition supplies neither. The shared erasure/reconciliation/re-observation transaction has real-PostgreSQL concurrency, rollback, replay, and stable-identity coverage. Recurring activation still requires the REV-01 external shadow-parity seal, restore/erasure proof, and explicit cutover approval.
- **review.on-reply-publication-requested** — Durable worker consumer that independently recovers queue admission after a request-process interruption. It reloads the authoritative reply and only admits the intent's exact active cycle. Queue-add/receipt ambiguity is fenced by the deterministic reply+cycle BullMQ job ID.
- **review.on-property-archived** — Durable worker consumer that cancels, as a Google disconnect does (`findUndispatchedPublicationsByReviewIds`, cause `disconnect`), every publication cycle of the Property's reviews that is not yet dispatched (`requested`/`authorized`) and either belongs to a Property that is not active or was authorized at a source epoch the Property has since moved past (Archive and Restore both advance it). The Reply returns to draft and one `review.reply.publication_cancelled` fact (cause `policy`) is recorded per Reply, so the provider authorizer's refusal is never reported to the author as a Google rejection. Every cancellation fact carries the Reply's author (identifier only, null when unknown or on facts recorded before the field existed): the author was last told the reply was queued to publish to Google, so Feed has to be able to find them again. Because the rule keys on the epoch, a fact delivered after a quick Restore still clears the pre-archive cycles and leaves a reply approved at the restored epoch alone. A dispatched cycle (`sending`/`pending_observation`) may already be on Google and stays with the worker and the reconciliation sweep, which end it with the `unconfirmed` publish-failed notice when no read can prove it. The consumer runs under its own ungated, Property-scoped catalogue row (`review.property-lifecycle`), like the disconnect consumer: it cancels and never publishes, and a `property.publish_reply` stop in force when the fact is dispatched would otherwise deny it terminally and leave the reply to be reported as failed to send.
- **publish-reply** — Executes one guarded provider write for an approved current cycle. Claim revalidates the cycle's named manager against current membership, effective `reply.manage`, and Property scope in the claim transaction, and locks the Property to require it active at the cycle's source epoch; either denial cancels the cycle (cause `policy`) without provider egress. A claim of AI-assisted text the last gate refuses (see Model) withdraws the Reply instead (cause `ai_draft_withdrawn`), again without provider egress. If an Archive or Restore commits after the claim, the provider authorizer refuses the write before sending (`stale_source`); the job cancels that cycle as `policy` too, never as a Google rejection. A fresh authorized attempt may write once. BullMQ allows five executions (exponential from 30 s with 0.5 jitter, so 15-30 s before the second); only a retryable failure spends them on another write, and a terminal rejection resolves at once. A persisted `sending` attempt is uncertain and is never written again: the job first asks for dispatch evidence (settling a never-dispatched attempt as not published), then makes one targeted read. An absent, unreadable or failed read, and for an edit-and-republish a read that still shows the reply it was written over (Invariant 9), inside the 15-minute propagation grace keeps the row `sending`, due in one minute and re-read on the sweep's next five-minute run; past the grace it becomes `ambiguous`, due at the next ladder rung after the attempt's age. Acknowledged writes remain `pending_observation`.
- **reconcile-ambiguous-publications** — Globally single-flight across replicas through a PostgreSQL session advisory lease. It keyset-walks due `requested`/`authorized` rows (ended as a retryable failure with no provider read, but only while still unclaimed: the write compares the exact state and attempt count the sweep read, so a row a worker claimed after the batch was read is left alone and comes back as an uncertain `sending` row) and `sending`/`pending_observation`/`ambiguous` rows, and performs provider reads only, after dispatch evidence for `sending` and `ambiguous` rows. A restore-fenced row (`approved` + `ambiguous`, left by the recovery fence) takes neither evidence nor a read: it ends as terminal ambiguity on its first due run. An ambiguous row is re-read on a ladder measured from the attempt start (`reply_publication_attempts.created_at`): 15 min, 30 min, 1 h, 2 h, 4 h, 8 h, 24 h, 48 h, 72 h, never sooner than one minute ahead. A non-confirming read — absent, unreadable, failed, or for an edit still the reply it was written over — reschedules to the next rung; only the end of the ladder (or a missing attempt start on pre-RPL rows) makes the row terminal ambiguity (`reconcile_due_at` NULL, no more automatic checks). An accepted write whose echo is absent or unreadable, or an accepted edit while Google still shows the reply it was written over, waits out its own 15-minute propagation grace (the last two record no observation, so only the attempt's age bounds them), then becomes `ambiguous` at the next ladder rung. A 240-second monotonic start deadline leaves 60 seconds inside the worker's 300-second timeout for an already-started bounded provider read, its checkpoint, reporting, and lease release; an unstarted suffix remains due for the next run.

### Manager publication commands

- **Check Google again** (`reply.checkPublication`, `checkReplyPublicationFn`) — for `approved` + `sending`/`pending_observation`, `publish_failed` + `ambiguous`, and terminal ambiguity. Dispatch evidence first: a never-dispatched attempt is settled with no Google read (`never_sent`). Otherwise one targeted read, then the reply is re-read and returned with `checkedAt` and `nextAutomaticCheckAt` (its `reconcile_due_at`). Outcomes: `live_on_google`, `not_on_google` (no reply there, or for an edit still the reply it was written over), `never_sent`, `different_reply_on_google`, `unreadable_on_google`, `review_missing_on_google`, `cancelled`. A reply with nothing to check is `invalid_transition`; an unreachable Google is `sync_failed`. It never authorizes a cycle or enqueues a job.
- **Confirm & Publish** (`reply.approve`) — only from `pending_approval`, and only for the Reply the manager read (`expectedReply`: its id and state revision, see Model). The authorization write records the approver and commits the `review.reply.approved` fact with the publication intent. A failed Reply is never approved again; it is retried, which keeps the non-dispatch proof of Invariant 9 in front of every resend. An AI-assisted Reply is confirmed only while its binding is current.
- **Publication scope** — Approve, edit-and-republish and **Try publishing again** refuse before any write, in words that match the Property's lifecycle, when it is not active: archived ("This property has been removed… Restore it from the Removed list…"), suspended while its Organization is being closed ("Your organization is being closed…"), or past its recovery window and being deleted ("This property is being deleted…"). They also refuse when the Review has not been observed at the Property's current source epoch since a Restore or relink ("…Try again after the next sync."). The provider authorizer would refuse any of these writes; these commands read the Property outside their authorization transaction, so the publish worker's claim repeats the lifecycle and epoch check under a lock.
- **Try publishing again** (`reply.retryPublish`) — re-authorizes a NEW cycle for a Reply whose publication failed (`publish_failed`), keeping its approval. It changes no text and no authorship and never reads the AI draft binding: for an AI-assisted Reply the claim of the new cycle decides (see Model). It checks the stored text as submit and approval do (Invariant 5, no unfilled template slot). A Reply still waiting for approval, or one whose cycle is still open, is refused. A reply descended from an uncertain attempt must first prove the attempt never dispatched (it is then settled and re-authorized); otherwise it refuses: "RepKey won't send this reply again because Google may already have it. Use Check Google again instead." It never reads Google.

## Invariants

1. Period reads use half-open bounds so adjacent Dashboard periods never
   double-count a Review. The daily series (rating trend, review volume) bucket a
   Review by its Property's calendar day (`properties.timezone`), the calendar the
   window is opened in, not by the UTC day.
2. A replay creates neither another observation nor another event; an older
   provider version cannot replace the current Review.
3. Serving reads deny provider content at its fetch-based hard expiry. Confirmed deletion/expiry removes the current cache and redacts provider-controlled values (the content clock `content_expires_at` with them, in the snapshot and expiry erase and in the Organization purge scrub alike) while preserving stable identity and manager history. An erased Review (a tombstone) is not a `Review` a reader can map: every repository read that returns Reviews or selects on the content clock scopes to `source_content_state = 'active'`, so an erased Review is absent from it (`findById` answers null, the lists and the lifecycle sweeps leave it out), never an exception. The exceptions are `readForAi` and `assertCurrentForAi`, which test the clock without the state scope: a tombstone has no `ai_source_byte_length` (the table's check forces it NULL), so they deny it as `policy_unavailable`, which is the AI settlement outcome callers rely on; do not turn that into `not_found`. `readForAi` answers only what the row says: a database fault (pool timeout, reset connection, deadlock) is thrown, never answered as `policy_unavailable`, because review analysis settles that status as a terminal skip and the consumer retries a thrown read. `assertCurrentForAi` and `readTrendPopulation` keep answering a fault as `policy_unavailable`, since their callers retry on any answer but `current` and `complete`. A tombstone erased before the clock was cleared keeps it; the scope, not a data repair, makes those safe.
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
   may have accepted a reply without echoing it exactly. Nor does the reply an
   edit-and-republish was written over. While the observation head still holds
   it, live text whose digest is the one RepKey last confirmed for this Reply
   (its latest `confirmed` attempt, whatever the head has come to say of it
   since) is RepKey's own earlier publication, not a different reply: a sync
   page fetched before the write landed and recorded after the claim shows it,
   and so does a read Google answers before its read path has caught up with
   the write. (A reply that is neither the attempt's text nor that earlier one
   is a different reply and supersedes; so does an unchanged reply RepKey never
   confirmed for this Reply.) That read resolves `earlier_publication_live`,
   which is never stored: no observation, no fact, and the head stays as it
   was, whichever reader made it (a sync, the worker's read-back, the sweep,
   Check Google again). The earlier text is recognised before the whitespace
   rule, so an edit that changes only spacing or line breaks is read the same
   way and not as its own reformatted echo. All of these wait out a
   15-minute propagation grace (due in one minute, re-read on the sweep's next
   five-minute run), then the row becomes `ambiguous` and is read again at the
   next of 15 min, 30 min, 1 h, 2 h, 4 h, 8 h, 24 h, 48 h and 72 h after the
   attempt started; only the end of that ladder (or a missing attempt start on
   pre-RPL rows) makes it terminal ambiguity. An edit Google never applies
   (lost on the wire, or accepted and never shown) ends there too, as a first
   reply does: `publish_failed` holding the edit's text while Google keeps the
   earlier reply, and no reply command leaves that state. Try publishing again
   refuses it (its permit exists, so nothing proves it never left), it is no
   draft to rewrite, submit or delete and no published reply to edit, and Check
   Google again reads and changes nothing. It ends when a read shows the edit
   or a different reply, or when a guest edit takes the Reply back. A missing
   Review is lifecycle evidence, not propagation, so it does not wait out the
   grace.
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
15. Observing a Review again at the same source epoch and Material Review
    Revision never withdraws an AI-assisted Reply whose binding is still
    current. That observation runs the AI draft purge only for the Review's
    AI-assisted Replies whose `ai_draft_expires_at` has passed; an observation
    that moves the epoch or the revision, and source-content erasure, run it
    for all of them. The purge never deletes a Reply that publication evidence
    references (`infrastructure/ai-draft-purge.integration.test.ts`).
16. Unedited AI text leaves RepKey only while its binding is current, or, once
    a worker has claimed it, after its adoption window alone has passed; never
    after something it was generated from changed. A Reply whose AI text was
    withdrawn is blank, and a blank Reply is only ever a draft: no command
    submits, confirms or sends it
    (`infrastructure/reply-ai-withdrawal.integration.test.ts`).
17. A guest edit leaves no Reply a manager wrote awaiting approval, and none
    whose publication failed, whether or not its outcome was ever learned:
    each is a draft again, with its text and one `source_changed` fact, and an
    attempt of unknown outcome is closed as superseded. Confirm & Publish, Try
    publishing again and Check Google again refuse it until it is submitted
    and confirmed for the review as it is now
    (`infrastructure/guest-edit-reply-fence.integration.test.ts`).

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
carry authorship (a manager's text or adopted AI text), freshness (the AI draft
binding current or stale, by its window or by a changed input; the text claimed
for sending before or never) and identity (a confirmation that names the stored
Reply, an earlier revision of it, or a Reply that was deleted and replaced): AI
suggestions are adopted through the real acceptance store and judged by the
real binding, and no AI text that went stale before its first claim, or whose
inputs changed, may leave RepKey. The AI draft purge is a step of the
PostgreSQL histories (for every AI draft when an input changes, and for those
past their window when a sync sees the Review), and the oracle states by hand
what it deletes, empties and leaves alone.

The stand-in Google of that suite answers every read with what it holds.
`infrastructure/reply-observation-in-flight.integration.test.ts` takes that
away for an edit-and-republish: a sync page fetched before the write and
recorded after the claim, and reads that still show the earlier reply after
Google accepted the edit, at the sweep, the worker's read-back and Check Google
again. In each the edit stays in flight, nothing is recorded, and it is
published once Google shows it, an edit that changes only line breaks
included; a reply that is neither text still ends it, and an edit that never
reached Google ends as terminal ambiguity that no reply command moves.

`domain/reply-publication-workflow.property.test.ts` checks every cell of the
two publication tables (the saga, and the persisted machine of state by event)
against moves written by hand in that file. Neither table is exported, so no
test can ask a table what it should say.

Recurring activation remains quarantined until the external shadow-parity/cutover audit is complete.
