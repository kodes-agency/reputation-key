# Phase 16.2 — Badges and Leaderboards Implementation Plan

**Status:** Ready for implementation  
**Date:** 2026-06-13  
**Source decisions:** Phase 16.2 grilling session, `CONTEXT.md`

## 1. Phase goal

Deliver automatic portal/group recognition and fair property-scoped ranking:

- Staff earn and view badges for assigned portals/groups.
- Managers see managed-property badge and leaderboard history.
- Leaderboards rank portals and portal groups within a selected property.
- Badge and leaderboard data are event-driven with hourly reconciliation.

## 2. Resolved product decisions

### Badges

| Decision                     | Answer                                                    |
| ---------------------------- | --------------------------------------------------------- |
| Badge targets                | Portals and portal groups                                 |
| Portal group membership      | Evaluated at award time; awards are immutable             |
| Deleted portal/group history | Awards remain visible after soft-delete                   |
| Criteria types               | Threshold, streak, milestone                              |
| Special criteria             | Excluded from Phase 16.2                                  |
| Operators                    | `>=` and `<=`                                             |
| Metric scope                 | Portal-scoped metrics only                                |
| Recurrence                   | One-time achievements per target                          |
| Idempotency                  | `badge_definition_id + criteria_version + target_id`      |
| Criteria versioning          | Increment only when earning rule changes                  |
| Evaluation                   | Immediate metric-event evaluation + hourly reconciliation |
| Definition ownership         | System-seeded, org-enabled, not manager-edited            |
| Disabled definitions         | Prevent future awards; existing awards remain visible     |
| Visibility                   | Role/assignment filtered                                  |
| Notifications                | Property managers + staff assigned to awarded target      |
| UI placement                 | Staff home, leaderboard, portal detail                    |
| Streak timezone              | Target portal's property timezone                         |

### Initial badge library

1. First Review
2. First Feedback Response
3. 100 Scans
4. 500 Scans
5. 1000 Scans
6. 10 Feedback Responses
7. 50 Feedback Responses
8. 4.5 Avg Rating This Month
9. 7-Day Scan Streak
10. 5-Day Feedback Streak

### Leaderboards

| Decision          | Answer                                                                  |
| ----------------- | ----------------------------------------------------------------------- |
| Ranking scope     | Portals and portal groups within a selected property                    |
| Property ranking  | Excluded from Phase 16.2                                                |
| Score model       | Composite + per-metric drill-down                                       |
| Composite weights | 40% average rating, 30% feedback, 20% scans, 10% review-link clicks     |
| Normalization     | Property-scoped percentile per period                                   |
| Periods           | Today, this week, this month, this quarter, all time, last 7/30/90 days |
| Snapshot strategy | Event-driven snapshots + hourly reconciliation                          |
| Snapshot key      | Property + period + scope + metric                                      |
| Tie handling      | Equal scores share rank; deterministic order only for display stability |

## 3. Architecture changes

### New contexts

Create two new bounded contexts:

1. `src/contexts/badge/`
   - Owns badge definitions, criteria, awards, events, evaluation, and public API.

2. `src/contexts/leaderboard/`
   - Owns leaderboard scoring, normalization, snapshots, ranking, and public API.

Do **not** put badges inside `goal`. Do **not** create a broad `gamification` context for Phase 16.2.

### Shared dependencies

Badge context depends on:

- `metric` for metric history and metric keys
- `portal` for portal/group metadata and soft-delete state
- `notification` for `badge.awarded` event publication
- `activity` for audit events if required by existing activity conventions

Leaderboard context depends on:

- `metric` for metric history
- `portal` for portal/group metadata and soft-delete state
- `dashboard` only for shared metric aggregation conventions if needed, not as owner

## 4. Badge context implementation

### Domain entities

Create:

- `BadgeDefinition`
- `BadgeCriteria`
- `BadgeAward`
- `OrganizationBadgeEnablement`

### Database tables

Create migrations for:

- `badge_definitions`
  - `id`
  - `key`
  - `name`
  - `description`
  - `icon`
  - `target_scope`
  - `criteria_version`
  - `criteria_json`
  - `enabled`
  - `created_at`
  - `updated_at`

- `organization_badge_enablements`
  - `organization_id`
  - `badge_definition_id`
  - `enabled`
  - `created_at`
  - `updated_at`

- `badge_awards`
  - `id`
  - `badge_definition_id`
  - `criteria_version`
  - `target_type`
  - `target_id`
  - `organization_id`
  - `property_id`
  - `awarded_at`
  - `unique_key`
  - unique constraint on `unique_key`

### Events

Add:

- `badge.awarded`

Payload should include:

- `badgeDefinitionId`
- `criteriaVersion`
- `targetType`
- `targetId`
- `organizationId`
- `propertyId`
- `awardedAt`

### Use cases

Implement:

- `seedBadgeDefinitions`
- `evaluateBadgeForTarget`
- `reconcileBadgeDefinitions`
- `getVisibleTargetBadges`
- `getStaffVisibleBadges`
- `setOrganizationBadgeEnablement`

### Evaluation rules

- Trigger evaluation from `metric.recorded`.
- Reconcile hourly for missed events.
- Only evaluate enabled org definitions.
- Skip already-awarded `unique_key`.
- For group badges, evaluate current group membership at evaluation time.
- Store awards as immutable historical facts.
- Do not revoke awards on membership changes, definition disablement, portal soft-delete, or portal group soft-delete.

### Streak evaluation

- Use metric history grouped by property-local calendar day.
- Consecutive-day streaks are evaluated in the target portal's property timezone.
- Streaks are not evaluated through goal progress.

## 5. Leaderboard context implementation

### Domain entities

Create:

- `LeaderboardEntry`
- `LeaderboardSnapshot`
- `LeaderboardScore`

### Database tables

Create migrations for:

- `leaderboard_snapshots`
  - `id`
  - `property_id`
  - `period`
  - `scope`
  - `metric_key`
  - `score_key`
  - `last_updated_at`

- `leaderboard_entries`
  - `snapshot_id`
  - `rank`
  - `target_type`
  - `target_id`
  - `organization_id`
  - `property_id`
  - `score`
  - `metric_value`
  - `normalized_score`
  - `updated_at`

### Snapshot keys

Use:

```ts
{
  ;(propertyId, period, scope, metricKey)
}
```

Where:

- `scope` is `portal` or `portal_group`
- `metricKey` is `overall` for composite or a concrete metric key for drill-down

### Scoring

Composite formula:

```ts
score =
  0.4 * normalizedRating +
  0.3 * normalizedFeedback +
  0.2 * normalizedScans +
  0.1 * normalizedReviewLinkClicks
```

Normalization:

- Compute percentiles within the selected property and period.
- Compare portals against portals and portal groups against portal groups.
- Ungrouped portals remain individual entries.

### Tie handling

- Equal scores share the same rank.
- Use deterministic secondary ordering only for stable display order.

## 6. UI implementation

### Staff home

Add badge section to existing staff home summary.

Show:

- recently earned badges
- total badge count for assigned portals/groups
- link to leaderboard

### Leaderboard route

Replace placeholder `/leaderboard` with:

- period selector
- portal/group toggle
- overall tab
- per-metric tabs
- rank, target, score, metric value
- last updated timestamp

### Portal detail

Show:

- badges earned by that portal
- badges earned by the portal's group, if any
- historical deleted target labels where applicable

## 7. Worker/job changes

Update worker registration for:

- badge reconciliation job
- leaderboard reconciliation job

Recommended job names:

- `badge.reconcile`
- `leaderboard.reconcile`

Keep existing goal reconciliation jobs unchanged.

## 8. Migration sequence

1. Add badge schema and leaderboard schema.
2. Add badge/leaderboard context skeletons.
3. Seed system badge definitions.
4. Implement badge evaluation use cases.
5. Wire metric events to badge evaluation.
6. Add badge reconciliation job.
7. Implement leaderboard scoring/snapshot use cases.
8. Wire metric events to leaderboard snapshot refresh.
9. Add leaderboard reconciliation job.
10. Add notification event handler for `badge.awarded`.
11. Add UI sections.
12. Add tests.

## 9. Test strategy

### Badge tests

Cover:

- threshold criteria
- streak criteria
- milestone criteria
- `>=` and `<=` operators
- portal-scoped metric filtering
- one-time award idempotency
- criteria version idempotency
- org enable/disable behavior
- group membership at award time
- deleted portal/group historical visibility
- notification audience

### Leaderboard tests

Cover:

- portal ranking
- portal group ranking
- property-scoped percentile normalization
- composite formula
- per-metric drill-down
- snapshot key uniqueness
- event-driven refresh
- hourly reconciliation
- tie handling
- period filtering

### Integration tests

Cover:

- metric event → badge award → notification
- metric event → leaderboard snapshot refresh
- staff assignment visibility
- manager visibility
- portal/group soft-delete history

## 10. Acceptance criteria

Phase 16.2 is complete when:

- All 10 seed badges can be evaluated and awarded once.
- Staff see badges only for current assigned portals/groups.
- Managers see managed-property badge and leaderboard history.
- Deleted portals/groups retain historical badge visibility.
- Leaderboards rank portals and portal groups within a selected property.
- Composite and per-metric leaderboards use the agreed formula and normalization.
- Badge and leaderboard updates are event-driven with hourly reconciliation.
- `CONTEXT.md` and ADRs reflect the final decisions.
