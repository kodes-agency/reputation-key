# Review 17: ADR & Documentation Compliance

**Reviewer:** Automated architecture review
**Date:** 2026-05-23
**Branch:** feat/phase-15c-goal-ui

## ADRs Reviewed

| ADR  | Title                                   | Status      | Implemented |
| ---- | --------------------------------------- | ----------- | ----------- |
| 0001 | Dynamic Access Control via Better-auth  | Implemented | ✓           |
| 0002 | Section-Based Navigation                | Implemented | ✓           |
| 0003 | Review as Separate Bounded Context      | Implemented | ✓           |
| 0004 | Inbox as Separate Bounded Context       | Implemented | ✓           |
| 0005 | GBP Review API Path and Error Model Fix | Accepted    | ✓           |
| 0006 | Staff as Separate Bounded Context       | Implemented | ✓           |
| 0007 | Dashboard as Read-Only Aggregation      | Implemented | ✓           |
| 0008 | Cross-Context Data Access Rules         | Accepted    | ✓           |

## Findings

### [MAJOR] ADR-0007 implementation gap: no `GoalStatsPort` facade for goal data on dashboard

File: `src/contexts/dashboard/application/ports/`
Rule: ADR-0007 states "Dashboard must show aggregated data from Property, Review, Staff, and Identity contexts." The current implementation only has `ReviewStatsPort` and `MetricStatsPort`. While Goal is a new context (Phase 15C), the dashboard should eventually expose goal KPIs. No port is defined yet.
Fix: When goal dashboard data is needed, add a `GoalStatsPort` following the existing facade pattern. This is a future concern, not a current violation — noting because ADR-0007 lists "account-level metrics" as a dashboard requirement and goals are metrics.

### [MINOR] ADR-0005: `integrationError` doesn't extend `Error` prototype

File: src/contexts/integration/domain/errors.ts:30-38
Quote:

```
export const integrationError = (
  code: IntegrationErrorCode,
  message: string,
  recoverable = false,
  context?: Readonly<Record<string, unknown>>,
): IntegrationError => ({
  _tag: 'IntegrationError',
  code,
  message,
  recoverable,
  ...(context ? { context } : {}),
})
```

Rule: ADR-0005 states "extend `integrationError` to inherit from `Error` with a `recoverable` flag." The current implementation uses a plain object without `Error` prototype inheritance. Stack traces are lost.
Fix: Either extend `Error` (which conflicts with the tagged-error pattern) or document why the plain-object approach was chosen instead. The `recoverable` field IS present, which partially satisfies the ADR.

### [MINOR] 5 contexts missing `CONTEXT.md` files (no per-context documentation)

Missing: `team`, `portal`, `property`, `metric`, `dashboard`
Rule: Root `CONTEXT.md` points to `src/contexts/CONTEXT.md` for layer guidance. Other contexts (goal, guest, identity, inbox, integration, review, staff) have their own `CONTEXT.md` with glossary, events, and architecture. These 5 contexts don't.
Fix: Add `CONTEXT.md` for each, following the pattern established by `src/contexts/goal/CONTEXT.md`.

### [MINOR] Root `CONTEXT.md` references "twelve bounded contexts" but lists 12 in the table

File: CONTEXT.md:5
Quote:

```
Layered hexagonal (clean architecture). Twelve bounded contexts in `src/contexts/`
```

Rule: The table lists exactly 12 contexts (Identity, Property, Portal, Guest, Team, Staff, Integration, Review, Inbox, Metric, Goal, Dashboard). This is correct but worth verifying.
Fix: No issue — count matches.

### [MINOR] `src/contexts/CONTEXT.md` dependency rules table doesn't mention `goal/ui/` layer

File: src/contexts/CONTEXT.md:26-40
Rule: The goal context has a `ui/` subdirectory (`goal/ui/helpers.ts`) which is not documented in the standard four-layer architecture. This is an extension unique to the goal context.
Fix: Either document the `ui/` layer as an allowed extension in `contexts/CONTEXT.md`, or move `helpers.ts` into the appropriate standard layer (likely `domain/` since it's pure functions).

### [MINOR] ADR-0008 compliance: `goal/ui/helpers.ts` imports from `application/dto/goal.dto` not `public-api.ts`

File: src/contexts/goal/ui/helpers.ts:6
Quote:

```
import type { Goal, GoalStatus } from '#/contexts/goal/application/dto/goal.dto'
```

Rule: ADR-0008 says "application/ layers must only import from other contexts' public-api.ts." This is same-context, so ADR-0008 doesn't strictly apply, but it violates the spirit of using public barrels.
Fix: Import from `#/contexts/goal/application/public-api` instead.

### [NIT] No stale references to deleted files found ✓

### [NIT] ADR-0001 (Dynamic Access Control) fully implemented: `can()`, `usePermissions()`, `hasRole()` all present ✓

### [NIT] ADR-0002 (Section-Based Navigation) implemented: role-distinct sidebar ✓

### [NIT] ADR-0003 (Review Bounded Context) implemented: separate review context with reply lifecycle ✓

### [NIT] ADR-0004 (Inbox Bounded Context) implemented: unified inbox with status workflow ✓

### [NIT] ADR-0006 (Staff Bounded Context) implemented: staff context separate from identity ✓

### [NIT] ADR-0007 (Dashboard facade) partially implemented: ReviewStatsPort + MetricStatsPort working ✓

### [NIT] ADR-0008 (Cross-Context Boundaries) enforced: all cross-context imports go through public-api.ts ✓

### [NIT] No architectural decisions found in code without corresponding ADRs ✓

## ADR-to-Code Traceability

| ADR  | Key Code Locations                                                                          | Verified    |
| ---- | ------------------------------------------------------------------------------------------- | ----------- |
| 0001 | `src/shared/auth/auth.ts`, `src/shared/domain/permissions.ts`, `src/shared/domain/roles.ts` | ✓           |
| 0002 | `src/components/layout/` (sidebar)                                                          | ✓           |
| 0003 | `src/contexts/review/`                                                                      | ✓           |
| 0004 | `src/contexts/inbox/`                                                                       | ✓           |
| 0005 | `src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts`             | ✓ (partial) |
| 0006 | `src/contexts/staff/`                                                                       | ✓           |
| 0007 | `src/contexts/dashboard/`                                                                   | ✓           |
| 0008 | `src/composition.ts`, cross-context imports                                                 | ✓           |

## Summary

| Severity | Count       |
| -------- | ----------- |
| BLOCKER  | 0           |
| MAJOR    | 1           |
| MINOR    | 5           |
| NIT      | 9 (grouped) |

**Most important thing to fix first:** ADR-0005's `integrationError` plain-object implementation. The ADR explicitly calls for `Error` prototype inheritance with `recoverable` flag. While the `recoverable` field exists, the missing `Error` inheritance means stack traces are lost when integration errors propagate through catch blocks. Either implement the ADR's decision or update the ADR to reflect the chosen alternative.
