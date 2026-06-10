# ADR 0013 — Portal Groups Replace Team and Staff as Goal/Leaderboard Scopes

**Status:** Accepted
**Date:** 2026-06-09

## Context

The original model had four entity scopes for goals and leaderboards: `property`, `portal`, `team`, `staff`. Teams and staff could have goals targeting their collective or individual performance.

The portal model evolved: one portal = one QR code = one physical touchpoint. Portals are either area-based (reception desk) or employee-based (one per staff member). All metrics flow to the portal — scans, ratings, feedback, review link clicks. There is no metric that flows to a person independent of a portal.

Hotels with many portals (per-room, per-employee) need a way to group them for collective performance tracking: "How is reception doing?" = aggregate metrics of all reception portals.

## Decision

1. **Introduce `PortalGroup`** — a named collection of portals within a property. One portal belongs to at most one group. Metrics are always aggregated from member portals at query time (no pre-computed group metrics).

2. **Replace `EntityScope`** from `'property' | 'portal' | 'team' | 'staff'` to `'property' | 'portal_group' | 'portal'`.

3. **Remove `teamId` and `staffId`** from the Goal type. Add `portalGroupId` as a nullable FK.

4. **Teams remain** as an administrative concept (staff rostering, shift management) but are no longer a metrics or goal scope.

5. **Staff remain** as portal assignment metadata (which human manages a portal) but are no longer a metrics or goal scope.

6. **`staffId` kept on event tables** (`scan_events`, `ratings`, `feedback`) for operational attribution ("who was at the desk when this rating came in"). **Removed from `metric_readings` and `goals`** — aggregate tables don't need staff attribution.

## Consequences

- Goal types change: `teamId: TeamId | null` and `staffId: StaffId | null` are replaced by `portalGroupId: PortalGroupId | null`.
- `deriveEntityScope()` simplifies to three branches: `portal_group > portal > property`.
- `VALID_SCOPE_METRIC_KEYS` loses `team` and `staff` entries. `portal_group` uses the same keys as `portal`.
- Leaderboards rank properties, portal groups, and individual portals — not teams or staff.
- Deleting a portal group cancels all active goals scoped to it (same pattern as `portal.deleted` cancelling portal-scoped goals).
- Group-scoped goal progress uses live membership — moving a portal between groups mid-period retroactively changes both groups' numbers.
- **Migration required:** any existing goals with `teamId` or `staffId` set must be cancelled or converted before the FK columns are removed.

## Rejected Alternatives

- **Keep team scope alongside portal groups** — Teams are groups of people, portal groups are groups of portals. But "how is the reception team doing?" and "how is the reception portal group doing?" answer the same question with different numbers (staff assignments vs. portal membership). Confusing and redundant.
- **Tag-based grouping** — Portals tagged with labels instead of first-class groups. Too loose for goal scoping — removing a tag mid-period breaks goal semantics. No unique identity for leaderboard ranking.
- **Pre-computed group metrics** — Write group-level metric readings when portal metrics arrive. Complicates write path; group membership changes require backfilling. Query-time aggregation is simpler and correct for MVP scale.
