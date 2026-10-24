---
status: accepted
date: 2026-08-26
---

# 0055 — Stable Review identity and Inbox Handling Cycles

## Context

ADR 0003 coupled Review identity to retained provider content, described Reply
as having no independent lifecycle, and prescribed destructive expiry. ADR 0004
defined a single mutable Inbox status ladder, inferred assignment from legacy
staff access, and allowed generic bulk closure. Those decisions no longer match
the required Google, retention, reply-publication, or private-feedback behavior.

## Decision

### Review and source observations

1. `Review` is a stable RepKey identity scoped to Organization, Property,
   provider source, and source epoch. Provider identifiers locate observations;
   they are not a replaceable primary identity.
2. Provider-controlled content and identity/workflow data have separate
   lifecycles. Expiry, provider removal, or policy erasure removes eligible
   source content but preserves the logical Review, RepKey-owned Reply history,
   Inbox work, first-response facts, and operational history.
3. Every provider observation is versioned. A `MaterialReviewRevision` is created
   only when the original star rating or deterministically normalized original
   guest text changes and Google's `updateTime` moved with it (note 2026-10-23).
   Translation, photos, metadata, and observation timestamps do not create a
   material revision.
4. Re-observation reconnects to the same Review in the same source epoch. A
   different real-world source binding starts a new epoch through an attested
   rebind command and never blends populations.
5. Pub/Sub is the fast path, targeted fetch handles a notification, adaptive
   polling/full reconciliation detects missed updates and deletion, and manual
   sync is recovery. A quiet healthy Property must be reconciled within six
   hours; push-only operation is insufficient.

### Reply and publication

6. Reply is RepKey-owned workflow with its own durable drafts, confirmations,
   attempts, outcomes, and provider reconciliation. Review-source erasure cannot
   cascade-delete it.
7. Every RepKey-originated publish requires an authorized **Confirm & Publish**
   action. Pending, rejected, failed, or ambiguous provider outcomes do not close
   work. Only the current reply observed live on Google can do so.

### Inbox Item and Handling Cycle

8. An `InboxItem` is stable. It contains numbered `HandlingCycle` work episodes,
   each anchored to one Material Review Revision or Guest Response Revision.
   Prior cycles are immutable history and exactly one cycle may be current and
   actionable.
9. Workflow dimensions are independent: `open | closed`, optional singular
   assignment, escalation, and per-user seen/visit state. Reading never claims,
   assigns, handles, resolves, or closes work.
10. Google and private feedback have separate eligible closure commands and
    target policies. Private feedback closes through **Mark as handled** with a
    controlled outcome; Google work closes only from provider-authoritative live
    reply evidence or another explicitly approved reason.
11. Reopen creates a new cycle and never rewrites a prior outcome or deadline.
    Material source changes and loss of a formerly live reply create a new cycle
    and fence stale drafts/publications.
12. Assignment never grants access. Eligibility is revalidated from current
    Organization role and Property authority. Opening/reading is not a claim;
    Claim is an explicit compare-and-set command.
13. Bulk Close is disabled for initial beta. Bulk Reopen and bounded assignment
    commands use revision fencing and explicit per-item results.
14. Inbox projections consume durable identifier-only facts. They may not depend
    on a process-local event or retain provider/private content without their own
    authorized lifecycle.

## Note 2026-10-13 — what decision 11 fences on a guest edit

Decision 11 says a material source change fences "stale drafts/publications".
As implemented, the fence is on what was put forward, not on every draft. When
a guest edit is recorded, Review cancels an open publication, returns to draft
a reply a manager wrote that was awaiting approval or whose publication had
failed, and withdraws unedited AI text. A manager's own draft and a rejected
reply are in nobody's queue: they stay as they are, are not marked as written
before the edit, and reach Google only through a submission and a Confirm &
Publish made after it (`docs/BETA.md` §3 "Inbox"; Review CONTEXT, Model).
Marking such a draft would need a revision on a human-written reply, which the
schema keeps for AI-assisted replies only, and is an open product choice.

## Note 2026-10-13 — what decision 5's six hours measure

Decision 5 says a quiet healthy Property "must be reconciled within six hours".
As implemented, six hours is the longest interval a Property's next discovery
poll is dated ahead (`DISCOVERY_MAX_INTERVAL_MS`), not the longest a review can
wait. The poll runs at the first discovery sweep at or after that instant and
the sweep fires every 15 minutes, so with Pub/Sub dark a review posted just
after one poll is found up to about six and a quarter hours later, plus the
sync itself. Two things stretch it further: a sweep that finds more than 2,000
Properties due leaves the rest to the next one, and a base interval the
operator sets above six hours (`REVIEW_DISCOVERY_INTERVAL_MINUTES`, up to 1,440)
wins over the cap, because no Property is polled more often than the base
(`docs/BETA.md` §3 "Google and Review"; `discovery-backoff.test.ts`). Holding
the decision to the letter would mean dating the poll one sweep short of six
hours and capping the base at 360 minutes. Neither is done, and whether to do
it is an open choice: this note records the difference and decides nothing.

## Note 2026-10-18 — when full reconciliation may detect deletion

Decision 5 has full reconciliation detect deletion. As implemented, a snapshot
run removes a Review that vanished from Google only after Google's own total
(`totalReviewCount`, the same on every page of both scans) matched the unique
reviews the list returned, a missed review is confirmed by a targeted read, and
two separate runs saw it missing. Until 2026-10-18 any difference between the
total and the list failed the run as `set_mismatch`, so a location whose
numbers never agree (82 counted, 81 listed, on every read) never completed a
sync.

The owner decided: accept a small gap, complete the run, and remove nothing.
A run whose total and list differ by at most 2% of the total (rounded down, at
least 1, and always under one 50-review page; widened on 2026-10-19, see the
note below), whose listing took no more
pages than its reviews fill at 50 a page, and whose confirmation scan listed
exactly the same reviews again, completes. It records no removal candidate and no first miss, and its
apply step refuses any candidate it finds. A wider gap still fails as
`set_mismatch`. A listing that disagrees with Google's total is never grounds
for removing anything. The cost is that a location whose numbers keep
disagreeing has no deletion detected until they agree again; content expiry
still removes provider content on its own clock. The completed run publishes
Google's own count and average as usual, and the worker logs
`review_snapshot_completed_with_count_gap` with the three counts only
(`application/snapshot-count-gap.ts`).

## Note 2026-10-18 — discovery polls start spread over ten minutes

The discovery sweep used to hand every due Property to the queue in the same
second, so the snapshot runs of a Google connection with a few dozen
Properties read `reviews.list` together and spent its per-minute provider
quota (30 calls per credential) in the sweep's first seconds. The sync job a
sweep enqueues now carries a start delay: a stable offset in the first ten
minutes of the sweep, derived from the Property id (`discovery-spread.ts`).
Only the sweep delays; Pub/Sub, import and manual syncs start immediately.

This decides nothing about decision 5. The offset moves when a poll starts,
not when the Property is next due (`next_incremental_at` is still dated from
the sweep), and it is the same on every sweep, so the polls of a Property stay
a due interval apart. A poll is shifted, not slowed: a review posted just after
one poll still waits no longer than the figures in the note on what decision
5's six hours measure. Ten minutes is the sweep cadence less the sweep's own
five-minute timeout, so a delayed job has always started before the next sweep
can enqueue the same Property.

## Note 2026-10-19 — a listing that changes between a run's two scans

The note on when full reconciliation may detect deletion requires a run's
confirmation scan to list exactly the reviews its main scan did. A run whose
confirmation finds a different set cannot complete, and until 2026-10-19 it
always failed as `confirmation_set_changed`: a Sentry error, an alert, a dead
letter and a repair latch. On the closed beta the largest location (3,714
reviews, about three minutes a listing) failed that way once in 189 overnight
runs, most likely a guest posting while the run was between its two listings,
and its next run completed.

As implemented now, such a run ends as `listing_changed`. It removes nothing,
since it never reaches its apply step; the worker logs
`review_snapshot_listing_changed` with Google's total and the two listings'
counts only; and the sync job starts a fresh run at once under the same
initiator and records no failure, so nothing retries, dead-letters or alerts.
When the Property's two runs before it in the same source epoch also ended
with a changed set, the run is recorded as `confirmation_set_changed` and
fails loudly as before, and so does every later one until a run completes or
ends some other way. A run lost to a cursor store restart (`cursor_lost`) is
skipped in that count: it ended before it could compare its listings. Two
quiet runs, because a change is rare (two in a row by chance is about 1 in
36,000 at the rate seen) but not independent (the fresh run covers the next
minutes of the same check-out wave or portal campaign), while a defect changes
the listing on every run and is loud on the third, minutes after the first
(`application/snapshot-listing-change.ts`).

A changed run keeps what its main listing recorded, as any failed run does.
Its removal candidates are never applied. A first miss it recorded leads to a
removal only through a later run that starts at least 15 minutes after it,
misses the review again in a listing that agrees with Google's total, finds it
gone with a targeted read, and lists the same set twice. The fresh run started
at once begins about one listing after that first miss (minutes on the largest
location), so it normally falls short of the 15 minutes; one that does not still
has to pass every other check itself, on its own two listings.

## Note 2026-10-19 — a wider count gap for small locations

The 2% rule in the note on when full reconciliation may detect deletion was too
tight for a small location. On the closed beta on 2026-10-19 one reported 86
reviews and listed 84 unique ones over two pages; 2% of 86 rounds down to 1, so
the run failed as `set_mismatch` (Sentry JAVASCRIPT-TANSTACKSTART-REACT-4), after
two earlier runs that day with gaps of 1 (85 against 84, 86 against 85) had
completed. Google's miscount is a few reviews whatever the size of the
location; a percentage only fits the big ones.

The owner decided: allow a gap of up to 5 reviews, or 2% on a big location,
always under one page. The tolerance is now

    max(1, min(49, max(5, floor(2% x total)), floor(10% x total)))

Read from the inside: 5 reviews, or 2% of the total where that is more (from a
total of 300); never 10% of the total, so a tiny location stays loud (a gap of
5 on a location of 10 would mean half its reviews unlisted); never a whole
50-review page (the cap stays at 49); never below 1. A total of
86 allows 5, 2,600 allows 49, 30 allows 3, 20 allows 2, and 10 or fewer allow 1,
as before.

Nothing else changed. A gap run still completes without removing anything: it
records no removal candidate and no first miss, and its apply step refuses any
candidate it finds, so a wider gap costs no data safety. The run is still
refused when either count is 0, when its pages are not `ceil(unique / 50)`, and
when its confirmation scan lists a different set than its main scan
(`application/snapshot-count-gap.ts`).

## Note 2026-10-20 — a listing that moves while a scan is reading its pages

The note on a listing that changes between a run's two scans made one kind of
move quiet: the confirmation finding a different set than the main scan. A
guest posting while a run is reading causes the same thing earlier in a run.
Google carries its total and its average on every page of a scan, and a page
commit refuses one that differs from the first page's (`total_changed`,
`average_changed`); a main scan also refuses a review it already listed on an
earlier page (`duplicate_resource`). On the closed beta on 2026-10-20 the
largest location (75 pages, about 15 minutes a run) failed two runs in a row as
`total_changed` (Sentry JAVASCRIPT-TANSTACKSTART-REACT-4): 3,716 expected,
lost at page 7, then 3,717 expected, lost at page 65. The total grew because
guests posted while the run was listing, and the next two runs completed. Each
failure was a Sentry error, a `sync.failed-nonzero` and `queue.quarantine-nonempty`
alert, a dead letter and a repair latch on the sync job.

As implemented now, those moves end the run as `listing_changed`, by the same
rule and the same restart as the earlier note: the run removes nothing, the
worker logs `review_snapshot_listing_changed` with Google's total and the two
listings' counts (a run that stopped in its main scan has none confirmed), and
the sync job starts a fresh run at once under the same initiator, so a first
import stays an import. The kinds of move count together towards the repeat
rule. When the Property's two runs before it in the same source epoch also
ended on a move, whichever kind, the run is recorded under the code that says
what moved (`total_changed`, `average_changed`, `confirmation_set_changed`, or
`duplicate_resource` for a review on two pages) and fails loudly as before, and
so does every later one until a run completes or ends some other way. Stored
codes stay the closed list Sentry tags and alerts know; no new code is added
(`application/snapshot-listing-change.ts`).

What counts as a move, and why:

- **Total or average differing from one page to the next.** A new review moves
  the total first, so a moved average with the same total is a re-rated review
  or Google recomputing. The direction does not matter: a review deleted
  mid-run is as much a guest as one posted, and the run removes nothing either
  way.
- **A review on two pages of the main scan.** Google lists the most recently
  updated review first by default, so a review posted or edited mid-scan shifts
  every later page by one and the last review of a page opens the next. The
  confirmation scan's twin of this was already `confirmation_set_changed`.
  Sentry has seen no such run yet; it is included because the shape is the
  same and because it is safe on the same grounds, not because it was seen.
- **Not a move, loud on the first run:** one review twice on a single page (a
  page is one response, so Google's response is broken), and one review id
  linked to two provider resources (our mapping is broken). Both still fail as
  `duplicate_resource` at once. A loud overlap is stored under the same code,
  so a run that ended on either counts towards the repeat rule, which can only
  make the next move loud sooner.

Safety. A removal needs a main scan that finished and agreed with Google's
total (`finishMainScan`, the only place a first miss or a removal candidate is
recorded), a confirmation scan that listed the same set, and a run that reached
its apply step. A run that moves mid-scan reaches none of these, so it records
no candidate and no first miss and removes nothing. It keeps what its earlier
pages observed, as any failed run does. The fresh run lists from page 0 under
its own two listings and passes every check itself.

Evidence for the threshold. Over the closed beta's five days of runs, 5 of about
2,500 ended on a listing move, on two Properties; on the largest, 3 of 143 runs,
one pair of them back to back (the pair above). Two quiet runs stay: a third in
a row is a listing that does not hold still. At the rate seen (a move was
followed by another once in three) about one chain in nine would reach a third
run, where every chain was loud before. The sample is small and runs on the
largest location are lengthening (about 7 minutes on 2026-10-17, about 14 on
2026-10-20), so a loud failure with no defect behind it is the signal to raise
`LISTING_CHANGE_QUIET_RUNS`.

## Note 2026-10-21 — a discovery look skips a Property reconciled within six hours

Decision 5 asks only that a quiet healthy Property is reconciled within six
hours, and push delivers new reviews in between. Until now the discovery sweep
did more than that: every look ran a full two-pass snapshot, so a busy
Property (hot or warm on the backoff ladder) was read in full every 15 to 30
minutes, and a push made it worse by clamping its next look to about 15
minutes ahead and keeping it hot for six hours. On the closed beta that was
10,678 `reviews.list` calls a day for about six new reviews, nearly all of
which push had already delivered, and every extra pass was another chance for
the largest location to move under a scan (the note of 2026-10-20).

As implemented now, a look that finds the Property already reconciled inside
the window enqueues nothing and only dates the next look
(`domain/discovery-reconciliation.ts`, `discover-new-reviews.job.ts`):

- **What the six hours are measured from.** The last COMPLETED reconciliation
  of the Property's current source epoch: the latest `evaluated_at` in
  `review_google_reputation_snapshot_facts`, written once per run that
  finished both scans and its deletion step. A relink starts a new epoch with
  no fact, so its first look is full. A failed or restarted run writes no fact
  and counts for nothing. Nothing else counts: not a push, not a persisted
  review, not the date the Property was imported.
- **When a look is full.** When the next look would land at or past the
  deadline, that is `lastReconciledAt + 6h <= now + interval` with the
  interval this look would be rescheduled with (15 minutes hot, 1 hour warm,
  6 hours cold, or the operator's base above that). A cold look is therefore
  always full, and so is any look when the base interval is above six hours.
  A skipped look wakes once, at `max(now + interval, lastReconciledAt + 6h -
interval)`, which is the instant the look becomes full, instead of every 15
  minutes to skip again.
- **Always full.** A Property with a coded failure still recorded
  (`review_sync_state.error_class`), so failure retries and the clearing of
  `sync.failed-nonzero` behave as before, and one with no completed
  reconciliation in its current epoch.
- **Pushes and import dates no longer cause full scans.** A push still stamps
  `last_notification_at`, persists the review by its targeted fetch and clamps
  `next_incremental_at`; the look the clamp buys now usually skips. The same
  holds for the Property's import date.
- **Only the sweep's own looks.** The push fetch and its reconcile fallback,
  failure retries, `refresh-expiring-reviews`, import and relink syncs, ops
  commands and the repair latches are unchanged.
- **Only with push.** The rule is off when `GBP_PUBSUB_TOPIC` is empty, because
  the sweep is then the only path for a new review, and when the kill switch
  `REVIEW_DISCOVERY_SKIP_RECENTLY_RECONCILED=false` is set on the worker (it
  accepts exactly `true` or `false`; default `true`). Off, every look is full
  as before.

What this decides about decision 5: nothing is loosened. The six-hour
guarantee now rests on completed reconciliations rather than on poll dates, so
it is measured from `evaluated_at` (the run's own end) and the look that
starts the next one still waits for the next sweep and up to ten minutes of
start spread, as the note of 2026-10-13 records. Two effects are accepted for
now. A review whose push is missed is found at the next reconciliation, up to
about six hours later, where it was 15 to 30 minutes (1 of the last 24 new
reviews on the beta had no push); a later change adds a one-call check of
Google's newest page. After a push-created review, Goals can show Google's own
average with the "not every review counted" note until the next
reconciliation, because the cache count is one ahead of the last verified fact.

## Note 2026-10-21 (b) — push health is measured, and so is reconciliation age

The note above leaves a missed push waiting for the next reconciliation and
says one of the last 24 new reviews on the beta had none. Nothing noticed a
silent outage: one push came 30 minutes late and one never came, and the only
sign was a review that took hours. With the sweep skipping looks, push is the
fast path for new reviews, so it is now measured (migration 0066,
`review_first_sightings`).

- **First sightings.** For each Review RepKey first sees as live work
  (`ongoing`; never a history import or a `legacy_unknown` relink) the Review
  writer records, in the same transaction as the Review's first insert, one
  content-free row per Organization, Property and Review: when it was first
  seen, how (`push`, `push_reconcile` for the full snapshot a push hands off
  to when its target cannot be read, `snapshot`, and `demand` or `head` for
  later reads that persist), and when Pub/Sub accepted the push for it. Writing it with the
  Review means a replayed snapshot page can neither lose nor duplicate it. It
  is operational history like `review_sync_runs`: 30 days, never exported.
- **When the push arrived.** The acceptance time is the outbox fact's
  `occurredAt`, carried in the push job as `acceptedAt` (a job queued before
  this change falls back to the time it starts). It is not when the job runs,
  so a push that was accepted first but waited in the queue still counts as
  first. A push that finds the Review already stored stamps the row, but
  only if it was accepted within 24 hours of the first sighting: Google reports
  an edit with the same kind as an arrival, and an edit days later must not
  turn a miss into a late push. A push that finds the Review new creates the
  row as `push`; the push is then how RepKey learned of it, so it is covered.
  An `UPDATED_REVIEW` push says a Review changed, not that a new one arrived,
  so it never stamps a Review polling already saw.
- **What the words mean** (`src/shared/domain/push-health.ts`).
  _Healthy_: a push was accepted at or before the first sighting, or the
  Review was first seen by a push or by the snapshot a push handed off to.
  _Late_: a push was accepted after polling first saw the Review, by any
  delay. _Missed_: no push was accepted by 60 minutes after the first
  sighting; a push that comes later makes the Review late as well, and it
  stays counted as missed. A Review polling found less than 60 minutes ago
  with no push yet is _pending_ and counts as neither.
- **Health, on read.** A location is suspect after one missed push in seven
  days; a Google account (Organization, connection and account) is dark after
  two across its locations. Nothing is stored for either: they are computed
  from the ledger when the health snapshot is read, in its own `syncPush`
  signal so that a slow query cannot blind the `sync` signals the sweep alerts
  hold on.
- **Alerts** (all P2, since polling still finds every Review in hours).
  `sync.push-missed`: with a topic configured, any missed push among the last
  24 hours' first sightings. `sync.push-silent`: polling found new Reviews in
  24 hours and Pub/Sub accepted no push at all. `sync.reconciliation-age`: a
  Property the sweep polls whose newest completed reconciliation of the
  current source epoch is over 8 hours old (six hours plus two of slack); a
  Property with none counts from when it became syncable, and one parked with a
  coded failure is left to `sync.failed-nonzero`. The first two count nothing
  while `GBP_PUBSUB_TOPIC` is empty; the third does not depend on push. All
  three are held while the snapshot section they read is degraded.
- **Accepted limits.** A review whose reference was lost and whose
  reconciliation snapshot was joined to a run started by the sweep is
  labelled `snapshot`, so it reads as missed. The same push can also reach a
  Review polling saw first: a lost reference or a `not_found` read hands the
  push to a full reconcile snapshot, which cannot say which Review the push was
  about, so that Review's row stays unpaired and reads as missed even though
  the push was accepted. Both need a Redis reference failure and are rare. Measurement starts at the deploy:
  Reviews first seen before it have no row. Past 5,000 polled first sightings
  in seven days (push dark for a week) the misses are a lower bound.

## Note 2026-10-21 (c) — a skipped look is followed by a head check, in dark mode

The skip-rule note above promised "a later change adds a one-call check of
Google's newest page". This is that check, shipped dark: it reads and compares,
logs what it would store, and changes nothing about any review.

Google documents page 1 of `reviews.list`, newest-updated first, as always
accurate, and on the beta 98.9% of the replies written on Google land while the
review is among its Property's newest 50. One call per look therefore sees a
missed push, an edit, most replies written on Google, and Google's own count
and average. The dark release measures how much of that a persisting check
would act on, before any of it is stored.

- **What a head check is.** `reviews.list` page 1, `pageSize=50`, with an
  explicit `orderBy=updateTime desc`. It publishes no cursor, needs no run, and
  uses the same authorizer, route and `google-reviews-v1` quota lane as a list
  page. If the page's `updateTime` values are not non-increasing, or a review
  has none, the page is an order violation and is never compared with.
- **When it runs.** A discovery look that the skip rule above leaves empty
  enqueues one head job for the Property, and dates the next look at `now` plus
  the ladder interval (15 minutes, 1 hour, 6 hours) instead of the single
  wake-up near the deadline. Full looks are unchanged. A head job is a
  `sync-property-reviews` job of mode `head`: the same family, principal and
  capability gate, with one job id per Property and interval bucket so two looks
  never stack, and the sweep's per-Property start delay. A Property with a
  recorded failure (`error_class`) is skipped: the full retry owns it.
- **What it compares.** Each review on the page against RepKey's stored copy,
  classed as it WOULD be persisted: `new` (no stored copy; a tombstoned review
  has no Google id and reads as new), `changed` (Google's `updateTime` is newer
  than the stored `source_updated_at`, or the copy belongs to an older source
  epoch), `reply_changed` (a reply present against absent, or another reply
  `updateTime` than the stored reply head; a reply whose text Google did not
  return is no difference) and `lease_refresh` (the copy was last fetched five
  days ago or more). It also computes Google's total minus the stored live count
  and the average difference.
- **What it writes.** One content-free log line per check (outcome, the counts
  above, `hasMore`, order violation yes or no, duration) and one
  `review_sync_runs` row with mode `head_dark` carrying the same counts as JSON
  in `result` (30-day retention, erased with the Organization). It stores no
  review, no reply observation, no reputation fact, no subject sighting, no
  first sighting (`review_first_sightings`, the push-health note above) and no
  `review_sync_state` change, so it never sets or clears a Property's failure.
  The log carries no Property id (the log schema, BQC-7.3, forbids tenant
  identifiers there); the row is keyed by Property.
- **It never throws.** A rate limit, a 5xx, a 404, a changed authorization, a
  malformed page and an order violation each end as a returned outcome, so a
  head job cannot fail, spend a retry or latch the job family's repair state. A
  head job for a Property whose source epoch moved ends as `obsolete`.
- **Switch.** `REVIEW_HEAD_CHECKS` is `off` or `dark` (default `dark`; exactly
  those two spellings, anything else refuses boot). `off` is exactly the skip
  rule alone. It only ever follows a skipped look, so it needs push like the
  skip rule does. A later change adds `persist`, after a week of comparison
  data.
- **Cost.** About 400 to 450 head calls a day on the beta (one per skipped hot
  or warm look; a cold Property's 6-hour interval always reaches the full look,
  so it is never skipped), inside the 30-a-minute reviews lane that the scans and
  pushes already share.

What this does not do: it does not prove a listing, so it never moves
`lastReconciledAt`, the first-import proof or a deletion check; and a review
that has dropped out of the newest 50 is invisible to it, as is every deletion.
The six-hour reconciliation still covers both.

## Note 2026-10-21 (d) — a head check can store, behind `REVIEW_HEAD_CHECKS=persist`

The note above ships the head check dark. This adds the storing, built and
shipped OFF: `REVIEW_HEAD_CHECKS` gains a third value, `persist`, and the
default stays `dark`. It is switched on by a config change once a week of dark
data (the `head_dark` rows) shows page 1 carries what the comparison says it
does. With it on, page 1 delivers missed pushes and reviewer edits, about 98.9%
of the replies written on Google, and Google's own rating and count, all within
the look interval. The full two-pass snapshot is then needed only for the
30-day content clock and for deletions. Nothing changes for `off` and `dark`.

- **What it stores, and only that.** The reviews the comparison classes `new`,
  `changed`, `reply_changed` or `lease_refresh`, through the ordinary
  observation writer, so the Review, its source observation, the reply
  observation and their events are exactly what a snapshot page would write.
  Origin is `ongoing`, with the writer's own epoch-cutoff reclassification. A
  review the page shows that matches its stored copy is NOT written again: the
  writer records a source observation carrying the review's full text on every
  call. A new review is recorded in the push health ledger as first seen via
  `head`, and stamps the discovery ladder like a snapshot's new review does.
- **One read generation per page, and keys that never repeat.** The check
  allocates ONE reply read generation right after Google answers. Each review's
  observation key is a digest of a `repkey-review-head-observation-v1`
  namespace, that generation and the review name, so a key never repeats: a
  repeated key is a replay, which returns the stored result without applying
  new content and would swallow an edit and its undoing.
- **An overtaken sync read is no longer an error.** A reply observation whose
  generation is not above the head's used to throw `invalid_transition` for every
  source. For a sync read (`provider_snapshot`: a snapshot page, a push fetch,
  a pre-publish read, a head check) it is now a silent no-op that restates the
  head and writes nothing: a head check and a snapshot page can read one review
  at once, and the newer truth is already stored. This also covers the
  reads that run before a reply is published: a read overtaken by a newer one used
  to throw and now reports `recorded`; the publication claim's own head fence still
  decides whether the reply goes out, and the newer read has already moved that
  head. The publication reconciler and
  the publish read-back (`targeted_reconciliation`) keep the throw, because their
  outcome mapping depends on being told.
- **Google's numbers, as a fact that is not a listing (migration 0067).**
  `review_google_reputation_snapshot_facts` gains `listing_complete` (default
  true) and `numbers_observed_at` (nullable). A completed snapshot run writes
  `listing_complete = true`; a head check writes `false` and the same
  `review.google_reputation_snapshot.verified` event, so Current on Google and
  goal evaluation follow Google's count and average between two completed
  listings. A head fact is written when Google's total or average differs from
  the newest fact of ANY kind for the epoch, or when that fact is six hours old
  (a heartbeat, so the Goals 24-hour rule never lapses on a quiet Property). It
  is never written before the epoch has its first completed-listing fact, and
  not at all for a total over 10,000 or an average that does not match its count.
- **`listing_complete` guards every reader that means "the history was fully
  listed".** `historyListedSince` (the first-import proof and the history or
  ongoing classification), the discovery sweep's `lastReconciledAt`, the
  `sync.reconciliation-age` alert and the content refresh's pull-forward
  (`pullLooksForward`, note (e)) read only `listing_complete = true`. A head
  fact never closes the first import, never lets the sweep skip a look, never
  resets the age alert and never makes the content refresh leave a Property
  alone: it is Google's numbers from one read of its newest page, not a listing
  of every review.
- **Google's numbers are ordered by when they were read.** `numbers_observed_at`
  is the instant the numbers were read: the run's start for a snapshot (it
  freezes the total and average at its first page, which follows the start at
  once) and the read itself for a head fact; `evaluated_at` stays when the fact
  was written. The verified event carries it, and the readers of Google's numbers
  (the Current on Google consumer, which stores it as `verifiedAt`, and so Goals,
  the headline and the fleet projection, and the Goals shown-number history) order
  by `COALESCE(numbers_observed_at, evaluated_at)`. A long snapshot that completes
  after a fresher head fact therefore cannot replace the newer numbers with its
  older ones. A head fact is stamped at least a millisecond after the newest
  fact, because the consumer refuses a tie as ambiguous.
- **No storing while a snapshot run is active.** A run in `scanning`,
  `confirming` or `deleting` that has not expired makes the head check compare
  and count but store nothing (`persisted: skipped_snapshot_active`): a head
  write between a run's page and its reply record would stale the run's
  material revision and fail the page. The check is read before the writes and
  again just before the fact is written (the fact is skipped if a run has
  started, and it is decided against the newest fact as it is by then); the small
  window left for the reviews is accepted, and costs one failed snapshot page that
  is retried. The same gate refuses to store before the
  epoch has a completed listing (`skipped_no_listing`), and when the Property's
  source epoch moved after the read (`skipped_epoch_moved`).
- **Subject sightings are deferred.** A review a head check stores gets its
  provider-subject mapping at the next completed snapshot, which is the only
  path that writes one. The limit: a review created by a head check and deleted
  on Google before the next full run is only marked observed, never missing.
  The six-hour reconciliation still owns deletions.
- **A head page can overwrite a fresher edit of the same review.** A head page is
  read once and then written review by review. A push fetch or a snapshot page
  that reads and writes a fresher edit of one of those reviews in between is
  overwritten by the older content, because the writer has no monotonic guard on
  `source_updated_at`. This already holds for a snapshot page against a push
  fetch. It heals itself: the stored `updateTime` regresses, so the next head check
  classes the review `changed` and writes it again. If the first persist-day data
  shows repeated `review.updated` events for one review, add a `source_updated_at`
  monotonic guard to the writer.
- **Never throws, no latch.** A failed write is counted (`failed` in the run
  row), logged without an identifier, and retried by the next look. It sets no
  repair latch and never touches the Property's sync failure.
- **Run rows.** A persisting check writes its `review_sync_runs` row with mode
  `head` (a dark one keeps `head_dark`): `created_count` and `updated_count` are
  what was actually stored, and `result` carries the dark comparison plus
  `persisted` (`stored` or why not), `storedNew`, `storedOther`, `failed` and
  `factWritten`.
- **The reconciliation window is configurable.** `REVIEW_RECONCILE_WITHIN_HOURS`
  (whole hours, 6 to 24, default 6) feeds the skip rule's window. The owner's plan
  is to raise it to 24 once `persist` is on and proven; that is a later config
  change with an amendment to this ADR, not part of this one. It would also move
  the `sync.reconciliation-age` threshold, which assumes a completed listing
  about every six hours (the alert and `sync-metrics` hard-code eight). Until
  that change, do not set a window above 6 hours: with `off` or `dark` a Property
  would then go up to the window between syncs, and any window above 8 hours fires
  the alert. The variable is validated on its own and does not require `persist`.
  The content refresh's own 24-hour test (note (e)) is fixed and does not follow
  this window; it is never inside it (the window is at most 24 hours), so the look
  the refresh brings forward is a full one at every allowed value.
- **Rollout.** The migration is purely additive and runs first. Keep
  `REVIEW_HEAD_CHECKS=dark` until every web and worker image carries
  migration 0067 and the filtered readers: a process that still read
  unfiltered facts would take a head fact for a completed reconciliation. To roll
  back, set `dark` and restart; head facts already written stay (they are true
  statements of what Google reported) and are ignored by the readers above.
  Rolling the CODE back after head facts exist leaves rows an old reader cannot
  filter: delete the `listing_complete = false` rows first.

## Note 2026-10-21 (e) — a failed snapshot backs off, and the content refresh moves the schedule

Two things still spent Google quota on a Property that was not going to get
better by asking again. Both are changes of timing, and neither changes what a
completed run stores.

**A repeated failure waits longer.** A snapshot run that ends in a coded failure
other than the restart-at-once ones is retried by the discovery sweep. Until now
every retry came 15 minutes later. On the largest Property one attempt is a full
double listing, about 150 calls, so a failure that recurs (Google's count off by
more than the tolerance, a listing that keeps moving) spent that quota 96 times a
day. The wait now grows with consecutive failures:

| Consecutive failure | Next retry after               |
| ------------------- | ------------------------------ |
| first               | 15 minutes (the base interval) |
| second              | 1 hour                         |
| third               | 4 hours                        |
| fourth and later    | 6 hours (the cap)              |

- **The cap keeps decision 5 and Goals' 24 hour freshness rule.** A run is still
  attempted at least every six hours, so a Property that recovers is read within
  six hours of it, and Goals never waits a day for its figures.
- **Reset.** A completed run clears the failure (`markSyncSucceeded`, as before)
  and the next failure starts at 15 minutes again.
- **Unchanged.** A location over the review or page cap (`location_too_large`)
  keeps its 24 hours. `cursor_lost` and a `listing_changed` inside the quiet
  limit still start a fresh run at once and record nothing.
- **No new column.** The wait of the previous failure is read from two columns
  that exist: `error_retry_at` minus `last_terminal_error_at`. That second column
  was never written; deferring a failure now writes it (the time of the
  failure). `error_retry_at` and `next_incremental_at` are written with one
  value, so the sweep, which selects on `next_incremental_at`, cannot reach a
  failed Property before its backoff. A failure recorded before this change has no
  time and is treated as having waited the base interval, so its next wait is
  one hour.
- **A queue retry is not a new failure.** A snapshot failure also fails the job,
  and a job has three attempts. A failure that lands before the previous
  failure's retry date is that same attempt retried by the queue: it keeps the
  previous wait instead of climbing a rung per attempt. Only a failure after the
  retry came due counts as the next consecutive one.
- **A push does not shorten a backoff.** A Pub/Sub notice pulls a parked poll
  forward to the hot interval, but never ahead of `error_retry_at`
  (`recordPushObserved`), so a busy Property cannot bypass its wait with every
  push. Once the retry date has passed, a push pulls the poll forward as before.
- **A long base interval is the floor.** If the discovery interval is set above
  the six hour cap, a repeated failure waits at least that interval, never less
  than the first failure did. A previous wait longer than the cap (for example a
  retry date rewritten by an older worker during a rolling deploy) counts as the
  cap.
- **The enqueue failure keeps the base interval.** When the discovery sweep
  cannot enqueue a Property's job (a Redis blip), it defers it by the base
  interval and does not climb the ladder, even if a snapshot failure was
  outstanding: an infrastructure fault should be retried soon, and the next
  snapshot failure then starts the ladder again from the second rung.
- **Rule and log.** The wait is a pure function (`snapshotFailureRetryMs`,
  `domain/snapshot-failure-backoff.ts`). The job logs the code and the chosen
  wait (`review_snapshot_failure_deferred`, `failureCode`, `retryAfterMs`) and
  nothing from the payload.

**The content refresh no longer queues full syncs.** `refresh-expiring-reviews`
used to enqueue a full sync for every location with a review expiring within five
days, once an hour, with no spread, no job id, and no regard for the discovery
schedule or the skip rule. Every completed snapshot already refreshes the
30-day content clock of every review it lists, so that second path only repeated
what discovery does. The sweep now asks one question per Property:

- **Last completed reconciliation older than 24 hours** (or none in the current
  source epoch; only a fact with `listing_complete = true` is a reconciliation,
  and a head fact of note (d) is not): the Property's next look is moved up to now
  (`next_incremental_at = least(next_incremental_at, now)`). The discovery sweep
  then runs it, with its start spread, the skip rule and the failure backoff
  above. Nothing is enqueued by the refresh itself.
- **Otherwise nothing.** A listing that completed inside the day refreshed every
  review Google lists. A review that still expires was not listed, and letting it
  expire is correct.
- **A failure keeps its backoff.** A Property whose failure retry date is still
  ahead is not pulled forward: the refresh would otherwise undo the wait the
  failure earned. The check and the write are one SQL statement (the update
  carries the retry-date condition), so a failure deferred while the sweep runs
  cannot be pulled forward by it.
- **Unchanged.** The hourly schedule, the keyset cursor, the run row and the
  rule that only live reviews of a Property a sync can still run for are
  considered. On the run row `enqueued_count` now counts Properties pulled
  forward and `enqueue_failed_count` counts failed schedule updates (no
  migration). The completion log carries `pulledForward`, `skippedRecent` and
  `skippedBackoff`, counts only.

Enforced by `snapshot-failure-backoff.test.ts` (the rung table, the cap, the
parked day, the reset, the queue retry), `sync-property-reviews.job.test.ts`
(the interval each failure is dated with; restart codes unchanged),
`review-discovery-backoff.repository.test.ts` (three failures against
PostgreSQL, the reset, and the pull-forward conditions, among them that a recent
head fact is no reconciliation),
`refresh-expiring-reviews.job.test.ts` and
`refresh-expiring-reviews.integration.test.ts` (the sweep enqueues nothing; it
moves the schedule only for a stale reconciliation).

## Note 2026-10-23 — an unmoved updateTime is never a guest edit

Decision 3 made a rating or text difference the whole test of an edit. On
2026-10-23 Google changed how it wraps translated review text and did not move
`updateTime`. The comparison still saw different text, created Material Review
Revision 2 on 62 closed-beta reviews, reopened 7 handled Inbox items and gave 55
open ones a Response Target that was overdue from birth; one user received 72
emails. The fix for that wrapper (the reread of the stored text with today's
parser, `normalization_shadow_match`) names a cause it already knows. This note
is the general rule under it.

A guest edit is a change Google dates: it moves the review's `updateTime`. So a
revision is created when the rating or normalized text changes **and Google's
`updateTime` moved with it**. When the rating or text differs but the incoming
`updateTime` equals the stored head's, the observation is a restatement: Google
reworded a review nobody edited. It is stored as `normalization_shadow_match`
and flagged `providerRestatement: true` on the comparison result.

- **What it does.** Exactly what `normalization_shadow_match` does: the current
  revision stays (`createsMaterialRevision: false`) and the revision row and
  `reviews.material_*` take the incoming digests, so the next read compares as
  `unchanged`. No revision means no handling cycle, no Response Target, no
  notice, no reopened Inbox item, and a reply waiting for approval is left as it
  is. `review.updated` is still announced under the unchanged revision, as for a
  shadow match. `isGuestEdit` stays true only for `material_change`.
- **Where it lives.** In the pure comparison (`compareMaterialReviewRevision`,
  optional `providerUpdateTime: { stored, incoming }`), after the reread guard,
  which still runs first and wins, and before the binding of an unchanged
  revision to a new source epoch. A restated review carried into a newer epoch is
  therefore a carry (`normalization_shadow_match` is in `NO_MATERIAL_CHANGE`, in
  `source-epoch-carry.ts`), and Inbox does not read it as an edit.
- **When it does not fire.** Either time missing keeps the old behaviour: a
  first observation, a legacy row, an erased row (erasure nulls
  `source_updated_at`, so a rewritten review re-observed after expiry stays an
  edit; a known limit of a rare path), or a read where Google sent no
  `updateTime`. That last case needs the writer's help: the sync carries the
  stored `updateTime` onto an observation that lacked one, so at the Review store
  "none" would look like "unmoved". The writer says whether Google reported one
  (`providerUpdateTimeReported`), and a missed edit, which leaves a stale
  approved reply publishable, is the harm worth a flag. A time that moved by one
  millisecond is an edit. A strictly older one is still `out_of_order_ignored`, as before.
- **Precision.** Provider times are parsed to the millisecond and Postgres keeps
  the same value, so equality is on `getTime()`, the granularity of the
  out-of-order rule and the head check. Two Google updates inside one
  millisecond are not a human edit.
- **Visible.** The next Google format change should not take a day of Inbox
  noise to find. The command store reports each applied restatement after commit
  (the writer's `providerRestatement`; not the envelope reread, a replay or a
  rolled-back write) as one content-free `review.provider_restatement` warn line
  (tenant ids are banned log fields). The stored comparison is
  `normalization_shadow_match`, so restated rows are found retroactively by a
  `normalization_shadow_match` whose `normalized_digest` differs from the
  previous applied observation's at an unmoved `source_updated_at`.
- **Why no separate stored value.** A `provider_restatement` value would need
  the CHECK on `review_source_observations.comparison_result` restated. That
  table holds 3.37M rows (a 2.5 GB heap) on the beta, and a read-only scan of it
  took 37 s with two parallel workers, so validating the CHECK would hold an
  ACCESS EXCLUSIVE lock for one to two minutes inside the deploy's single
  migration transaction (drizzle applies every pending file in one, so a
  `NOT VALID`/`VALIDATE` pair does not help), while the old web and worker run
  with a 10 s `lock_timeout`: failed syncs and page reads. The CHECK is left as it
  is. A separate value can come once that table is pruned.
- **Not retroactive.** The 62 revision-2 rows already written stay recorded as
  `material_change`; the cycles they opened are left out of the counts by the
  exclusion ledger below.

**The exclusion ledger (migration 0069).** Decisions 8 and 11 make prior cycles
and their Response Targets immutable history, and a database trigger refuses any
rewrite of a completed target, so the 62 cycles cannot be corrected in place.
Cancelling the 55 open targets would state a reason that is not true
(`superseded_by_source_revision`) and would make the later real reply fail to
close the item; the 7 completed ones cannot be reached at all. Instead
`inbox_response_target_exclusions` records, beside the target and append-only
(a trigger refuses UPDATE and any DELETE that is not the cascade from its
target), that one cycle is left out of reporting. The Google analytics, the
per-Property overdue figures, reminder selection and admission and the waiting
time skip it; it reads "Not measured"; a later real reply still closes it and the
completion stays out of the figures; the organization export marks the row.
Review lists the restated revisions of a Property and Inbox, which may not read
Review tables, finds the cycles they opened:
`pnpm ops inbox exclude-restated-revision-targets <propertyId>` (dry run first;
runbooks §29). No cycle, transition, head, item or counter moves.

Enforced by `material-review-revision.test.ts` (equal, one millisecond either
way, missing times, the legacy baseline, the reread guard winning),
`source-epoch-carry.test.ts`, `sync-reviews.test.ts` (the flag),
`review-command-store.provider-restatement.integration.test.ts` (the sequence of
comparisons, adopted digests, a pending reply untouched until the real edit,
the announced revision, no released sequence, the erasure limit, the report),
`review-command-store.provider-envelope.integration.test.ts` (the envelope
reread is stored the same way and not reported),
and the epoch-carry, sequence-release, Google-page and head-persist integration
suites. The ledger is enforced by `response-target-exclusion-readers`,
`restated-revision-target-exclusion.store`, `restated-revision.repository`,
`inbox-response-target-exclusions`, `inbox-item-lookup.response-target-exclusion`
and `inbox-organization-export.target-exclusion` integration suites and the
command's unit and integration tests.

## Note 2026-10-24 — a re-read of an unchanged review writes no observation row

Owner decision 2026-10-24 (option A of the observation-growth proposal).
Decision 3 versions every provider observation. Until now that meant one
`review_source_observations` row per read, and each row carries the review's full
text. A snapshot pass reads every review twice, and the reconciliation in
decision 5 runs every six hours. So a review nobody touched gained four to eight
copies of its text a day. Measured read-only on the beta on 2026-10-23: 3,425,776
rows for 12,599 reviews (median 277 per review), 3,668 MB of a 4,388 MB database.
3,400,389 of them (99.3%) repeat the row before them exactly, and about 86k more
were still added each day after the polling cut. ADR 0031 allows raw content only
inside a refresh-or-remove cache. Hundreds of identical copies per review is not a
cache.

- **What it does.** `persistReviewObservation` writes no row when the read
  matches the Review's newest observation. That means: the same source epoch,
  live content on the Review and on that row, comparison `unchanged` with no new
  revision, the same material revision, and the same observation digest. The
  digest covers rating, text, translation, language, reviewer name and photo,
  `reviewedAt`, and Google's create and update times. Instead, the newest row
  takes the Review's new `content_expires_at`, and `updated_at` becomes the time
  of that fetch. A fetch of the same content restarts its 30-day clock (ADR
  0031), and the lifecycle inspection requires the newest row's clock to equal
  `review_source_contents`. Its `observed_at` stays the first time this content
  was seen. Everything else is as before: the Review row, the source cache, the
  revision row, the recorded path's analysis sequence and event, and the purge
  of AI drafts whose time ran out. `reviews.source_observation_sequence` does
  not move, and the result carries the newest row's sequence.
- **What still writes a row.** Anything Google reports differently: an edit, a
  restatement, a new translation, a new photo, an `updateTime` that moved, a new
  source epoch, an out-of-order read, and the first read after erasure.
  `googleReviewUrl` is in no digest, so a new or dropped page link is a refresh
  in place, as it was already no new revision.
- **Replays.** A key whose row exists is still a replay. A skipped read stored
  no key. Keys are scoped to run, phase, page and review (or to the head check's
  read generation), so a key repeats only when a job is retried. A retry then
  matches the newest row and refreshes it again, or it is an out-of-order read.
- **The head check.** Note (d) gave a reason for not storing a review that
  matches its stored copy: "the writer records a source observation carrying the
  review's full text on every call". That reason no longer holds. The rule
  stands anyway, because it also saves the transaction and the lock.
- **What every reader keeps.** The lifecycle inspection's newest row, the first
  observation of each revision (`selectRevisionBindingComparisons`), and every
  `material_change` with the applied row before it (`listRestatedRevisions`).
  None of them read a repeat.
- **Rows already written.** This note leaves them alone. The backlog prune and
  the 30-day rule for superseded copies come with their own note.

Enforced by `review-observation-head-refresh.integration.test.ts`: no row on
either write path, the clock moved, lifecycle findings empty, a replayed key, a
translation, a moved `updateTime`, an edit then its refresh, and a read after
erasure. The Google-page and provider-restatement integration suites assert the
smaller history.

## Note 2026-10-24 (b) — the repeats are pruned once, and a superseded copy expires

Owner decision 2026-10-24 (option A, parts 2 and 3). The note above stops new
repeats. This one deals with the rows already written, and with how long a copy
Google no longer shows may be kept.

- **A repeat.** A repeat is an `unchanged` row that meets three conditions:
  - it is not its Review's newest row;
  - an applied row comes before it (the nearest earlier row that is not
    `out_of_order_ignored`);
  - that row has the same source epoch, material revision, observation digest
    and content state.

  On the beta, 3,400,389 of 3,425,776 rows are repeats. Deleting them changes no
  reader's answer:
  - The lifecycle inspection's newest row stays.
  - The first row of a revision is never `unchanged`, so
    `selectRevisionBindingComparisons` reads the same row.
  - The applied row before any `material_change` is either kept or has the same
    digest as the kept row before it, so `listRestatedRevisions` and the
    runbook §29 queries see the same `source_updated_at` and epoch.
  - An out-of-order row is kept.

- **The prune is an operator command, run once.**
  `pnpm ops review-observations prune` (runbooks §30) walks the Reviews in id
  order, up to 20,000 per batch, across every Organization or within one. It
  deletes each batch's repeats in one statement. A Review's rows are scattered
  over the heap, so a batch reads best as one sequential pass. Measured on the
  beta on 2026-10-24: every Review in one statement took 8 s to scan (3,497,715
  repeats). 100 Reviews, read through the index, took about 50 s, so the first
  batch size of 100 would have taken hours. One batch covers the beta.
  **Applied 2026-10-24** (owner approved). The batch deleted 3,497,717 rows and
  kept 25,407. It took 40 min because the DELETE ran as primary-key probes.
  `VACUUM FULL` then took the table from 3,784 MB to 27 MB and the database from
  4,545 MB to 787 MB (runbooks §30 has the measurements and the one sync step
  that failed on the lock). A dry run is the default.
  `--apply` needs a reason and the typed confirmation, and records one
  content-free `retention_runs` row (`review_source_observations.repeats`). A
  stopped run leaves whole batches done, and a re-run is safe. It is not
  scheduled, because the writer makes no new repeats.
- **A superseded copy expires.** A row that is no longer its Review's newest is
  never fetched again, so its `content_expires_at` stays at the last fetch that
  returned that content plus 30 days. ADR 0031 allows raw content only as a cache
  that is refreshed or removed. Google's 2026-07-14 response says the same: raw
  review content "should be refreshed or removed in accordance with the
  applicable 30-day policy". Nothing refreshes a superseded copy, so it is
  removed. The daily retention sweep subject
  `review_source_observations.superseded_expired` blanks the rating, text,
  translation, language, reviewer name and photo address, and Google's create and
  update times, of such a row once that clock has passed. It runs 500 rows per
  batch, at most 100 batches per run, oldest clock first, with `SKIP LOCKED`. It
  sets `content_state = 'source_expired'`, the state erasure writes, so the
  table's CHECK holds as it is. The digests, comparison, revision and RepKey's
  own times stay. The newest row is the Review's current content, refreshed by
  every pass. It stays with the Review lifecycle, which this never touches.
- **What the expiry costs.** After 30 days, a superseded row no longer shows
  Google's `updateTime`. So `listRestatedRevisions` and the runbook §29 queries
  can no longer judge a `material_change` whose previous row was superseded
  more than 30 days ago. Their one use, the 2026-10-23 restatements, is done
  (the exclusion ledger above). From that rule on, a restatement creates no
  revision.
- **Registry.** `google.superseded_observation_copies` (data class
  `google_source_content`, horizon `row_deadline` on `content_expires_at`,
  operation `redact`) is in `retention-registry.ts`. The data-fate row of
  `reviewSourceObservations` states its exit criteria. Retention policy version
  10 stamps the new evidence.

Enforced by `observation-retention.repository.integration.test.ts`. On the
prune side it covers: only repeats deleted, the newest row, the out-of-order row
and the revision rows kept, the binding comparisons, lifecycle findings and
restated list unchanged, scan writes nothing, a second prune finds nothing,
keyset batches, and an erased Review. On the redaction side: only superseded
copies past their clock, digests kept, the newest row untouched even when its
clock has passed, and the sweep cap. Also enforced by `retention-sweep.job.test.ts`
(evidence and failure isolation), `review-observations-command.test.ts`, the
tenant-predicate canary and the retention registry tests.

## Merged from ADR 0003

Introduce a new `review` bounded context for external platform reviews,
separate from the existing `integration` context.

## Merged from ADR 0004

Introduce a new `inbox` bounded context that provides a unified triage surface
for reviews and private feedback. It is not a mere read-model — it has
write-side domain logic.

## Supersession

This ADR supersedes ADR 0003 decisions 2–9 where they prescribe push-only sync,
derived subscription state, destructive Review purge, Reply as a Review child
without independent lifecycle, or content-bearing lifecycle assumptions. It
supersedes ADR 0004's status ladder, legacy Team/Staff assignment authority,
generic bulk-close behavior, read/claim coupling, and direct cross-context joins.
The bounded-context separation itself remains valid.

## Consequences

- Review, Inbox, Reply, Google integration, AI, metrics, and notifications share
  explicit revision/source-epoch contracts instead of inferring state from one
  mutable row.
- Migration is expand/reconcile/shadow/cutover/contract; historical identity and
  manager work are never discarded to simplify provider-content retention.
- Rebuild, duplicate, out-of-order, stale-writer, provider ambiguity, expiry, and
  re-observation proofs are release requirements.

## Rejected alternatives

- **Delete the Review when Google content expires** — destroys RepKey-owned work
  and breaks stable managerial history.
- **One mutable Inbox status** — conflates reading, assignment, escalation,
  handling, and provider publication.
- **Treat an API publish response as live confirmation** — cannot safely resolve
  ambiguous provider outcomes.
