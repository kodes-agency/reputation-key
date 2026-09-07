# Current on Google reputation snapshot

## Scope and truthful meaning

**Current on Google** is one content-minimal, point-in-time provider state for a
Property: Google's total review count, Google's average rating, and the time at
which RepKey finished verifying them. It is separate from:

- private 1–5 Portal ratings;
- bounded-period `property.review` metric readings and Goal measures;
- Portal lifetime analytics; and
- any estimate calculated from locally retained Review content.

The state is available only after Review completes a main Google page scan, a
confirmation scan, and its bounded missing-Review reconciliation with an
unchanged provider count and average. This implementation does not call Google
when the value is read, add a manager-facing screen, schedule a new recurring
scan, activate a production capability, or prove a production Google run.

## Provider and Review validation

Every page in both scans must carry the same provider aggregate. A run fails
closed if its count or average changes, a positive count has no average, a
zero count has a non-zero average, the count exceeds the existing bounded
snapshot limit, or the average is outside `0..5`.

After the confirmation scan, Review reconciles confirmed-missing source rows in
bounded transactions. Only when that suffix is empty does one transaction:

1. mark the exact snapshot run completed;
2. append a Review-owned aggregate fact; and
3. append `review.google_reputation_snapshot.verified` to the outbox.

The fact contains Organization, Property, source epoch, run/event identities,
count, average, and evaluation time. It contains no provider account/location
identifier, Review ID, reviewer presentation, rating distribution, or text.

## Metric projection and reads

The durable `metric.current-google-reputation` consumer stores the fact in
`metric_current_google_reputation_snapshots`, not `metric_readings`. Its shared
consumer receipt and projection mutation share one database transaction.
Duplicate delivery converges without another projection write. An older source
epoch or verification time is recorded obsolete; a future epoch, same-run
conflict, payload drift, or equal-time conflicting version fails and remains
retryable or diagnosable rather than silently replacing state.

Metric exposes the narrow `getCurrentOnGoogle(organizationId, propertyId)`
read. It joins current Property authority and returns a row only when the stored
source epoch matches. Reconnecting/rebinding Google therefore makes the old row
unavailable immediately; it remains stored as provenance until a later
verified fact replaces it. Absence returns `null`, never a fabricated zero.

## Diagnostics and evidence

Use database access approved for the environment and inspect only aggregate
and identifier columns. For one Property, verify:

1. the Review run is `completed` and `terminal`;
2. one fact exists for its `run_id` and `event_id`;
3. the outbox row has the same event identity and aggregate version;
4. the `metric.current-google-reputation` receipt is `applied`, `duplicate`, or
   deliberately `obsolete`; and
5. an applied projection matches Organization, Property, source epoch, run,
   event, count, average, and evaluation time exactly.

Do not place provider identifiers or Review content in incident notes. A
completed local test or migration is implementation evidence only. Production
evidence must name the release, cell, Property scope, source epoch, run/event
identities, timestamps, and durable receipt outcome without claiming that the
snapshot is a bounded-period metric.

## Containment, recovery, and rollback boundary

If values appear stale or contradictory, stop the current-snapshot consumer
before changing projection state and preserve Review facts, outbox rows, and
receipts. Confirm Property source authority and the exact Review run first.
Never repair this state by averaging retained Reviews, copying a bounded metric,
changing a receipt, or editing the projection directly.

The implementation has no standalone replay/rebuild operator command. Recovery
may rely on the existing durable outbox retry path while its source fact and
outbox retention remain available. After that window, a separately reviewed
rebuild procedure is required; this runbook does not authorize one. Rolling
back a reader or consumer must not delete Review facts or reinterpret an old
source epoch as current.
