# GIGA REVIEW — Master Report

**Branch:** `feat/phase-15c-goal-ui` (PR #62, #63, #65)
**Scope:** Goal Domain + Application + Infrastructure + Server + Frontend + Cross-cutting
**Reviewers:** 3 independent angry subagents (domain/infra/frontend)
**Files reviewed:** 104 total
**Date:** 2026-05-24

---

## Executive Summary

| Split                               | Verdict            | P0    | P1     | P2     | P3     |
| ----------------------------------- | ------------------ | ----- | ------ | ------ | ------ |
| 01 — Domain + Application           | PASS WITH WARNINGS | 0     | 7      | 7      | 10     |
| 02 — Infrastructure + Server + Jobs | **FAIL**           | 4     | 7      | 6      | 6      |
| 03 — Frontend + Cross-cutting       | **FAIL**           | 3     | 4      | 6      | 6      |
| **TOTAL**                           | **FAIL**           | **7** | **18** | **19** | **22** |

**Bottom line:** The domain model is architecturally sound with excellent purity and test coverage. Infrastructure has real data-integrity risks (non-transactional writes, non-idempotent handler). Frontend form completely ignores established form conventions. These must be fixed before merge.

---

## Critical Issues (P0) — MUST FIX

### DATA INTEGRITY

- **P0-1** `goal.repository.ts:190-201` — `createGoalAndProgress` does TWO independent INSERTs without a transaction. Partial failure = orphaned goal with no progress row. Every recurring instance spawn is one network hiccup away from corruption. **Wrap in `db.transaction()`.**

- **P0-2** `goal.repository.ts:285-317` — AVG `incrementProgress` does two non-transactional UPDATEs with a race condition. Concurrent calls compute wrong averages. **Merge into a single atomic SQL UPDATE.**

### EVENT HANDLER SAFETY

- **P0-3** `on-metric-recorded.ts:39-103` — Handler has NO try/catch and CAN throw (`incrementProgress` throws on missing progress row). Violates "handlers don't throw" convention. **Wrap in try/catch with shared logger.**

- **P0-4** `on-metric-recorded.ts` — NOT idempotent. Duplicate `metric.recorded` events double-increment progress. No dedup guard. **Add event ID tracking or conditional increment.**

### DOMAIN RULE LEAKS

- **P0-5** `on-metric-recorded.ts:25-34` — `shouldEmitCompleted()` is a business rule (should this goal type emit completion?) sitting in infrastructure. **Move to `domain/progress-strategy.ts`.**

### USE CASE SIGNATURE VIOLATION

- **P0-6** `all use cases` — Every goal use case jams `role: Role` into `input` instead of separate `ctx: AuthContext` parameter. Convention explicitly says `(deps) => async (input, ctx) => Promise<T>`. This blends auth with business data. **Refactor to `(input, ctx)` signature.**

- **P0-7** `list-goals.ts:43` — THROWS on forbidden while every other use case returns `Result`. Inconsistent and a runtime crash if caller doesn't catch. **Return `err()` like every other use case.**

### FRONTEND FORM VIOLATION

- **P0-8** `goal-create-form.tsx:51-126` — Uses plain `useState` + manual validation instead of TanStack Form + Zod v4. CONTEXT.md explicitly forbids this. **Rewrite with `useForm` + `createGoalSchema`.**

- **P0-9** `goal-create-form.tsx:87-95` — Duplicates validation logic that already exists in `createGoalSchema`. **Use the schema for validation.**

---

## Major Issues (P1) — SHOULD FIX

### Validation Gaps

- `update-goal.ts:63-64` — No validation on updated `targetValue`. Can set 0 or negative. Domain invariant "targetValue must be > 0" violated.
- `update-goal.ts:67-73` — No validation on updated `recurrenceRule` for recurring templates.
- `goal.schema.ts:31` — `staffId` has no FK constraint or cascade delete (unlike `portalId` and `teamId`).

### Server Function Convention Violations

- `goals.ts`, `staff-goals.ts` — ALL 6 server functions missing `clearTenantCache()`.
- `goals.ts`, `staff-goals.ts` — ALL 6 server functions missing `catchUntagged`. Raw try/catch loses error context.

### Non-atomicity

- `create-goal.ts:125-150` — Recurring goal creation: template inserted, then instance built, then instance inserted. If instance build fails, orphaned template. No transaction wrapping.

### Type Safety

- `create-goal.ts:94` — Unsafe `as GoalId` cast instead of using branded `goalId()` constructor.
- `update-goal.ts:59` — Mutable `Record<string, unknown>` for updates — completely untyped.
- `goal.repository.ts` — `insert()` takes `Omit<Goal, 'id'>` but use case passes Goal WITH id. Repo silently discards it.

### Infrastructure

- `index.ts:26-33` — Duplicate `events` + `eventBus` props (same object, two names) in handler registration deps.

### Missing Tests

- `goal.repository.ts` — ZERO tests. Convention requires tenant isolation tests for every repo.
- `goal.mapper.test.ts` — No round-trip test (domain → row → domain).

### Frontend

- `goal-create-form.tsx` — 151 lines, exceeds 150-line limit.
- 3 files define identical `GoalWithProgress` type instead of sharing.
- All 3 goal routes missing `beforeLoad` authorization guards.
- ALL 9 components missing `Readonly<>` on Props types. Convention explicitly requires it.

---

## Minor Issues (P2) — NICE TO FIX

- `domain/types.ts:20` — Comment says "Enums" but convention says NO enum. Misleading.
- `domain/types.ts:69-83` — `deriveEntityScope` has runtime logic in `types.ts`.
- `goal.mapper.ts:36-42` — Hardcoded `VALID_METRIC_KEYS` duplicates `shared/domain/metric-keys.ts`.
- `helpers.ts:128-129` — `daysRemaining` uses `new Date()` instead of injected clock.
- `helpers.ts:150` — `formatDatePart` uses local timezone instead of UTC.
- `helpers.ts:207-220` — `goalTypeLabel` takes `string` instead of `GoalType`.
- `goal.schema.ts:54` — `goals_staff_idx` missing `organizationId` in composite index.
- `goals.ts:125` — Inconsistent return shapes (some bare, some `{ goal: ... }`).
- `domain/constructors.ts:26-40` — Internal errors use `tag` not `_tag`.
- `dto/goal.dto.ts:106-107` — Re-exports from domain in DTO file (already in public-api).
- `list-goals.ts:48` — Mutable array pattern instead of `map`.
- `get-goal.ts:63` — Mutable array pattern instead of `map`.
- `goal-create-extra-fields.tsx:14` — Props uses `interface` not `type`.
- `goal-create-fields.tsx:16` — Props aliased as single-letter `F`.
- `goal-create-metric-fields.tsx:14` — Props named `MetricFieldsProps` not `Props`.
- Various hardcoded values in components (scope lists, goal type lists, frequency options).
- `goals-list-page.tsx:35-40` — `STATUS_ORDER` duplicated from `ui/helpers.ts`.

---

## Nits (P3) — COSMETIC

- `vi.fn()` used without explicit import (fragile if globals disabled)
- `makeGoal` helper copy-pasted across 7+ test files (extract to shared factory)
- `goal.schema.ts:42` — `recurrenceRule` typed as `{ frequency: string }` not narrowed
- `reconcile-goal-progress.job.test.ts:137` — Fake typed as `MetricRepository` not `MetricPublicApi`
- `spawn-recurring-instances.job.ts:36-39` — Filters in JS instead of using targeted DB query
- `new.tsx:18-23` — Double navigation logic (route `onSuccess` + form `navigate`)
- `goal-create-form.tsx:120` — Unsafe `(result as { goal?: ... })` type assertion
- Various `// fallow-ignore` comments that need documentation or removal
- `domain/events.ts:15-16` — Repetitive `fallow-ignore-next-line` comments

---

## Positive Findings (grudging respect)

- **Domain purity is textbook.** Pure functions, `Result<T,E>`, no async, no I/O, no mutation. Exactly right.
- **Constructor validation is thorough.** Every CONTEXT.md invariant checked. Goal type rules complete.
- **Test coverage is comprehensive.** 4×4 matrix on progress strategy, happy+error on every use case, proper sorting tests.
- **Permission checks are first and consistent.** Every use case checks `can(role, 'goal.xxx')` as step 1.
- **Event types match CONTEXT.md exactly.** Past-tense naming, proper payload, `Readonly<>`.
- **No cross-context boundary violations in any component.** All imports through public-api or dto.
- **All 16 CONTEXT.md files are accurate.** Glossary, relationships, invariants, events — all match code.
- **All 12 public-api.ts files re-export correctly.** No stale exports.
- **Tenant isolation on CRUD queries is solid.** Every user-facing query filters by `organizationId`.
- **Entity removal handlers** (portal, team, staff) are properly idempotent with error handling.
- **Bootstrap registration** correctly handles BullMQ contravariance.
- **Auth hardening is correct.** Permission definitions match CONTEXT.md, role assignments consistent.

---

## Recommended Fix Order

1. **P0-1, P0-2** — Transaction wrapping (data integrity)
2. **P0-3, P0-4** — Handler safety + idempotency
3. **P0-5** — Move `shouldEmitCompleted` to domain
4. **P0-8, P0-9** — Rewrite form with TanStack Form + Zod
5. **P0-6, P0-7** — Use case signature refactor
6. **P1** — Missing clearTenantCache/catchUntagged, validation gaps, missing tests, Readonly<>, route guards
7. **P2** — Type safety improvements, deduplication, timezone consistency

---

## Detailed Reports

- [01 — Goal Domain + Application](./01-goal-domain-application.md)
- [02 — Goal Infrastructure + Server + Jobs](./02-goal-infra-server-jobs.md)
- [03 — Goal Frontend + Cross-cutting](./03-frontend-crosscutting.md)
