# Goal Context

## Bounded context

Property-owned, subject-assigned monthly Goal Programs evaluated from governed,
version-pinned Metric reads.

## Canonical beta model (authority)

The beta runtime uses `goal_programs` → immutable `goal_program_versions` →
`goal_subject_assignments` → `goal_monthly_results` → append-only
`goal_result_revisions`. The older `goals`/`goal_progress` and
`goal_definitions`/`goal_periods` families are migration sources only. New beta
features must not write new business behavior against either older family.
`application/goal-authority-inventory.ts` is the executable cutover inventory:
it records every retained mutation, read, job, schedule, fixture writer, and UI
entry together with its fail-closed posture, plus every active GoalProgram
entry. Its repository guard proves GoalProgram is the sole beta-active family.
`application/legacy-goal-inventory.ts` is the separate, content-free data
contraction inventory for the retained `goals` and `goal_progress` tables. Its
read-only PostgreSQL repository records exact counts and reconstructable inbound
and outbound foreign-key metadata; it does not authorize contraction. The
evidence and deletion gate are documented in
`docs/operations/legacy-goal-contraction.md`.

- A Goal Program belongs to one Property and targets one governed metric version.
- A version may be assigned to any number of Property, Portal Group, or Portal
  subjects owned by that Property. Person and Team are not Goal subjects.
- Portal Groups are optional; standalone Portals remain first-class subjects.
- The only beta metrics are qualified scans, private rating count, and private
  rating average. They are analytics/management aids and are never eligible for
  employment decisions.
- The Qualified Scan source is active: only server-verified published QR/NFC
  Access Artifact observations count, once per signed response session and
  Portal in a rolling 24-hour window. Direct visits, prefetch, bots, and raw
  diagnostic loads never contribute. Portal Group scope uses membership captured
  at source-event time.
- Every result covers exactly one full Property-local calendar month. Changes
  start with the next complete month and never redefine a month in progress.
- Rating average requires at least 10 eligible ratings. Count metrics may close
  at a verified zero; missing or incomplete data is never coerced to zero.
- Result lifecycle is `open` → `reconciling` → `closed`, with a 24-hour
  late-arrival window and exact durable source completeness. Closed rows are
  immutable; later corrections append a direct, serialized result revision.
- Program lifecycle is `scheduled` → `active` ↔ `paused` → `ended`, with a
  direct `scheduled` → `ended` escape and no transition out of `ended`. An
  inactive metric source may be configured but cannot activate or create
  results until its producer becomes ready.

## Glossary

| Term | Definition |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------- |
| **Goal Program** | Canonical beta aggregate: a named, Property-owned, versioned monthly target for one governed metric, assignable to multiple Property, Portal Group, or Portal subjects. |
| **Goal Program Version** | Immutable target, governed metric-version pin, Property timezone snapshot, and effective window. A material target/metric/subject change creates a new version beginning next complete month. |
| **Goal Subject Assignment** | Half-open effective assignment of one Program version to one Property, Portal Group, or Portal. The database rejects overlap for the same subject and metric, even across Programs. |
| **Goal Monthly Result** | One Property-local calendar-month result with an ordered Open/Reconciliation/Closed lifecycle and exact source-completeness evidence. |
| **Goal Result Revision** | Append-only correction to a closed monthly result. Revisions form direct serialized lineage; the closed base result never changes. |
| **Goal (legacy)** | Pre-beta aggregate stored in `goals`/`goal_progress`. Retained only for migration/rollback evidence; its CRUD route surface and Staff Home read are not active beta consumers. |
| **GoalType** | `'open'`, `'one_shot'`, `'rolling'`, or `'recurring'`. Determines how time periods and progress are computed. |
| **GoalStatus** | Lifecycle: `active` → `completed`, `expired`, or `cancelled`. Only `active` goals accept progress updates. |
| **GoalProgress** | Current numeric progress toward a goal's target. Tracks `currentValue`, `currentSum`, `currentCount`, and `computedSource`. One-to-one with a Goal. |
| **GoalInstance** | A recurring goal's spawned child for a specific period. Has `parentGoalId` set to the template Goal. Shares the template's metric, aggregation, and target. |
| **AggregationFunction** | How progress is computed from raw metric readings: `sum`, `count`, `max`, `avg`. Must be valid for the chosen `MetricKey`. |
| **MetricKey** | Which metric feeds this goal (e.g. `rating_average`, `review_count`). Valid keys depend on the goal's `EntityScope` (property, portal, portal_group). |
| **EntityScope** | The level at which a goal operates: `property`, `portal`, or `portal_group`. Derived from which nullable FK is filled (`portalId`, `portalGroupId`). Falls back to property. |
| **RecurrenceRule** | Configuration for recurring goals: `{ frequency: 'weekly'                                                                                                                                                                                                                                                                                                                                                        | 'monthly' | 'quarterly' }`. Required for `recurring` type, forbidden for others. |
| **RollingWindowDays** | Number of days for the sliding window in `rolling` goals. Required for `rolling` type, forbidden for others. |
| **ComputedSource** | How progress was last updated: `'event_increment'` (real-time from metric event) or `'reconciliation'` (background job recomputation). |
| **Goal-eligible metric** | A MetricKey that measures a reputation or engagement _outcome_ an operator can target. Governed by the outcomes-not-levers rule: pure levers (review-link clicks) and internal process metrics (feedback volume) are excluded from goals even when they remain valid dashboard statistics. Scans are the one grandfathered lever, treated as a top-of-funnel engagement outcome. |
| **Progress goal** | A goal whose target is reached by _accumulating_ metric readings toward a value (e.g. 50 scans, 4.5 avg of new reviews this month). Progress is monotonic; computed by `computeProgressValue` over readings in the time window. All current goal types (open/one_shot/rolling/recurring) are progress goals. |
| **Level goal** | A goal whose target is a _snapshot threshold_ of a live aggregate state — e.g. "reach a 4.5★ overall Google rating." Progress is non-monotonic (it can go down); the current value is the authoritative external state, not a recomputed period aggregate. Not yet implemented — requires new semantics distinct from progress goals. |

## Relationships

- Goal → Property (required `propertyId`).
- Goal → Portal (optional `portalId`, scopes goal to a specific portal).
- Goal → PortalGroup (optional `portalGroupId`, scopes goal to a portal group).
- Goal → Goal (optional `parentGoalId`, links recurring instances back to their template).
- GoalProgress → Goal (one-to-one, tracks current progress).
- Canonical Goal Programs **depend on** `MetricPublicApi` for governed,
  version-pinned monthly reads; they do not increment progress from
  `metric.recorded`.
- Goal durably consumes `metric.corrected`. It asks Metric's public impact port
  for exact original/replacement facts, then Goal's repository locates only
  closed results with the same Organization, Property, immutable metric
  version, event-time subject, and half-open month. No Goal code queries Metric
  tables, and no Metric code queries Goal tables.
- Retained legacy event-handler implementations are historical/migration
  evidence only. Their index exports no registrar, and Portal or Portal Group
  deletion does not mutate retained legacy Goal rows in the beta runtime.
- Goal exposes exact delivery-time lookups for achieved close notices and for
  corrected result notices. Correction delivery supplies the full Program,
  Assignment, Result, and revision fence; a superseded revision resolves to
  null, while the current closed head can honestly resolve achieved=false or an
  unavailable state.

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

| Tag                                          | Payload                                                                                                                    | When                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `goal.monthly_result.reconciled`             | tenant/property + Program, version, assignment and monthly-result IDs; period; evaluation state; achieved; occurrence time | An open/reconciling canonical result is evaluated but not closed                                       |
| `goal.monthly_result.closed`                 | the same identifier-only/result facts, with `status=closed`                                                                | The result wins the `reconciling` → `closed` CAS; state and outbox row commit in one transaction       |
| `goal.monthly_result.revised`                | the same result identities plus direct revision lineage and outcome/availability-change flags                              | A governed late correction appends a new closed-result revision, audit row, and outbox fact atomically |
| `goal.completed` (legacy compatibility only) | legacy Goal/progress facts                                                                                                 | Retained schema/factory only; no active Metric subscription produces it                                |

## Events consumed

| Tag                | Source context | Handler action                                                                                                 |
| ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------- |
| `metric.corrected` | metric         | Reconcile and, when settled evidence changed, append a revision to each exact affected closed canonical result |

`metric.recorded` is not consumed by Goal in the beta runtime. A correction is
the deliberate exception: the durable `goal.metric-correction-reconciliation`
consumer invokes `reconcileMetricCorrection`, deduplicates affected closed
results, and retries while Metric completeness is `updating`. Replays converge
because unchanged heads are no-ops and revision appends are serialized by CAS.
The split
`upsertProgress` + `markGoalCompleted` port operations and handler remain
compatibility-only migration code and are executablely excluded from runtime
composition.

## Architecture layers

```
goal/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, progress-strategy.ts
  application/
    ports/             goal.repository.ts, goal-program.repository.ts, monthly-result-notification-facts.lookup.ts
    dto/               goal.dto.ts (Zod schemas)
    use-cases/         create-goal.ts, update-goal.ts, cancel-goal.ts, list-goals.ts,
                       get-goal.ts, reconcile-metric-correction.ts
    legacy-goal-inventory.ts  content-free GOA-01/CNV-01 contraction evidence
    public-api.ts      re-exports DTO types, port types, event types/constructors
  infrastructure/
    repositories/      goal.repository.ts, goal-program.repository.ts (Drizzle)
    adapters/           monthly-result-notification-facts.lookup.ts
    legacy-goal-inventory.repository.ts  read-only retained-table snapshot
    metric-correction-outbox-consumers.ts
    mappers/           goal.mapper.ts
    event-handlers/    on-metric-recorded.ts, on-portal-deleted.ts, on-portal-group-deleted.ts
    jobs/              goal-program-maintenance.job.ts plus legacy lifecycle jobs
  server/              goal-programs.ts plus temporary staff-goals.ts compatibility read
  build.ts             composition root
```

## Use cases

Canonical beta use cases are `createGoalProgramService().create`, `revise`,
`changeAssignments`, `changeStatus`, `get`, `list`, `reconcileResult`, and
`reconcileClosedResult`, `maintain`, and the durable
`reconcileMetricCorrection` command. Closed-result reconciliation preserves
the last safe result while Metric is updating, appends a revision only when the
settled evaluation/source-completeness head changes, and never rewrites the
closed base. All writes use
the canonical repository's atomic state + audit/outbox transactions. The table
below documents migration-era application code, not network-reachable CRUD.

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
- Program contracts: `GoalProgram`, `GoalProgramBundle`, `GoalProgramVersion`, `GoalProgramStatus`, `GoalProgramRequestApi`, `GoalProgramError`
- Governed definition vocabulary: `GovernedGoalDefinition`, `GovernedGoalVersion`, `GovernedGoalPeriod`, `GovernedGoalEvaluation`, `GoalExecutionPolicy`, `GoalMetric`, `GoalMetricEvaluation`
- Subject and assignment contracts: `GoalSubject`, `GoalSubjectAssignment`, `GoalActor`, `GoalAssignmentChangeResult`, `GoalAssignmentChangeOutcome`, `GoalAssignmentChangeOutcomeCode`
- Monthly result contracts: `GoalMonthlyResult`, `GoalMonthlyResultStatus`, `ClosedGoalResultHead`, `GoalResultRevision`, `AppendGoalResultRevisionResult`
- Results matrix read model: `GoalResultsMatrix`, `GoalResultsMatrixRow`, `GoalResultsMatrixEvidence`, `GoalResultsMatrixAvailability`, `buildGoalResultsMatrix`
- Functions: `deriveEntityScope`
- Port types: `GoalRepository`, `GoalListFilter`
- Event types: `GoalCompleted` (legacy), `GoalMonthlyResultClosed`,
  `GoalMonthlyResultReconciled`, `GoalMonthlyResultRevised`, `GoalEvent`
- Event constructors: `goalCompleted` (legacy), `goalMonthlyResultClosed`,
  `goalMonthlyResultReconciled`, `goalMonthlyResultRevised`
- Notification fact contracts: `MonthlyResultNotificationFactsLookup`,
  `MonthlyResultNotificationFacts`, `MonthlyResultRevisionNotificationFacts`,
  `FindMonthlyResultNotificationFactsInput`,
  `FindMonthlyResultRevisionNotificationFactsInput`
- Goal build public API: `findMonthlyResultNotificationFacts` (exact
  Organization/Property/Assignment/Result lookup; closed + achieved only) and
  `findMonthlyResultRevisionNotificationFacts` (exact current revision fence;
  includes non-achieved and unavailable outcomes without metric values)

## Server functions

| Function                                  | Method | Permission    | Purpose                                                            |
| ----------------------------------------- | ------ | ------------- | ------------------------------------------------------------------ |
| `createGoalProgram`                       | POST   | `goal.create` | Create a canonical monthly Program                                 |
| `reviseGoalProgram`                       | POST   | `goal.update` | Schedule its next-full-month version                               |
| `changeGoalProgramAssignments`            | POST   | `goal.update` | Bulk add/remove a request-time subject set                         |
| `changeGoalProgramStatus`                 | POST   | update/cancel | Pause, resume, or end a Program                                    |
| `listGoalPrograms`                        | GET    | `goal.read`   | Property-scoped canonical Program list                             |
| `getGoalProgram`                          | GET    | `goal.read`   | Canonical aggregate and monthly result detail                      |
| `listStaffGoals` (compatibility artifact) | GET    | `goal.read`   | Explicit HTTP 410 denial before container or historical-row access |

The original `goals.ts` and intermediate `governed-goals.ts` network surfaces
were deleted at cutover. Their application/storage models remain migration
sources, but no client can create new records through them.

## Permissions

## Canonical beta UI

- Manager list, create, detail, status, and revision flows use Goal Programs.
- One creation/revision picker supports Property, Portal Group, and standalone
  Portal subjects; the same subject-to-command mapping is shared by both flows.
- Bulk assignment changes are authorization-checked and version-fenced, report
  an outcome for every requested subject, and begin next full month. “Select all
  current portals” expands once on the server; it is never stored as future
  inheritance, is bounded in the Portal-owned query, and excludes archived
  Portals. Explicit archived Portals are rejected as non-current subjects. A
  Program with an already-pending future version rejects another revision so
  the pending version cannot be skipped or collapsed into a zero-length window.
- Portal Group names and membership metadata remain Portal-owned projections.
  Every confirmed Portal Group mutation refreshes both the Goal subject picker
  and Goal subject-name cache for that exact Property.
- The only choices are qualified scans, private rating count, and private
  rating average. Qualified Scans use the active Access Artifact-backed source;
  any other inactive future source is described as scheduled, not as an error
  or a fabricated zero.
- The manager Goal Results Matrix covers all three measures and all three scopes,
  including ungrouped Portals. It shows Ready/Updating/Insufficient/Unavailable,
  exact count or average/sample evidence, Data through, target provenance, and a
  met/not-met explanation. It contains no ordinal rank, composite score, or
  universal progress ring. Unassigned current Portals say “No Goal Programs
  assigned.”
- Canonical `get`/`list` reads overlay the latest direct append-only Result
  Revision on its immutable closed base row. The base result and every prior
  correction remain unchanged in storage while manager projections see the
  current verified evidence head. Staff Goal metrics remain intentionally
  unavailable until a dedicated Staff dashboard is separately approved.

## Legacy UI design archive (not beta authority)

### Glossary additions

| Term                 | Definition                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
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
- The retired legacy UI centralized pace tolerance and labels in one pure helper
  module; that module is not part of the beta presentation authority.
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

The active manager result presentation lives in the Goal Results Matrix. The
superseded ring, trajectory, legacy Staff goal list, summary, and progress bar
have been removed rather than retained as story-only production components.

| Permission    | AccountAdmin | PropertyManager | Staff |
| ------------- | ------------ | --------------- | ----- |
| `goal.read`   | ✓            | ✓               | —     |
| `goal.create` | ✓            | ✓               | —     |
| `goal.update` | ✓            | ✓               | —     |
| `goal.cancel` | ✓            | ✓               | —     |

`/progress` is a retained compatibility redirect, not a Staff Goal surface. It
returns Staff to `/home` and sends an already-authorized manager with a selected
Property to the canonical Property Goal Program page.

## Background jobs

- **goal-program.maintain** — canonical, hourly, `goal.use`-gated tenant-cross
  lifecycle sweep.
  It activates due Programs only after the configured metric source is ready,
  materializes each Property-local monthly result no earlier than its boundary,
  catches up missed boundaries without creating future result rows, and performs the
  two-pass governed reconciliation/close flow. The dispatch gate authorizes
  enumeration and the service freshly authorizes each discovered Property;
  repository constraints and compare-and-set writes make repeat/overlap safe.
- **spawn-recurring-instances** — creates child Goal instances from recurring templates at each period boundary.
- **reconcile-goal-progress** — recomputes progress from raw metric readings for all active goals (computedSource = `reconciliation`).

The last two jobs above are legacy-only. Canonical scheduling/reconciliation uses
the Goal Program service and the governed `MetricPublicApi.queryGoalMetric`
reader; they are neither registered nor scheduled by the beta runtime and must
not reconstruct results from raw readings or mutable metric keys. Property and
Fleet attention projections likewise use only active canonical monthly results;
retained `goals`/`goal_progress` and intermediate governed evaluations cannot
affect beta attention counts.

## Legacy Goal data contraction

The retained `goals` and `goal_progress` tables are inventoried together in one
repeatable-read, read-only database snapshot. The versioned report contains only
fixed data-fate classifications, exact table counts, reconstructable foreign-key
metadata, blockers, and a deterministic fingerprint; it never reads record
content. A mechanically clean report is evidence, not permission to delete.
Export/restore proof, non-FK dependency review, one verified release without a
legacy reader or writer, and a reversible reviewed migration remain mandatory.
See `docs/operations/legacy-goal-contraction.md`.
