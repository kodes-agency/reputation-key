# Goal Context

Property-scoped goals with progress tracking driven by metric events.

## Glossary

| Term                    | Definition                                                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------- |
| **Goal**                | A property-scoped target (e.g. "reach 4.5 average rating", "collect 50 reviews"). Belongs to an organization and is scoped to a property, portal, team, or staff member.          |
| **GoalType**            | `'open'`, `'one_shot'`, `'rolling'`, or `'recurring'`. Determines how time periods and progress are computed.                                                                     |
| **GoalStatus**          | Lifecycle: `active` → `completed`, `expired`, or `cancelled`. Only `active` goals accept progress updates.                                                                        |
| **GoalProgress**        | Current numeric progress toward a goal's target. Tracks `currentValue`, `currentSum`, `currentCount`, and `computedSource`. One-to-one with a Goal.                               |
| **GoalInstance**        | A recurring goal's spawned child for a specific period. Has `parentGoalId` set to the template Goal. Shares the template's metric, aggregation, and target.                       |
| **AggregationFunction** | How progress is computed from raw metric readings: `sum`, `count`, `max`, `avg`. Must be valid for the chosen `MetricKey`.                                                        |
| **MetricKey**           | Which metric feeds this goal (e.g. `rating_average`, `review_count`). Valid keys depend on the goal's `EntityScope` (property, portal, team, staff).                              |
| **EntityScope**         | The level at which a goal operates: `property`, `portal`, `team`, or `staff`. Derived from which nullable FK is filled (`portalId`, `teamId`, `staffId`). Falls back to property. |
| **RecurrenceRule**      | Configuration for recurring goals: `{ frequency: 'weekly'                                                                                                                         | 'monthly' | 'quarterly' }`. Required for `recurring` type, forbidden for others. |
| **RollingWindowDays**   | Number of days for the sliding window in `rolling` goals. Required for `rolling` type, forbidden for others.                                                                      |
| **ComputedSource**      | How progress was last updated: `'event_increment'` (real-time from metric event) or `'reconciliation'` (background job recomputation).                                            |

## Relationships

- Goal → Property (required `propertyId`).
- Goal → Portal (optional `portalId`, scopes goal to a specific portal).
- Goal → Team (optional `teamId`, scopes goal to a team).
- Goal → Staff (optional `staffId`, scopes goal to an individual staff member).
- Goal → Goal (optional `parentGoalId`, links recurring instances back to their template).
- GoalProgress → Goal (one-to-one, tracks current progress).
- Goal context **subscribes to** `metric.recorded`, `staff.unassigned`, `portal.deleted`, `team.deleted` events from other contexts.
- Goal context **depends on** `MetricPublicApi` from the metric context (for querying metric readings to reconcile progress).

## Invariants

- Goal names must be non-empty.
- `targetValue` must be > 0.
- `MetricKey` must be valid for the goal's `EntityScope`.
- `AggregationFunction` must be valid for the chosen `MetricKey`.
- Only `active` goals can be updated or cancelled.
- Goal type rules:
  - `open`: no period, no rolling window, no recurrence rule. Progress never expires.
  - `one_shot`: requires `periodStart` + `periodEnd`. No rolling window, no recurrence.
  - `rolling`: requires `rollingWindowDays > 0`. No period, no recurrence.
  - `recurring`: requires `recurrenceRule`. Templates have no period; instances have bounded periods from the scheduler.
- At most one of [`portalId`, `teamId`, `staffId`] determines scope. If all null, scope is `property`.
- Goals are cancelled (not deleted) when their target entity (portal, team, staff) is removed.

## Events produced

| Tag                     | Payload                                             | When                    |
| ----------------------- | --------------------------------------------------- | ----------------------- |
| `goal.completed`        | goalId, orgId, propertyId, scope IDs, target, value | Progress reaches target |
| `goal.progress_updated` | goalId, orgId, metricKey, previous/current value    | Progress recomputed     |

## Events consumed

| Tag                | Source context | Handler action                                  |
| ------------------ | -------------- | ----------------------------------------------- |
| `metric.recorded`  | metric         | Increment goal progress via event_increment     |
| `staff.unassigned` | staff          | Cancel goals scoped to the removed staff member |
| `portal.deleted`   | portal         | Cancel goals scoped to the deleted portal       |
| `team.deleted`     | team           | Cancel goals scoped to the deleted team         |

## Architecture layers

```
goal/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, progress-strategy.ts
  application/
    ports/             goal.repository.ts
    dto/               goal.dto.ts (Zod schemas)
    use-cases/         create-goal.ts, update-goal.ts, cancel-goal.ts, list-goals.ts, get-goal.ts
  infrastructure/
    repositories/      goal.repository.ts (Drizzle)
    mappers/           goal.mapper.ts
    event-handlers/    on-metric-recorded.ts, on-staff-unassigned.ts, on-portal-deleted.ts, on-team-deleted.ts
    jobs/              spawn-recurring-instances.job.ts, reconcile-goal-progress.job.ts
  server/              goals.ts, staff-goals.ts
  ui/                  helpers.ts (pure UI helper functions)
```

## Permissions

| Permission   | Roles                                | Use                                      |
| ------------ | ------------------------------------ | ---------------------------------------- |
| `goal.read`  | AccountAdmin, PropertyManager, Staff | List goals, get goal detail, staff goals |
| `goal.write` | AccountAdmin, PropertyManager        | Create, update, cancel goals             |

## Background jobs

- **spawn-recurring-instances** — creates child Goal instances from recurring templates at each period boundary.
- **reconcile-goal-progress** — recomputes progress from raw metric readings for all active goals (computedSource = `reconciliation`).

## Flagged ambiguities

- Staff goals endpoint (`listStaffGoals`) is stubbed — full wiring awaits staff assignment resolution in a future phase.
