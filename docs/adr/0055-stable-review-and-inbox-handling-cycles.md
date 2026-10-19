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
least 1, and always under one 50-review page), whose listing took no more
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
gone with a targeted read, and lists the same set twice; the fresh run started
at once is never that run.

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
