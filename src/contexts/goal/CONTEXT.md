# Goal Context

## Bounded context

TODO: One sentence describing what this context does.

Property-scoped goals with progress tracking driven by metric events.

## Glossary

| Term                    | Definition                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Goal**                | A property-scoped target (e.g. "reach 4.5 average rating", "collect 50 reviews"). Belongs to an organization and is scoped to a property, portal group, or portal. |
| **GoalType**            | `'open'`, `'one_shot'`, `'rolling'`, or `'recurring'`. Determines how time periods and progress are computed.                                                      |
| **GoalStatus**          | Lifecycle: `active` → `completed`, `expired`, or `cancelled`. Only `active` goals accept progress updates.                                                         |
| **GoalProgress**        | Current numeric progress toward a goal's target. Tracks `currentValue`, `currentSum`, `currentCount`, and `computedSource`. One-to-one with a Goal.                |
| **GoalInstance**        | A recurring goal's spawned child for a specific period. Has `parentGoalId` set to the template Goal. Shares the template's metric, aggregation, and target.        |
| **AggregationFunction** | How progress is computed from raw metric readings: `sum`, `count`, `max`, `avg`. Must be valid for the chosen `MetricKey`.                                         |
| **MetricKey**           | Which metric feeds this goal (e.g. `rating_average`, `review_count`). Valid keys depend on the goal's `EntityScope` (property, portal_group, portal).              |
|                         | **EntityScope**                                                                                                                                                    | The level at which a goal operates: `property`, `portal_group`, or `portal`. Derived from which nullable FK is filled (`groupId`, `portalId`). Falls back to property. |
| **RecurrenceRule**      | Configuration for recurring goals: `{ frequency: 'weekly'                                                                                                          | 'monthly'                                                                                                                                                              | 'quarterly' }`. Required for `recurring` type, forbidden for others. |
| **RollingWindowDays**   | Number of days for the sliding window in `rolling` goals. Required for `rolling` type, forbidden for others.                                                       |
| **ComputedSource**      | How progress was last updated: `'event_increment'` (real-time from metric event) or `'reconciliation'` (background job recomputation).                             |

## Relationships

- Goal → Property (required `propertyId`).
- Goal → Portal (optional `portalId`, scopes goal to a specific portal).
- Goal → PortalGroup (optional `groupId`, scopes goal to a department).
- Goal → Goal (optional `parentGoalId`, links recurring instances back to their template).
- GoalProgress → Goal (one-to-one, tracks current progress).
- Goal context **subscribes to** `metric.recorded`, `portal.deleted`, `portal_group.deleted` events from other contexts.
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
- At most one of [`portalId`, `groupId`] determines scope. If both null, scope is `property`.
- Goals are cancelled (not deleted) when their target entity (portal, team, staff) is removed.

## Events produced

| Tag                     | Payload                                                                                                                                           | When                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `goal.completed`        | goalId, orgId, propertyId, scope IDs, goalType, metricKey, aggregationFunction, targetValue, completedValue, completedAt, parentGoalId, createdBy | Progress reaches target |
| `goal.progress_updated` | goalId, orgId, metricKey, previousValue, currentValue, computedSource, occurredAt                                                                 | Progress recomputed     |

## Events consumed

| Tag                    | Source context | Handler action                                  |
| ---------------------- | -------------- | ----------------------------------------------- |
| `metric.recorded`      | metric         | Increment goal progress via event_increment     |
| `portal.deleted`       | portal         | Cancel goals scoped to the deleted portal       |
| `portal_group.deleted` | portal group   | Cancel goals scoped to the deleted portal group |

## Architecture layers

```
goal/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, progress-strategy.ts
  application/
    ports/             goal.repository.ts
    dto/               goal.dto.ts (Zod schemas)
    use-cases/         create-goal.ts, update-goal.ts, cancel-goal.ts, list-goals.ts, get-goal.ts
    public-api.ts      re-exports DTO types, port types, event types/constructors
  infrastructure/
    repositories/      goal.repository.ts (Drizzle)
    mappers/           goal.mapper.ts
    event-handlers/    on-metric-recorded.ts, on-portal-deleted.ts, on-group-deleted.ts
    jobs/              spawn-recurring-instances.job.ts, reconcile-goal-progress.job.ts
  server/              goals.ts, staff-goals.ts
  ui/                  helpers.ts (pure UI helper functions)
  build.ts             composition root
```

> **DEPRECATED per docs/standards.md §4.3**

## Intentional deviations

- **`ui/helpers.ts`**: Contains pure data transformation functions shared between server responses and UI components. This is an intentional deviation from the strict four-layer architecture — these helpers translate domain/DTO shapes into UI-friendly formats without importing React or framework code. Keeping them in `ui/` colocates them with the components that consume them.

## Use cases

| Use case     | Input                                                                                                                                                                                             | Output   | Permission    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------- |
| `createGoal` | orgId, propertyId, portalId?, groupId?, name, description?, goalType, aggregationFunction, metricKey, targetValue, periodStart?, periodEnd?, recurrenceRule?, rollingWindowDays?, createdBy, role | `Goal`   | `goal.create` |
| `updateGoal` | goalId, orgId, targetValue?, recurrenceRule?, role                                                                                                                                                | `Goal`   | `goal.update` |
| `cancelGoal` | goalId, orgId, role                                                                                                                                                                               | `Goal`   | `goal.cancel` |
| `listGoals`  | orgId, propertyId, portalId?, groupId?, status?, goalType?, role                                                                                                                                  | `Goal[]` | `goal.read`   |
| `getGoal`    | goalId, orgId, role                                                                                                                                                                               | `Goal`   | `goal.read`   |

## Public API

Exported from `application/public-api.ts`:

- Types: `CreateGoalInput`, `UpdateGoalInput`, `CancelGoalInput`, `ListGoalsInput`, `GetGoalInput`, `Goal`, `GoalProgress`, `GoalType`, `GoalStatus`
- Functions: `deriveEntityScope`
- Port types: `GoalRepository`, `GoalListFilter`
- Event types: `GoalCompleted`, `GoalProgressUpdated`, `GoalEvent`
- Event constructors: `goalCompleted`, `goalProgressUpdated`

## Server functions

| Function         | Method | Permission    | Route                                     |
| ---------------- | ------ | ------------- | ----------------------------------------- |
| `createGoal`     | POST   | `goal.create` | Create a new goal                         |
| `updateGoal`     | POST   | `goal.update` | Update an active goal                     |
| `cancelGoal`     | POST   | `goal.cancel` | Cancel an active goal                     |
| `listGoals`      | GET    | `goal.read`   | List goals with filters                   |
| `getGoal`        | GET    | `goal.read`   | Get single goal detail                    |
| `listStaffGoals` | GET    | `goal.read`   | List goals for authenticated staff (stub) |

## Permissions

| Permission    | AccountAdmin | PropertyManager | Staff |
| ------------- | ------------ | --------------- | ----- |
| `goal.read`   | ✓            | ✓               | ✓     |
| `goal.create` | ✓            | ✓               | ✓     |
| `goal.update` | ✓            | ✓               | —     |
| `goal.cancel` | ✓            | ✓               | —     |

## Background jobs

- **spawn-recurring-instances** — creates child Goal instances from recurring templates at each period boundary.
- **reconcile-goal-progress** — recomputes progress from raw metric readings for all active goals (computedSource = `reconciliation`).

> **DEPRECATED per docs/standards.md §4.3**

## Flagged ambiguities

- Staff goals endpoint (`listStaffGoals`) is stubbed — full wiring awaits staff assignment resolution in a future phase.
