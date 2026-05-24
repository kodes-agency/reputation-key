# Review 16: Per-Context Deep Dive

**Reviewer:** Automated architecture review
**Date:** 2026-05-23
**Branch:** feat/phase-15c-goal-ui

Covers all 12 bounded contexts: goal, metric, review, guest, staff, identity, inbox, integration, portal, property, team, dashboard.

## Findings

### [MAJOR] Goal context: `build.ts` doesn't expose `publicApi` — other contexts can't consume Goal types through the standard pattern

File: src/contexts/goal/build.ts
Quote:

```
export type GoalContextApi = Readonly<{
  useCases: { ... }
  goalRepo: GoalRepository
  events: EventBus
}>
```

Rule: All contexts expose `publicApi` in their build output for cross-context consumption. The goal context's `build.ts` returns `useCases`, `goalRepo`, and `events` but no `publicApi` field. Other contexts currently don't consume goal's public API, but the composition root accesses goal internals directly (e.g., `goal.useCases.createGoal`).
Fix: Add `publicApi` to the build output, re-exporting types from `application/public-api.ts`. Follow the pattern used by other contexts (e.g., staff, property).

### [MAJOR] Dashboard context has no `publicApi` field in build output

File: src/contexts/dashboard/build.ts
Quote:

```
export type DashboardContextApi = Readonly<{
  getDashboardData: ReturnType<typeof getDashboardData>
}>
```

Rule: ADR-0007 requires dashboard to be a read-only aggregation context accessed through facade ports. The build output doesn't expose `publicApi`. No other context consumes dashboard data, so this is currently low-impact, but the pattern should be consistent.
Fix: Add `publicApi` field exporting types from `application/public-api.ts` for consistency.

### [MINOR] Team context has no `CONTEXT.md`

File: `src/contexts/team/` — no `CONTEXT.md` file exists
Rule: Other thick contexts (goal, guest, identity, inbox, integration, review, staff) have `CONTEXT.md` files documenting their glossary, invariants, events, and layers. Team is a thick context but lacks this documentation.
Fix: Add `src/contexts/team/CONTEXT.md` following the pattern from other contexts (glossary, relationships, events, layers, permissions).

### [MINOR] Portal context has no `CONTEXT.md`

File: `src/contexts/portal/` — no `CONTEXT.md` file exists
Rule: Portal is a thick context (second most use cases at 17) but lacks per-context documentation.
Fix: Add `src/contexts/portal/CONTEXT.md`.

### [MINOR] Property context has no `CONTEXT.md`

File: `src/contexts/property/` — no `CONTEXT.md` file exists
Rule: Property is a thick context with 5 use cases, domain rules, and cross-context dependencies.
Fix: Add `src/contexts/property/CONTEXT.md`.

### [MINOR] Metric context has no `CONTEXT.md`

File: `src/contexts/metric/` — no `CONTEXT.md` file exists
Rule: Metric context has no `server/` layer by design but has event handlers, jobs, and a use case.
Fix: Add `src/contexts/metric/CONTEXT.md` noting the intentional absence of `server/`.

### [MINOR] Dashboard context has no `CONTEXT.md`

File: `src/contexts/dashboard/` — no `CONTEXT.md` file exists
Rule: ADR-0007 documents dashboard's architecture decisions. A co-located `CONTEXT.md` would provide operational guidance.
Fix: Add `src/contexts/dashboard/CONTEXT.md`.

### [MINOR] Goal context `public-api.ts` doesn't export `GoalInstance` type

File: src/contexts/goal/application/public-api.ts
Quote:

```
export type {
  CreateGoalInput,
  UpdateGoalInput,
  CancelGoalInput,
  ListGoalsInput,
  GetGoalInput,
  Goal,
  GoalProgress,
  GoalType,
  GoalStatus,
} from './dto/goal.dto'
```

Rule: Goal's `CONTEXT.md` documents `GoalInstance` as a key type for recurring goals. The `public-api.ts` doesn't export it, which would prevent other contexts from consuming instance data if needed.
Fix: Add `GoalInstance` to the public-api re-exports.

### [NIT] All contexts have `domain/errors.ts` with `_tag`-tagged discriminated unions ✓

### [NIT] All contexts have `domain/events.ts` with past-tense `_tag`-tagged events ✓

### [NIT] All contexts have `build.ts` composition functions ✓

### [NIT] All contexts have `application/public-api.ts` barrels ✓

### [NIT] Cross-context imports all go through `public-api.ts` or event types ✓

### [NIT] No cross-context imports from `domain/`, `infrastructure/`, or `server/` layers ✓

### [NIT] Dashboard follows ADR-0007: no domain events, no writes, facade ports only ✓

### [NIT] Composition root (`composition.ts`) correctly wires all cross-context dependencies ✓

### [NIT] Domain layer has no `async` functions or `throw` statements ✓

## Context-by-Context Summary

| Context     | CONTEXT.md | public-api.ts  | build.ts         | Events          | Error Types | Issues  |
| ----------- | ---------- | -------------- | ---------------- | --------------- | ----------- | ------- |
| Goal        | ✓          | ✓ (incomplete) | ✓ (no publicApi) | ✓               | ✓           | 2 MINOR |
| Metric      | ✗          | ✓              | ✓                | ✓               | ✓           | 1 MINOR |
| Review      | ✓          | ✓              | ✓                | ✓               | ✓           | 0       |
| Guest       | ✓          | ✓              | ✓                | ✓               | ✓           | 0       |
| Staff       | ✓          | ✓              | ✓                | ✓               | ✓           | 0       |
| Identity    | ✓          | ✓              | ✓                | ✓               | ✓           | 0       |
| Inbox       | ✓          | ✓              | ✓                | ✓               | ✓           | 0       |
| Integration | ✓          | ✓              | ✓                | ✓               | ✓           | 0       |
| Portal      | ✗          | ✓              | ✓                | ✓               | ✓           | 1 MINOR |
| Property    | ✗          | ✓              | ✓                | ✓               | ✓           | 1 MINOR |
| Team        | ✗          | ✓              | ✓                | ✓               | ✓           | 1 MINOR |
| Dashboard   | ✗          | ✓              | ✓ (no publicApi) | N/A (no events) | ✓           | 2 MINOR |

## Summary

| Severity | Count       |
| -------- | ----------- |
| BLOCKER  | 0           |
| MAJOR    | 2           |
| MINOR    | 7           |
| NIT      | 9 (grouped) |

**Most important thing to fix first:** Add `publicApi` to Goal and Dashboard build outputs. The Goal context is actively being developed and will need cross-context consumption (e.g., dashboard aggregating goal data). The missing `CONTEXT.md` files for 5 contexts should also be prioritized as documentation debt.
