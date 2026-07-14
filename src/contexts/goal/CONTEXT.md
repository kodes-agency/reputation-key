# Goal Context

## Bounded context

Property-scoped goals with progress tracking driven by metric events.

## Glossary

| Term                     | Definition                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------- |
| **Goal**                 | A property-scoped target (e.g. "reach 4.5 average Google rating", "collect 50 reviews"). Belongs to an organization and is scoped to a property, portal, or portal group. Property scope only supports `property.review`. Portal-level metrics (scans, private ratings) are only available for portal and portal_group scopes.                                                                                   |
| **GoalType**             | `'open'`, `'one_shot'`, `'rolling'`, or `'recurring'`. Determines how time periods and progress are computed.                                                                                                                                                                                                                                                                                                    |
| **GoalStatus**           | Lifecycle: `active` → `completed`, `expired`, or `cancelled`. Only `active` goals accept progress updates.                                                                                                                                                                                                                                                                                                       |
| **GoalProgress**         | Current numeric progress toward a goal's target. Tracks `currentValue`, `currentSum`, `currentCount`, and `computedSource`. One-to-one with a Goal.                                                                                                                                                                                                                                                              |
| **GoalInstance**         | A recurring goal's spawned child for a specific period. Has `parentGoalId` set to the template Goal. Shares the template's metric, aggregation, and target.                                                                                                                                                                                                                                                      |
| **AggregationFunction**  | How progress is computed from raw metric readings: `sum`, `count`, `max`, `avg`. Must be valid for the chosen `MetricKey`.                                                                                                                                                                                                                                                                                       |
| **MetricKey**            | Which metric feeds this goal (e.g. `rating_average`, `review_count`). Valid keys depend on the goal's `EntityScope` (property, portal, portal_group).                                                                                                                                                                                                                                                            |
| **EntityScope**          | The level at which a goal operates: `property`, `portal`, or `portal_group`. Derived from which nullable FK is filled (`portalId`, `portalGroupId`). Falls back to property.                                                                                                                                                                                                                                     |
| **RecurrenceRule**       | Configuration for recurring goals: `{ frequency: 'weekly'                                                                                                                                                                                                                                                                                                                                                        | 'monthly' | 'quarterly' }`. Required for `recurring` type, forbidden for others. |
| **RollingWindowDays**    | Number of days for the sliding window in `rolling` goals. Required for `rolling` type, forbidden for others.                                                                                                                                                                                                                                                                                                     |
| **ComputedSource**       | How progress was last updated: `'event_increment'` (real-time from metric event) or `'reconciliation'` (background job recomputation).                                                                                                                                                                                                                                                                           |
| **Goal-eligible metric** | A MetricKey that measures a reputation or engagement _outcome_ an operator can target. Governed by the outcomes-not-levers rule: pure levers (review-link clicks) and internal process metrics (feedback volume) are excluded from goals even though they remain valid statistics in badges, leaderboards, and dashboards. Scans are the one grandfathered lever, treated as a top-of-funnel engagement outcome. |
| **Progress goal**        | A goal whose target is reached by _accumulating_ metric readings toward a value (e.g. 50 scans, 4.5 avg of new reviews this month). Progress is monotonic; computed by `computeProgressValue` over readings in the time window. All current goal types (open/one_shot/rolling/recurring) are progress goals.                                                                                                     |
| **Level goal**           | A goal whose target is a _snapshot threshold_ of a live aggregate state — e.g. "reach a 4.5★ overall Google rating." Progress is non-monotonic (it can go down); the current value is the authoritative external state, not a recomputed period aggregate. Not yet implemented — requires new semantics distinct from progress goals.                                                                            |

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

| Tag              | Payload                                                                                                                                                    | When                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `goal.completed` | goalId, organizationId, propertyId, scope IDs, goalType, metricKey, aggregationFunction, targetValue, completedValue, completedAt, parentGoalId, createdBy | Progress reaches target |

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

## Use cases

| Use case           | Input                                                                                                                                                                                                            | Output             | Permission    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------- |
| `createGoal`       | organizationId, propertyId, portalId?, portalGroupId?, name, description?, goalType, aggregationFunction, metricKey, targetValue, periodStart?, periodEnd?, recurrenceRule?, rollingWindowDays?, createdBy, role | `Goal`             | `goal.create` |
| `updateGoal`       | goalId, organizationId, targetValue?, recurrenceRule?, role                                                                                                                                                      | `Goal`             | `goal.update` |
| `cancelGoal`       | goalId, organizationId, role                                                                                                                                                                                     | `Goal`             | `goal.cancel` |
| `listGoals`        | organizationId, propertyId, portalId?, portalGroupId?, status?, goalType?, role                                                                                                                                  | `Goal[]`           | `goal.read`   |
| `getGoal`          | goalId, organizationId, role                                                                                                                                                                                     | `Goal`             | `goal.read`   |
| `listStaffGoals`   | organizationId, userId, role                                                                                                                                                                                     | `StaffGoalEntry[]` | `goal.read`   |
| `systemCancelGoal` | goalId, organizationId                                                                                                                                                                                           | `Goal`             | (system)      |

## Public API

Exported from `application/public-api.ts`:

- Types: `CreateGoalInput`, `UpdateGoalInput`, `CancelGoalInput`, `ListGoalsInput`, `GetGoalInput`, `Goal`, `GoalProgress`, `GoalType`, `GoalStatus`, `StaffGoalEntry`, `GoalWithProgress`
- Functions: `deriveEntityScope`
- Port types: `GoalRepository`, `GoalListFilter`
- Event types: `GoalCompleted`, `GoalEvent`
- Event constructors: `goalCompleted`

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

## UI Layer (redesign 2026)

### Glossary additions

| Term                 | Definition                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **GoalProgressRing** | Reusable circular progress with time-proportional "expected" notch marker. Primary at-a-glance pace visualization.     |
| **Health Donut**     | Pie chart (via ChartContainer + Recharts Pie) showing distribution of active goals by pace (ahead / on-pace / behind). |
| **Trajectory Graph** | Time series (Area/Line) of actual vs expected progress.                                                                |
| **Pace / On Pace**   | Comparison of current value to time-proportional expected (elapsed / total period \* target). Tolerance ~2%.           |
| **Command Center**   | List header summary + health donut + pace-colored rings for instant visibility.                                        |

### Resolved decisions

- Use time-proportional expected model (not velocity) for notch + trajectory (ADR 0020 foundation).
- Ring + notch is canonical for individual goal progress (lightweight SVG); complex viz use Recharts via existing ChartContainer.
- Reuse shadcn (Card, Badge, etc.) + ui/chart primitives heavily; no custom from-scratch charts.
- No search / multi-select on list (fixed status sort).
- Visual live ring in create preview (current=0 + notch).
- Pace tolerance and labels centralized in ui/helpers (pure).
- High-quality: a11y roles, stories for all new components, lint + type clean, small supporting files.
- Data: UI uses existing Goal + GoalProgress + period dates; full event history for rich trajectories deferred.
- **Density pass (2026-07):** list + detail pages were too sparse (card stack,
  per-item `p-6` padding, `gap-6` between cards, a summary donut box, a redundant
  `describeGoal` banner). Resolved into six decisions, all grounded in DESIGN.md §6
  ("card grids earn their place when the content varies; otherwise a list or table is
  the right affordance") and the "no hero-metric cards" rule:
  1. **List affordance → compact row list.** One border-separated row per goal, no
     per-item Card chrome. Replaces the identical-card grid DESIGN.md §6 proscribes.
  2. **Summary → inline text line, no box/donut.** Pace distribution renders as one
     muted line ("N active · a ahead · b on pace · c behind"); the `GoalsListSummary`
     bordered box and `GoalHealthDonut` are dropped from the list (the donut
     duplicated pace the per-row rings already encode — a hero-metric pattern).
  3. **Row indicator → ring at `sm`.** Smaller footprint (~40%), but keeps all three
     signals (fill + time-notch + pace color). A bar was rejected: it loses the notch
     and forces re-adding "expected" as a text column (net more weight).
  4. **Row metadata → lean.** Target absorbs the metric unit ("50 reviews", no metric
     chip); scope badge shows _only when non-property_; period dates deferred to
     detail. Pace text label retained (ring color alone is weak for scanning / a11y).
  5. **Detail page → progress-hero.** Drop the redundant `describeGoal` banner. One
     progress surface at top (lg ring + current/expected/pace + trajectory graph);
     config grid demoted to a compact key-value strip beneath. Fixes hierarchy:
     progress (the reason the page is opened) gets top billing over reference config.
  6. **Section rhythm → `space-y-4 md:space-y-6`** (16/24px) via `PageShell`
     `className` override on these pages only. One step down the DESIGN.md scale
     (xl→lg desktop); not below `lg`, to stay minimal-not-cramped.
  7. **Create flow → same rhythm.** Extended the 16px step to the create form:
     `SectionCard` went from `Card gap-6 py-6` + `CardContent space-y-6` to
     `gap-4 py-4` + `space-y-4` (per-section vertical density, ×4 sections); the
     `GoalCreateFields` section stack `space-y-6` → `space-y-4`; the live preview's
     `Card` gained `py-4` to keep its top flush with the tightened sections. The
     form↔preview grid gutter stays `gap-6` (horizontal breathing, not whitespace).

New reusable components live under `src/components/goals/` (GoalProgressRing, GoalTrajectoryGraph) for cross-use (list/detail/form + future). (GoalHealthDonut was removed in the 2026-07 density pass — see resolved decisions above.)

| Permission    | AccountAdmin | PropertyManager | Staff |
| ------------- | ------------ | --------------- | ----- |
| `goal.read`   | ✓            | ✓               | ✓     |
| `goal.create` | ✓            | ✓               | ✓     |
| `goal.update` | ✓            | ✓               | —     |
| `goal.cancel` | ✓            | ✓               | —     |

## Background jobs

- **spawn-recurring-instances** — creates child Goal instances from recurring templates at each period boundary.
- **reconcile-goal-progress** — recomputes progress from raw metric readings for all active goals (computedSource = `reconciliation`).
