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
