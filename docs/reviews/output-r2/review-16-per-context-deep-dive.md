# Review 16: Per-Context Deep Dive (Re-audit R2)

**Date:** 2026-05-23
**Reviewer:** Hermes Agent
**Branch:** feat/phase-15c-goal-ui
**Scope:** All 12 bounded contexts: Identity, Property, Portal, Guest, Team, Staff, Integration, Review, Inbox, Metric, Goal, Dashboard. Focus on Goal, Staff, Integration (recent PRs).

## Summary

All 12 contexts follow the hexagonal 4-layer architecture. Domain entities are owned with invariant enforcement via smart constructors. Use cases follow the authorize→load→check→build→persist→emit→return pattern. Cross-context interactions use `public-api.ts` facades. One BLOCKER-level cross-context violation found (Guest→Staff direct port import). Goal context is the newest and has the most thorough documentation but lacks a `public-api.ts` facade. Staff context is well-structured since extraction from Identity (ADR 0006).

---

## Context-by-Context Health Check

### Goal (Focus Context — Recent PR)

**Domain entities owned + invariants enforced:** ✅

- `Goal`, `GoalProgress`, `GoalInstance` in `domain/types.ts`
- `buildGoal()` smart constructor in `domain/constructors.ts` — enforces all invariants (name non-empty, targetValue > 0, metric×scope validation, goalType-specific rules)
- `buildProgressQuery()` / `computeProgressValue()` in `domain/progress-strategy.ts` — pure functions returning `Result`
- 17 test files covering domain, use cases, event handlers, jobs, mappers, server functions, UI helpers

**Use cases + ports + tests:** ✅

- 5 use cases: create, update, cancel, list, get — all tested
- `GoalRepository` port in `application/ports/`
- `MetricPublicApi` consumed from metric context via public-api

**Server functions 7-step compliance:** ✅

- All 5 CRUD functions in `goals.ts` follow: `tracedHandler` → `resolveTenantContext` → `can()` → use case → error mapping
- `staff-goals.ts` is stubbed (returns empty array) — documented as flagged ambiguity in Goal CONTEXT.md

**Cross-context interactions:** ✅ (with caveat)

- Imports `MetricPublicApi` from metric's public-api
- Subscribes to events from staff, portal, team via their public-api
- **Missing `public-api.ts`** — Goal has no public-api facade. No other context consumes Goal APIs yet, so this is low-risk but inconsistent with the pattern used by all other contexts.

**BLOCKER-level gaps:** None.

### Staff (Focus Context — Recent PR)

**Domain entities owned + invariants enforced:** ✅

- `StaffAssignment` in `domain/types.ts`
- `buildStaffAssignment()` constructor in `domain/constructors.ts`
- `generateReferralCode()` in `domain/referral-code.ts` — pure function
- `StaffAssignmentRepository` port
- 13 test files

**Use cases + ports + tests:** ✅

- 4 use cases: create, list, remove, resolve-referral-code — all tested
- `StaffPublicApi` in `application/public-api.ts` — exposes `getAccessiblePropertyIds()` + event re-exports

**Server functions 7-step compliance:** ✅

- `staff-assignments.ts` follows the pattern

**Cross-context interactions:** ✅ for outgoing, ❌ for incoming

- **BLOCKER**: `src/contexts/guest/build.ts` imports `StaffAssignmentRepository` directly from `#/contexts/staff/application/ports/staff-assignment.repository` instead of using `StaffPublicApi`. This violates the dependency rule: "Cross-context: import from `application/public-api.ts` only."

**BLOCKER-level gaps:** 1 — Guest→Staff cross-context violation (see F-16-01).

### Integration (Focus Context — Recent PR)

**Domain entities owned + invariants enforced:** ✅

- `GoogleConnection`, `GbpLocation`, `GbpCache`, `GbpImportJob` in `domain/types.ts`
- `buildGoogleConnection()` constructor
- `integrationError()` with `recoverable` flag (ADR 0005)
- 24 test files — most thoroughly tested context

**Use cases + ports + tests:** ✅

- 10 use cases — all tested (connect, disconnect, refresh, list connections, list locations, import, handle notification, get import status, update visibility, start property import)

**Server functions 7-step compliance:** ✅

- `google-connections.ts`, `gbp-import.ts`, `shared.ts` follow the pattern
- `integrationErrorStatus()` exhaustive error mapping

**Cross-context interactions:** ✅

- Imports `ReviewQueuePort` from review's public-api
- Imports `propertyCreated` from property's public-api
- All via public-api facades

**BLOCKER-level gaps:** None.

### Identity

**Domain:** Thin — wraps better-auth. `domain/rules.ts` (slug validation), `domain/errors.ts`, `domain/events.ts`. No entities in the traditional sense. ✅
**Use cases:** 12 use cases, 8 tested. **4 upload use cases untested** (request/finalize avatar/logo upload). ⚠️
**Server functions:** `organizations.ts`, `auth-settings.ts` — follow pattern. ✅
**Cross-context:** Consumes `StoragePort` from portal's public-api. ✅

### Property

**Domain:** `Property` entity with `buildProperty()` constructor. `domain/rules.ts`, `domain/errors.ts`. ✅
**Use cases:** 5 use cases, all tested. ✅
**Server functions:** `properties.ts` — follows pattern. ✅
**Cross-context:** Consumes `StaffPublicApi` from staff's public-api. ✅
**Repository:** Tenant isolation tested with `ORG_A`/`ORG_B`. ✅

### Portal

**Domain:** `Portal`, `PortalLink`, `PortalLinkCategory` entities with constructors. `domain/rules.ts`, `domain/errors.ts`. ✅
**Use cases:** 17 use cases, all tested (25 test files total). ✅
**Server functions:** `portals.ts`, `portal-links.ts` — follow pattern. ✅
**Cross-context:** Consumes `PropertyPublicApi`. ✅
**Repository:** Tenant isolation tested. ✅

### Guest

**Domain:** `ScanEvent`, `Rating`, `Feedback` entities. `domain/rules.ts`, `domain/errors.ts`, `domain/constructors.ts`. ✅
**Use cases:** 9 use cases, 7 tested. **3 untested** (get-public-portal, resolve-link-and-track, resolve-portal-context). ⚠️
**Server functions:** `public.ts` — public (no auth), follows pattern. ✅
**Cross-context:** **VIOLATION** — `build.ts` imports `StaffAssignmentRepository` from staff's `application/ports/` instead of `public-api.ts`. Also imports `LinkResolverPort` from portal's public-api (correct). ❌

### Inbox

**Domain:** `InboxItem`, `InboxNote` entities. `domain/rules.ts`, `domain/constructors.ts`. ✅
**Use cases:** 9 use cases, all tested (17 test files). ✅
**Server functions:** `inbox.ts` — follows pattern. ✅
**Cross-context:** Consumes `StaffPublicApi` from staff's public-api. Event handlers import event types from review/guest public-api. ✅
**Use case tests:** Second-org fixtures present. ✅

### Review

**Domain:** `Review`, `Reply` entities. `domain/rules.ts`, `domain/constructors.ts`. ✅
**Use cases:** 2 aggregate use cases (sync-reviews, reply-operations), both tested. ✅
**Server functions:** `reply.ts` — follows pattern. ✅
**Cross-context:** Event handler imports `PropertyCreated` from property's public-api. ✅

### Team

**Domain:** `Team` entity. `domain/rules.ts`, `domain/constructors.ts`. ✅
**Use cases:** 5 use cases, all tested. ✅
**Server functions:** `teams.ts` — follows pattern. ✅
**Cross-context:** Consumes `PropertyPublicApi` and `StaffPublicApi` via public-api. ✅

### Metric

**Domain:** `MetricReading` entity. `domain/constructors.ts`, `domain/events.ts`. No `domain/rules.ts` (no business rules — just recording). ✅
**Use cases:** 1 use case (record-metric), tested. ✅
**No server functions** — by design (records via event handlers and jobs). ✅
**Cross-context:** Event handlers import event types from guest/review public-api. ✅

### Dashboard

**Domain:** No entities — thin read-only context. `domain/types.ts` (read model shapes), `domain/errors.ts`. ✅
**Use cases:** 1 use case (get-dashboard-data), tested. ✅
**Server functions:** `dashboard.ts` — follows pattern. ✅
**Cross-context:** `DashboardPublicApi` in public-api. Owns no tables. ✅

---

## Findings

### [BLOCKER] F-16-01: Guest→Staff cross-context violation — direct port import

**File:** `src/contexts/guest/build.ts:4`
**Quote:** `import type { StaffAssignmentRepository } from '#/contexts/staff/application/ports/staff-assignment.repository'`
**Rule:** `src/contexts/CONTEXT.md` — "Cross-context: import from `application/public-api.ts` only. Never from `domain/`, `infrastructure/`, `server/`, or non-public-api `application/`."
**Fix:** Add a `getStaffByReferralCode` method to `StaffPublicApi` (or expose a `StaffAssignmentQueryPort` through it), then update `guest/build.ts` and `record-scan-with-ref` use case to depend on the public-api interface instead of the raw repository.

### [MAJOR] F-16-02: Goal context missing `public-api.ts`

**File:** `src/contexts/goal/` — no `application/public-api.ts`
**Quote:** All 11 other contexts with public-api: dashboard, guest, identity, inbox, integration, metric, portal, property, review, staff, team.
**Rule:** `src/contexts/CONTEXT.md` — "Cross-context: import from `application/public-api.ts` only." While Goal has no consumers yet, consistency and future-proofing demand it.
**Fix:** Create `src/contexts/goal/application/public-api.ts` with event re-exports (`goal.completed`, `goal.progress_updated`) and any query methods that may be needed by dashboard. Export `GoalPublicApi` type.

### [MAJOR] F-16-03: Goal `listStaffGoals` server function is stubbed

**File:** `src/contexts/goal/server/staff-goals.ts`
**Quote:** "Stub: resolve user's staff assignments, then query goals for each. For Phase 15C, return empty — will be wired when data flow is ready."
**Rule:** Stub code in production server functions creates dead code paths and untested behavior.
**Fix:** Either wire the stub (use `StaffPublicApi` to resolve assignments, then query goals) or remove the server function until the data flow is ready. At minimum, add a `TODO` issue tracker reference.

### [MINOR] F-16-04: Goal domain has no `rules.ts`

**File:** `src/contexts/goal/domain/` — files are `types.ts`, `constructors.ts`, `errors.ts`, `events.ts`, `progress-strategy.ts`
**Quote:** Other "Thick" contexts (portal, property, team, inbox, review, integration, staff, guest) all have `domain/rules.ts`.
**Rule:** `src/contexts/CONTEXT.md` — domain layer contains "types.ts, rules.ts, constructors.ts, events.ts, errors.ts". Goal invariants live in `constructors.ts` instead.
**Fix:** Extract validation rules from `buildGoal()` into `domain/rules.ts` (e.g., `validateMetricScope()`, `validateAggregationForMetric()`). Keep constructors for assembly. This is a structural consistency issue, not a functional gap.

### [MINOR] F-16-05: Goal server function imports domain type `MetricKey`

**File:** `src/contexts/goal/server/goals.ts:29`
**Quote:** `import type { MetricKey, AggregationFunction } from '#/shared/domain/mmetric-keys'`
**Rule:** `src/contexts/CONTEXT.md` — "server/ imports from application/ (use cases, DTOs), shared/". `MetricKey` is from `shared/domain/` which is technically shared, so this is borderline compliant.
**Fix:** No action needed — `shared/domain/` is a permitted import for server functions.

### [NIT] F-16-06: Staff `public-api.ts` doesn't expose referral code lookup

**File:** `src/contexts/staff/application/public-api.ts`
**Quote:** Only exposes `getAccessiblePropertyIds()`. The referral code lookup used by guest context bypasses this via direct port import.
**Rule:** Public API should encapsulate all cross-context surface area.
**Fix:** Add `getStaffByReferralCode` to `StaffPublicApi` to resolve the F-16-01 violation.

## Counts

| Severity  | Count |
| --------- | ----- |
| BLOCKER   | 1     |
| MAJOR     | 2     |
| MINOR     | 2     |
| NIT       | 1     |
| **Total** | **6** |
