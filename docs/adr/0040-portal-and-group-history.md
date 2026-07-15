# ADR 0040 — Portal and Group History Use Event-Time Attribution

**Status:** Accepted
**Date:** 2026-07-15
**Supersedes:** ADR 0013's live-membership/retroactive-history clause only (the portal-group-as-reporting-scope decision stands)

## Context

ADR 0013 established portal groups as the property-local reporting scope replacing team/staff scope. Its implementation captures group attribution using live (query-time) membership: when a metric reading is recorded, the portal's current group is looked up and stored. This means:

1. Moving a portal to another group silently rewrites historical attribution.
2. A transient group-lookup failure records `groupId = null` as permanent truth.
3. Historical reports cannot be reproduced because the group assignment at the time of the event is lost.

## Decision

Portal group attribution is **event-time and non-retroactive**:

1. When a source event occurs, resolve the portal's group as of `occurred_at`, not query time.
2. Record the resolved group and `attribution_quality` (`exact`, `current_state_backfill`, or `unresolved`).
3. Moving a portal to another group ends the old membership interval and starts a new one. Past facts retain the group captured when they occurred.
4. A genuine source error produces a correction; it does not silently rewrite the group.
5. Facts before migration may have `attribution_quality = current_state_backfill` — a documented limit, not a hidden rewrite.

## Consequences

- `PortalGroupMembership` is effective-dated with half-open intervals.
- Metric readings and rollups capture the group resolved as-of `occurred_at`.
- Historical reports are reproducible: the group at event time is immutable.
- A group-lookup failure during ingestion quarantines or retries; it never becomes a silent `null` fact.

## Rejected Alternatives

- **Live (query-time) group lookup** — rewrites history silently; a past report changes when a portal moves.
- **Rebuild group attribution from current state on demand** — cannot distinguish event-time truth from current state.
