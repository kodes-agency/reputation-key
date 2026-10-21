# Inbox Response Targets — implementation and operations

**Owner:** Inbox, with Review-owned Google timing authority and Notification-owned delivery  
**Package:** IBX-01  
**Migrations:** `0158_inbox_response_targets`, `0166_review_response_target_provenance`, `0167_inbox_response_target_terminal_outcomes`, `0023_review_import_history_cutoff`, `0030_inbox_low_rating_response_target`  
**Time model:** elapsed minutes on UTC instants; Property timezone is display-only

## Repository contract

The repository implements two separate target families:

- **Google Review Response Target** — how long the current review work episode takes
  before a current response is observed live on Google.
- **Private Feedback Handling Target** — how long the current private-feedback work
  episode takes before a manager records a handling outcome.

Both use a built-in default of 2,880 elapsed minutes (48 hours). An Organization
policy can replace either default. Only the Private Feedback target supports an
enabled Property override. There is no Portal override, and Google targets never
use a Property override.

### Low-rated Google reviews

The Google Review policy may carry a second, shorter duration for the
Organization's own low-rated reviews: `low_rating_threshold` (1–5 stars) and
`low_rating_duration_minutes` on the same policy row, all-or-nothing, Google
only, and never longer than the ordinary target. A revision whose rating is at
or below the threshold is snapshotted against the shorter duration, so its
halfway and target-passed reminders fall sooner. Both columns null is the
default and every row written before migration `0030`: one clock for every
review, exactly as before, and no Organization's recorded performance moves
until somebody sets one.

The rating comes from Review's attested target permit — the same fenced read
that supplies the target's start instant — so Inbox never reads Review's
tables and Feed never sees a rating at all (ADR 0046 r.8). The snapshot
records the resolved duration, so analytics measure each cycle against the
clock it was actually given. `policy_source` stays `organization_policy`: it
is one policy, resolved two ways.

Each measured Handling Cycle stores an immutable snapshot of duration, policy
source/version, start/due instants, and one halfway plus one target-passed reminder
slot. A halfway slot that is already due when the target is recorded is not
created: the schedule guard accepts only the snapshot's own instants, so the slot is
left out rather than moved later. The target-passed slot is always kept, so a target
already overdue when it is snapshotted (a Review first observed after its target had
elapsed, on a short policy or after a sync outage) is still unanswered work and
prompts once, with target passed, at the next release. Onboarding history and
`legacy_unknown` cycles are not measured and have no slots. The target itself is
still measured and counts as overdue. A policy change affects only later
cycles. Overdue is derived from the
current UTC instant; it neither closes nor escalates an Inbox item. The manager UI
refreshes detail at the saved due instant so an open target changes to
`Target time passed` without waiting for another user action.

### Private Feedback timing

- The initial target starts at feedback submission.
- A governed reopen starts a new measured target at the reopen instant.
- The first approved `markFeedbackHandled` outcome completes the target.
- Guest withdrawal cancels the target.
- Claiming, reading, assigning, adding a note, or escalating does not stop timing.
- An outcome correction preserves the original completion instant and target result.

### Google Review timing and exclusion

Review owns immutable, content-free timing provenance for each Material Review
Revision. Inbox can snapshot it only through Review's exact-current authority while
the Review source fence remains held.

- An initial revision observed as ongoing starts at Google's source-created time,
  falling back to the review's public reviewed time.
- A later material revision starts at Google's source-updated time, falling back to
  the accepting observation time. Metadata-only observations do not create a new
  Material Review Revision or target.
- The initial import's history cutoff is fixed once per Property source epoch,
  when Review admits the sync of the epoch's first import. That is before the sync
  job is queued, so before the import settles and the discovery sweep may poll the
  Property, however long the job then waits, retries or is lost. An import queued
  before admission fixed cutoffs fixes it when its snapshot run starts, or at the
  instant it joins a snapshot run that was already active. The cutoff is kept in
  `review_provider_history_cutoffs`, outlives the import run (runs are swept 30
  days after they end) and never moves; a later import in the same epoch keeps the
  first cutoff.
- A Review's first Material Review Revision in an epoch — a first sighting, or a
  Review carried in from an older epoch — whose provider publication time
  (Google's source-created time, falling back to the public reviewed time) is at or
  before that epoch's cutoff is stored as `historical_onboarding` with no inferred
  deadline, whichever run observes it first: the import itself, the discovery sweep
  that finishes a failed import, a run the import joined, a push reconcile, a manual
  sync or a targeted fetch. Its `review.created`/`review.updated` fact carries the
  same origin. An import run classifies every review it observes against the same
  cutoff, so a retried import that starts a later run does not move it.
- Only the Google history an import takes over is onboarding history. A first
  sighting dated at or before the cutoff is `legacy_unknown` instead, also with no
  inferred deadline but announced as a new review (ADR 0046), when Google published
  it after the Property's first import, or when Google lists it only after a
  snapshot run of the epoch has completed a full listing since the cutoff. The
  first is what a relink finds from while the Property was disconnected: a reply
  Google shows then may be days old, so a completion observed at the relink would
  invent lateness. The second is a review released from moderation or restored
  after the import listed the history. A Review carried in from an older epoch was
  already known and stays `historical_onboarding`.
- A review published after the cutoff remains `measured` even when it arrives on a
  later onboarding page; local page arrival order is never used as the
  classification authority. A later material revision of a Review already known in
  the epoch is new work and is measured from Google's source-updated time. An epoch
  with no import has no cutoff, so its reviews are measured as before. Eligibility
  is fixed when a revision is created: a cutoff never reclassifies an existing
  revision. Older records without reliable provenance are `legacy_unknown`.
- A governed manual reopen or an exact provider-reply deletion opens a new measured
  target at the live reopen/deletion observation instant, including when the Review's
  original imported cycle was excluded. This measures the new operational work; it
  does not invent historical response performance.
- A material revision supersedes and cancels an unfinished earlier target before
  opening the revision's new cycle. Source ineligibility also terminalizes an
  unfinished target. Cancelled targets and their pending reminder slots are excluded
  from performance reporting.

A Google target completes only when Review authorizes the exact current live
observation head for the current source epoch and Material Review Revision. Both an
exact RepKey publication match (`confirmed_on_google`) and a current externally
authored/live response (`external_current_live`) close the work and count as an
observed live response. Provider write acknowledgement and the compatibility
`review.reply.published` fact are not stop authority. A current observed reply
deletion can reopen closed work; a live external edit remains closed.

## Reminder path in this repository

The local composition is fully wired:

1. `release-response-target-reminders` is an enabled five-minute recurring job in
   the governed job catalogue (120 second timeout), and Bootstrap registers its
   worker handler.
2. The job works in three phases, and **no database transaction or row lock is held
   while Google is read**:
   - _List._ Inbox lists the due, active, current slots (oldest first, at most
     100), taking no lock.
   - _Decide._ Private-feedback slots, and a halfway slot whose target has already
     passed, are decided first and need no Google read, so a slow Google can never
     hold them back. Each Google-review slot is then checked (see "The Google
     check before a reminder" below).
   - _Release._ Each decided slot is released at once in its own short transaction.
     Inbox takes the target lock (`SKIP LOCKED`), re-checks that the target is still
     active and current, and marks the slot once. It co-commits one identifier-only
     outbox fact. The fact's event ID is a fresh `newEventId()`; what makes a
     release happen at most once is the one-shot update of the slot row (it only
     succeeds while neither `delivered_at` nor `cancelled_at` is set), not the
     event ID. Once a target has passed, a halfway slot still pending is cancelled
     without a fact, so a release that finds both slots due sends only the
     target-passed reminder.
3. Notification registers the corresponding outbox consumer. Admission resolves
   the exact current cycle, target, assignment, and source responsibility.
4. The queued audience repeats the same exact-current authorization immediately
   before materializing a notification. Completion, cancellation, cycle replacement,
   source-scope loss, or recipient changes therefore settle safely as obsolete.
5. Archiving a Property stops its reminders. Inbox's `inbox.on-property-archived`
   consumer cancels the Property's unreleased slots while the Property is still
   not active, and Notification admits a reminder only for an active Property, so
   a slot released between the archive and that consumer is obsolete as well.

### The Google check before a reminder

About 97% of replies are written directly on Google, and RepKey learns of them
only at the next sync (up to about six hours apart). Without a check, a halfway or
target-passed reminder could go out for a review a manager has already answered.
So before it releases a **Google-review** reminder, the job reads that one review
from Google. Private-feedback reminders are never checked.

For each due Google-review slot, in `scheduled_for` order:

1. **Local head first, no call.** If Review's current Google reply head for the
   review is already _live_, answers the review, was observed at or after the
   cycle's target start, and is on the cycle's Material Review Revision, the slot is
   **held** without reading Google.
2. **Otherwise one read.** Review reads the review from Google through the same
   observation writer as a sync, using the Property's _current_ Google connection
   and source epoch (not what the review row cached), and records what it shows. If
   Google shows an answering reply, a `review.reply.observed` fact is written and
   the normal close path closes the item and cancels its slots within seconds.
3. **Decision.** _Hold_ iff the head after the read is live, observed at or after
   the cycle's target start, and on the cycle's material revision. Anything else
   _releases_ (the check fails open), including a read that created a new material
   revision, no reply, a carried-over reply, and a reply observed before the target
   started (a manager reopened the item after it).

A **held** slot writes nothing and stays pending. It is not a cancelled slot: the
close that the reply observation raises cancels it, after which no later tick
selects it. The next tick finds the same head locally and holds again without a
Google call.

When Google cannot be read:

- _Transient_ failures (rate limit, 5xx, timeout, a 404 for the review) leave the
  slot **pending** and write nothing while `now < scheduled_for + 15 minutes`; the
  next tick tries again. At or after that, the slot is released. The cap is measured
  from `scheduled_for`, so no state is stored; a slot found more than 15 minutes
  late is read once and released at once if that read fails. Under a persistent
  provider failure a reminder is therefore 15 to 20 minutes late (ticks are 5
  minutes apart).
- _Permanent_ conditions release at once with no wait: `property.connect_gbp` not
  enabled for the Property, no Google provider in this environment (local and e2e
  stacks keep today's timing), a connection that needs reauthorizing or whose
  authorization changed, a Property with no active Google binding, or the provider
  rejecting the request.
- Content whose source is `source_expired` or `provider_deleted`, or past its
  content expiry, is never read (a read would re-hydrate erased content); the
  reminder is released.
- A reply Google shows but RepKey cannot read (a translation-only envelope) is
  never recorded, so it can never close the item; the reminder is released.

Limits per tick: at most **20 Google reads** and a soft **35 second** budget. Slots
beyond them wait for the next tick, unless they are already 15 minutes late, when
they are released unchecked. A per-slot error is counted, never rethrown: a throw
would make the queue redo the listing and the reads. The job log carries counts
only (`released`, `checked`, `heldLocal`, `heldAfterRead`, `deferred`,
`unavailable`, `skippedNoProvider`, `failed`): no review text and no provider id.

Recipient policy is:

- halfway with an eligible current assignee: that assignee only;
- halfway without an eligible assignee: current source-scoped responsible managers,
  using the established fallback when responsibility is empty;
- target passed: the de-duplicated union of the eligible current assignee and the
  same source-scoped responsible/fallback audience.

A reminder is a follow-up prompt, not an automatic escalation. `delivered_at` on
the Inbox reminder row means the durable outbox boundary was reached; it does not
prove that a person saw an in-app or email notification. A Google-review reminder
may now be up to 15 to 20 minutes after its `scheduled_for` while Google cannot be
read, and is withheld altogether when Google already shows the answering reply.

## Analytics and manager surfaces

Analytics are Property-scope-authorized, target-family-specific, and never mix
Google Reviews with private feedback.

Google reporting includes measured cycles, current open/overdue counts, observed-live
on-time/late counts, manual/provider-deletion reopen counts, and average elapsed time
until a response was observed live on Google. It separately shows
`historical_onboarding` and `legacy_unknown` excluded counts. Both RepKey-confirmed
and external-current-live responses are valid completions.

Private-feedback reporting includes measured cycles, current open/overdue counts,
handled-on-time/late counts, manual reopen counts, and average elapsed time to the
first approved handling outcome. Cancelled/withdrawn cycles are excluded.

The Organization settings surface manages both Organization policies and presents
both analytics families. Property settings can enable/disable only the private-
feedback override. Inbox detail presents the current cycle's target in the Property
timezone with distinct copy for active, overdue, completed, cancelled, onboarding-
history, and legacy-unknown states.

## Repository wiring versus hosted evidence

The statements above describe checked-in migrations, composition, workers, server
functions, UI wiring, and automated tests. They are **local repository evidence**.
They do not by themselves prove that a hosted Railway environment has:

- applied migrations 0158, 0166, 0167, and 0023;
- installed and ticked the recurring schedule against the intended worker service;
- kept the worker, outbox dispatcher, Notification insertion worker, and database
  healthy through a release;
- delivered a reminder to an authorized manager in the deployed browser/email path;
- preserved the expected behavior through a real provider observation and reply
  deletion.

Do not describe hosted reminders or Google timing as live until release evidence
captures those facts for the deployed artifact and environment.

## Release verification

1. Apply every journaled migration to a fresh PostgreSQL database and run schema-
   drift verification. Do not backfill legacy deadlines from Inbox creation/closure,
   provider fetch time, or today's policy. `0023` backfills only history cutoffs,
   from the import runs still on record; it never touches a revision or a target.
2. Run the Response Target domain, policy, presentation, authority, reminder,
   consumer, migration, and real-PostgreSQL store suites. Preserve the database
   proofs for snapshot precedence, exact-current races, terminalization, analytics,
   and one-shot concurrent release.
3. In the release environment, record the scheduler installation and one successful
   `release-response-target-reminders` tick from the deployed artifact.
4. Exercise halfway and target-passed reminders with assignment changed between
   admission and delivery. Verify the old audience is denied and the newly resolved,
   de-duplicated audience is used. Verify that a target already overdue when it is
   snapshotted records only its target-passed slot and prompts once, and that a
   release finding both slots of a target due sends only target passed.
   Verify the Google check: with a reply written on Google that Review has
   observed, the reminder is held and the close cancels both slots; with no reply
   it is released after one read; with Google unreadable it is not released until
   15 minutes after `scheduled_for`; and a manager's reopen after the reply still
   reminds.
5. Exercise ongoing initial, onboarding-history, material-update, manual-reopen,
   external-current-live completion, RepKey-confirmed completion, and current reply-
   deletion reopen paths, an import that fails part-way and is finished by the
   discovery sweep, a relink after a disconnection, and a review Google lists after
   the import completed. Verify saved start/due/completion evidence and separate
   analytics totals, and that onboarding history produces no `review.created`
   notification while an ongoing initial review, a relink's catch-up and a late
   listing do (ADR 0046).
6. Capture a hosted manager-browser check for Organization settings, Property
   private-feedback override, Inbox target state at the due boundary, and a delivered
   reminder. Link that evidence from the release record; do not replace it with a
   local screenshot.

## Repair rules

- Never infer or edit a historical start, deadline, completion, or terminal result.
- A held slot is not a cancelled slot: it stays pending and is cancelled only by
  the normal close. Do not cancel or release it by hand; if the close is stuck, fix
  the `inbox.on-reply-observed` consumer, not the slot.
- Never reopen a released/cancelled reminder slot. A failed release remains retryable
  only while its slot is pending. Property Restore and cancelled Organization
  closing re-arm nothing either: a slot cancelled while its Property was archived
  or its Organization was closing stays cancelled.
- Policy updates require the caller's expected version. On conflict, reload and
  decide again; do not silently overwrite.
- A broken immutable target requires a separately reviewed, auditable repair command;
  none is provided by this package.
