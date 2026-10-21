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
   guest text changes. Translation, photos, metadata, and observation timestamps
   do not create a material revision.
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

## Note 2026-10-21 — a skipped look is followed by a head check, in dark mode

The note above promised "a later change adds a one-call check of Google's
newest page". This is that check, shipped dark: it reads and compares, logs
what it would store, and changes nothing about any review.

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
  review, no reply observation, no reputation fact, no subject sighting and no
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
- **Cost.** About 400 to 450 head calls a day on the beta (one per skipped hot,
  warm or cold look), inside the 30-a-minute reviews lane that the scans and
  pushes already share.

What this does not do: it does not prove a listing, so it never moves
`lastReconciledAt`, the first-import proof or a deletion check; and a review
that has dropped out of the newest 50 is invisible to it, as is every deletion.
The six-hour reconciliation still covers both.

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
