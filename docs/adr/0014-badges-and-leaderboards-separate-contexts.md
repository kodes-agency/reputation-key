# ADR 0014 — Badges and Leaderboards as Separate Recognition Contexts

**Status:** Accepted  
**Date:** 2026-06-13

## Context

Phase 16.2 adds staff-facing recognition and performance comparison:

- Badges are earned by portals or portal groups when metric-driven criteria are met.
- Leaderboards rank portals and portal groups within a selected property.
- Existing `goal` context already tracks property-scoped goals and progress.
- Existing `dashboard` context already provides read-only property KPIs.
- A previous archive plan considered either `contexts/gamification/` or splitting into `goal` and `badge` contexts.

The design needs a stable home for badge definitions, badge awards, badge notifications, leaderboard scoring, and leaderboard snapshots without overloading existing contexts.

## Decision

1. **Introduce a `badge` bounded context.**

   The `badge` context owns:
   - `BadgeDefinition`
   - `BadgeCriteria`
   - `BadgeAward`
   - `OrganizationBadgeEnablement`
   - badge evaluation
   - badge reconciliation
   - `badge.awarded` events

2. **Introduce a `leaderboard` bounded context.**

   The `leaderboard` context owns:
   - `LeaderboardSnapshot`
   - `LeaderboardEntry`
   - composite scoring
   - per-metric drill-down scoring
   - property-scoped percentile normalization
   - leaderboard reconciliation

3. **Keep badges and leaderboards separate.**

   Badges are immutable recognition facts. Leaderboards are competitive rankings. They share metric and portal data, but they have different lifecycles.

4. **Do not create a broad `gamification` context for Phase 16.2.**

   `gamification` is too broad and undefined. It would encourage unrelated reward mechanics to be grouped together before the product shape is known.

5. **Do not put badges inside the `goal` context.**

   Goals and badges both use metrics, but goals track planned progress while badges track earned recognition. Combining them would conflate two domain concepts.

## Consequences

- New context directories are required:
  - `src/contexts/badge/`
  - `src/contexts/leaderboard/`

- New database tables are required for badge definitions, organization enablements, badge awards, leaderboard snapshots, and leaderboard entries.

- Badge awards are immutable historical facts:
  - They are not revoked when criteria stop being true.
  - They are not revoked when portal group membership changes.
  - They remain visible after portal or portal group soft-delete.

- Leaderboard snapshots are read models:
  - Keyed by property, period, scope, and metric.
  - Refreshed by metric events.
  - Reconciled hourly.

- The `metric` context remains the source of metric history.
- The `portal` context remains the source of portal and portal group metadata.
- The `notification` context remains responsible for user-facing notification delivery.

## Rejected Alternatives

- **Put badges inside `goal`** — This would make goals own recognition awards. Goals are forward-looking progress contracts; badges are historical recognition facts.

- **Create a broad `gamification` context** — This would be premature. Phase 16.2 has two concrete domains: badges and leaderboards. A broader context would hide their distinct lifecycles.

- **Put leaderboards inside `dashboard`** — Dashboard KPIs are property-level read-only summaries. Leaderboards require ranking, normalization, scoring, snapshot keys, and per-metric drill-downs.

- **Support property-vs-property leaderboards** — Phase 16.2 ranks portals and portal groups within a property. Cross-property ranking would compare different traffic bases and property contexts.
