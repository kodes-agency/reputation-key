# Goal Context

Property-scoped goals with progress tracking driven by metric events.

## Glossary

| Term                    | Definition                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------- |
| **Goal**                | A property-scoped target (e.g. "reach 4.5 average rating", "collect 50 reviews"). Belongs to an organization and is scoped to a property, portal, or portal group.           |
| **GoalType**            | `'open'`, `'one_shot'`, `'rolling'`, or `'recurring'`. Determines how time periods and progress are computed.                                                                |
| **GoalStatus**          | Lifecycle: `active` → `completed`, `expired`, or `cancelled`. Only `active` goals accept progress updates.                                                                   |
| **GoalProgress**        | Current numeric progress toward a goal's target. Tracks `currentValue`, `currentSum`, `currentCount`, and `computedSource`. One-to-one with a Goal.                          |
| **GoalInstance**        | A recurring goal's spawned child for a specific period. Has `parentGoalId` set to the template Goal. Shares the template's metric, aggregation, and target.                  |
| **AggregationFunction** | How progress is computed from raw metric readings: `sum`, `count`, `max`, `avg`. Must be valid for the chosen `MetricKey`.                                                   |
| **MetricKey**           | Which metric feeds this goal (e.g. `rating_average`, `review_count`). Valid keys depend on the goal's `EntityScope` (property, portal, portal_group).                        |
| **EntityScope**         | The level at which a goal operates: `property`, `portal`, or `portal_group`. Derived from which nullable FK is filled (`portalId`, `portalGroupId`). Falls back to property. |
| **RecurrenceRule**      | Configuration for recurring goals: `{ frequency: 'weekly'                                                                                                                    | 'monthly' | 'quarterly' }`. Required for `recurring` type, forbidden for others. |
| **RollingWindowDays**   | Number of days for the sliding window in `rolling` goals. Required for `rolling` type, forbidden for others.                                                                 |
| **ComputedSource**      | How progress was last updated: `'event_increment'` (real-time from metric event) or `'reconciliation'` (background job recomputation).                                       |

## Relationships

- Goal → Property (required `propertyId`).
- Goal → Portal (optional `portalId`, scopes goal to a specific portal).
- Goal → PortalGroup (optional `portalGroupId`, scopes goal to a portal group).
- Goal → Goal (optional `parentGoalId`, links recurring instances back to their template).
- GoalProgress → Goal (one-to-one, tracks current progress).
- Goal context **subscribes to** `metric.recorded`, `portal.deleted`, `portal_group.deleted` events from other contexts.
- Goal context **depends on** `MetricPublicApi` from the metric context (for querying metric readings to reconcile progress).
- Goal context **depends on** `PortalGroupPublicApi.findGroupForPortal` from the portal context (for resolving group membership on metric events).

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
- At most one of [`portalId`, `portalGroupId`] determines scope. If all null, scope is `property`.
- Goals are cancelled (not deleted) when their target entity (portal, portal group) is removed.

## Events produced

| Tag                     | Payload                                                                                                                                                    | When                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `goal.completed`        | goalId, organizationId, propertyId, scope IDs, goalType, metricKey, aggregationFunction, targetValue, completedValue, completedAt, parentGoalId, createdBy | Progress reaches target |
| `goal.progress_updated` | goalId, organizationId, metricKey, previousValue, currentValue, computedSource, occurredAt                                                                 | Progress recomputed     |

## Events consumed

| Tag                    | Source context | Handler action                                  |
| ---------------------- | -------------- | ----------------------------------------------- |
| `metric.recorded`      | metric         | Increment goal progress via event_increment     |
| `portal.deleted`       | portal         | Cancel goals scoped to the deleted portal       |
| `portal_group.deleted` | portal         | Cancel goals scoped to the deleted portal group |

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
    event-handlers/    on-metric-recorded.ts, on-portal-deleted.ts, on-portal-group-deleted.ts
    jobs/              spawn-recurring-instances.job.ts, reconcile-goal-progress.job.ts
  server/              goals.ts, staff-goals.ts, staff-goals.test.ts, goals.test.ts
  ui/                  helpers.ts (pure UI helper functions)
  build.ts             composition root
```

## Intentional deviations

- **`ui/helpers.ts`**: Contains pure data transformation functions shared between server responses and UI components. This is an intentional deviation from the strict four-layer architecture — these helpers translate domain/DTO shapes into UI-friendly formats without importing React or framework code. Keeping them in `ui/` colocates them with the components that consume them.

## Use cases

| Use case     | Input                                                                                                                                                                                                            | Output   | Permission    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------- |
| `createGoal` | organizationId, propertyId, portalId?, portalGroupId?, name, description?, goalType, aggregationFunction, metricKey, targetValue, periodStart?, periodEnd?, recurrenceRule?, rollingWindowDays?, createdBy, role | `Goal`   | `goal.create` |
| `updateGoal` | goalId, organizationId, targetValue?, recurrenceRule?, role                                                                                                                                                      | `Goal`   | `goal.update` |
| `cancelGoal` | goalId, organizationId, role                                                                                                                                                                                     | `Goal`   | `goal.cancel` |
| `listGoals`  | organizationId, propertyId, portalId?, portalGroupId?, status?, goalType?, role                                                                                                                                  | `Goal[]` | `goal.read`   |
| `getGoal`    | goalId, organizationId, role                                                                                                                                                                                     | `Goal`   | `goal.read`   |

## Public API

Exported from `application/public-api.ts`:

- Types: `CreateGoalInput`, `UpdateGoalInput`, `CancelGoalInput`, `ListGoalsInput`, `GetGoalInput`, `Goal`, `GoalProgress`, `GoalType`, `GoalStatus`, `StaffGoalEntry`, `GoalWithProgress`
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
| `goal.create` | ✓            | ✓               | —     |
| `goal.update` | ✓            | ✓               | —     |
| `goal.cancel` | ✓            | ✓               | —     |

## Background jobs

- **spawn-recurring-instances** — creates child Goal instances from recurring templates at each period boundary.
- **reconcile-goal-progress** — recomputes progress from raw metric readings for all active goals (computedSource = `reconciliation`).

## Flagged ambiguities

- Staff goals endpoint (`listStaffGoals`) is stubbed — full wiring awaits staff assignment resolution in a future phase.
