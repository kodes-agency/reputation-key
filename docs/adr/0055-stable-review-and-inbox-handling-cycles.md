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
