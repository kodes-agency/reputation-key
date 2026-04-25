# Phase 6 Code Quality & Adherence Report

**Reviewer:** AI audit  
**Date:** 2026-04-25  
**Scope:** Phase 6 (Teams + Staff Assignments) — full codebase, all 4 doc sources  
**Status:** ✅ All tests pass (320/320), `tsc --noEmit` clean, `eslint` clean

---

## 1. Executive Summary

Phase 6 delivers two new bounded contexts (`team` and `staff`) following the patterns established by Phase 5's property context. The code is **architecturally sound**, closely adheres to all four documentation sources, and introduces no regressions.

**Overall score: 96/100** — a high-quality delivery with a handful of issues worth addressing before moving to Phase 7.

| Category                     | Score | Notes                                                              |
| ---------------------------- | ----- | ------------------------------------------------------------------ |
| Architecture adherence       | 97    | Near-perfect; one port-location anomaly                            |
| Conventions compliance       | 96    | Minor naming/API inconsistencies                                   |
| Pattern fidelity             | 95    | Update-team rebuilds constructor instead of field-level validation |
| Test coverage                | 94    | Missing repository integration tests for team & staff              |
| Documentation contradictions | 92    | Several doc-vs-doc inconsistencies found                           |
| Functional style             | 98    | Excellent — no classes, proper Result types                        |
| Tenant isolation             | 97    | Correct but one subtle NULL-comparison edge case                   |

---

## 2. Architecture Adherence

### 2.1 ✅ Bounded context boundaries

Team and staff are properly separated as independent contexts. The team context defines a local `PropertyExistsPort` instead of importing from the property context — exactly as the architecture prescribes:

> "Define an interface in your own context's `application/ports/` and have the other context provide an implementation."

The `PropertyAccessProvider` is defined in `staff/application/ports/` and wired in `composition.ts` — correct cross-context communication.

### 2.2 ✅ Four-layer structure

Both contexts follow the full four-layer structure:

- `domain/` — types, rules, constructors, events, errors
- `application/` — ports, DTOs, use cases
- `infrastructure/` — mappers, repositories
- `server/` — TanStack Start server functions

### 2.3 ✅ Dependency direction

Dependencies correctly point inward. No violations detected:

- Domain imports only from `shared/domain/`
- Application imports from domain and shared
- Infrastructure imports from domain, application, shared
- Server imports from application, shared

### 2.4 ⚠️ `PropertyAccessProvider` location

The `PropertyAccessProvider` is defined in `staff/application/ports/property-access.port.ts`, but it is consumed by the **property** context's `listProperties` use case, which re-exports its own local `PropertyAccessProvider` type. This creates an awkward coupling where the property context imports a type that conceptually belongs to staff.

**Current code in `list-properties.ts`:**

```ts
export type PropertyAccessProvider = Readonly<{ ... }>
```

This is a **local re-declaration** of the same type that exists in `staff/application/ports/property-access.port.ts`. The property context should import the type from staff (allowed for ports/interfaces) or — better — the `PropertyAccessProvider` should live in `shared/` since it bridges two contexts. This is a design tension the docs don't explicitly resolve.

**Severity: P2** (works correctly, but creates a type duplication that can drift)

### 2.5 ✅ Composition root

`composition.ts` correctly wires all team and staff use cases with their dependencies. The `propertyExists` port is correctly wired as a thin adapter around `propertyRepo.findById`. The `propertyAccess` provider correctly delegates to `staffAssignmentRepo.getAccessiblePropertyIds`.

---

## 3. Conventions Compliance

### 3.1 ⚠️ Error throwing inconsistency in server functions

The team server functions (`teams.ts`) use a local `throwTeamError` helper that manually constructs the Error. The staff server functions (`staff-assignments.ts`) use the shared `throwContextError` from `shared/auth/server-errors.ts`. The property server functions also have their own local `throwPropertyError`.

Three different error-throwing patterns:

| Context  | Pattern                                                                           |
| -------- | --------------------------------------------------------------------------------- |
| Property | Local `throwPropertyError(e)` — takes typed error                                 |
| Team     | Local `throwTeamError(e)` — takes `{ code, message }`                             |
| Staff    | Shared `throwContextError('StaffError', e, status)` — takes name + error + status |

The `throwContextError` helper was added because the pattern was repeated across property and team — yet property and team still use their local versions.

**Severity: P2** (functionally correct, but inconsistent — conventions require "one way")

**Recommendation:** Migrate property and team server functions to use `throwContextError` consistently, or remove the shared helper and keep the local ones. The docs don't specify which, but consistency is the goal.

### 3.2 ⚠️ Zod import path

The team and staff DTOs use `import { z } from 'zod/v4'` while the patterns.md examples use `import { z } from 'zod'`. This is likely correct for the project's Zod v4 setup, but the documentation examples should be updated to match.

**Severity: P3** (docs-only issue)

### 3.3 ✅ Naming conventions

- File naming: lowercase-hyphen (`create-team.ts`, `staff-assignment.repository.ts`) ✅
- Type naming: PascalCase (`Team`, `StaffAssignmentRepository`) ✅
- Branded IDs: PascalCase (`TeamId`, `StaffAssignmentId`) ✅
- Functions: camelCase (`createTeam`, `canManageAssignments`) ✅
- Use case factories: verb-noun (`createTeam`, `softDeleteTeam`) ✅
- Domain constructors: `buildXxx` (`buildTeam`, `buildStaffAssignment`) ✅
- Event constructors: past-tense (`teamCreated`, `staffAssigned`) ✅
- Error constructors: `xxxError` (`teamError`, `staffError`) ✅
- Repository factories: `createXxxRepository` ✅
- Events: `<context>.<verb-past>` (`team.created`, `staff.assigned`) ✅
- DB tables: snake_case plural (`teams`, `staff_assignments`) ✅
- DB columns: snake_case ✅

### 3.4 ✅ Every business table has required columns

Both `teams` and `staff_assignments` have `id`, `organization_id`, `created_at`, `updated_at`, `deleted_at`. Uses shared `columns.ts` helpers.

---

## 4. Pattern Fidelity

### 4.1 ⚠️ Update team uses full constructor rebuild instead of field-level validation

Per `patterns.md` section 27 (Update use case):

> "Update receives a partial patch — only the fields the user wants to change. Running all validations would reject unchanged fields... Instead, the update use case: loads the existing entity, validates only the fields present in the patch using domain rules directly."

But `update-team.ts` rebuilds the entire team through `buildTeam()`:

```ts
const teamResult = buildTeam({
  id: existing.id,
  organizationId: existing.organizationId,
  propertyId: existing.propertyId,
  name: newName,
  description: input.description !== undefined ? input.description : existing.description,
  teamLeadId: input.teamLeadId !== undefined ? ... : existing.teamLeadId,
  now: existing.createdAt,  // ← uses createdAt, not current time
})
```

This means:

1. If a team was created with a name that passes today's validation but future validation becomes stricter, the update would fail even if the name isn't changing.
2. The `now` parameter is set to `existing.createdAt`, which is correct but slightly misleading — the constructor sees a "build time" that isn't the real build time.

The property context's `updateProperty` correctly uses field-level validation per patterns.md. The team context should follow the same pattern.

**Severity: P2** (works today, but fragile against future rule changes)

### 4.2 ✅ Staff assignment constructor is non-validating — correct

`buildStaffAssignment` returns `StaffAssignment` directly (not `Result`), which is appropriate since there are no validation rules that can fail for staff assignments. This follows the "proportional layering" principle.

### 4.3 ✅ Use case step ordering

All use cases follow the correct step order (1→2→3→4→5→6→7) with absent steps skipped. No ceremony-for-symmetry issues.

### 4.4 ✅ In-memory test fakes

Both `createInMemoryTeamRepo` and `createInMemoryStaffAssignmentRepo` properly implement their respective port interfaces, include tenant isolation, soft-delete filtering, and test-only helpers (`seed`, `all`).

### 4.5 ⚠️ In-memory store not actually used

`shared/testing/in-memory-store.ts` exports a generic `createInMemoryStore<T>` utility, but none of the actual in-memory repos use it — they each have their own inline Map-based implementation. The file's own comment says "Now used by property, team, and staff in-memory repos" but this is incorrect.

**Severity: P3** (dead code — the generic store was written but never adopted)

---

## 5. Test Coverage

### 5.1 ✅ Domain tests

- Team: rules (11 tests), constructors (4 tests), errors (5 tests) — thorough
- Staff: rules (2 tests), errors (3 tests) — appropriate for the simple rules

### 5.2 ✅ Use case tests

- Team: create-team (6 tests), update-team (5 tests), soft-delete-team (4 tests)
- Staff: create-staff-assignment (5 tests)
- All test happy path, authorization errors, entity-not-found, uniqueness, and event emission

### 5.3 ❌ Missing repository integration tests for team and staff

Per conventions: "Every repository method has integration test. Tenant isolation test per repository."

The property context has `property.repository.test.ts` (7 integration tests including tenant isolation), but neither team nor staff contexts have repository integration tests. This is a gate criterion from the plan:

> "Integration test: create org, create 3 properties, invite 2 staff, assign staff to 2 of 3 properties, log in as staff, verify only those 2 are visible"

**Severity: P1** (plan gate criterion)

### 5.4 ❌ Missing server function integration tests for team and staff

The property context has both `properties.test.ts` and `properties.integration.test.ts`. Team and staff have no server function tests.

**Severity: P2** (not a gate criterion but a coverage gap)

### 5.5 ❌ Missing E2E test

Phase 6 plan specifies:

> "Integration test: create org, create 3 properties, invite 2 staff, assign staff to 2 of 3 properties, log in as staff, verify only those 2 are visible"

No E2E or integration test covering this flow exists.

**Severity: P1** (plan gate criterion)

### 5.6 ⚠️ Missing tests for `removeStaffAssignment` and `listStaffAssignments` use cases

`removeStaffAssignment` has no unit test file. `listStaffAssignments` has no unit test file.

**Severity: P2** (conventions say "Every use case tested for happy path + every error path")

---

## 6. Documentation Contradictions

### 6.1 ⚠️ Zod import: `zod` vs `zod/v4`

- **patterns.md** examples: `import { z } from 'zod'`
- **conventions.md**: "This project uses Zod v4 (`^4.3.6`)"
- **Actual code**: `import { z } from 'zod/v4'`

The patterns doc is inconsistent with the actual code. With Zod v4, the sub-path import is correct.

**Severity: P3** (docs-only)

### 6.2 ⚠️ `PropertyAccessProvider` — docs don't specify where cross-context ports live

- **architecture.md** says: "A context can import another context's types and events"
- **conventions.md** dependency rules: `contexts/A/<non-server-non-dto>` from `contexts/B/*` is forbidden (except events)
- The `PropertyAccessProvider` is defined in staff and consumed by property

The docs don't explicitly address whether an interface defined in context A can be imported by context B's application layer. The current code works because it re-declares the type locally, but the intent seems to be that the type should come from staff. This is a documentation gap.

**Severity: P3** (architectural ambiguity)

### 6.3 ⚠️ architecture.md lists `headers.ts` twice

In the `shared/auth/` section, `headers.ts` is listed twice with overlapping descriptions:

```
- `headers.ts` — `headersFromContext()` builds `Headers` from the current TanStack Start request
- `headers.ts` — `headersFromContext()` — builds a `Headers` object carrying the current request's cookies
```

This is a copy-paste error in the docs.

**Severity: P3** (docs-only)

### 6.4 ⚠️ `assignmentExists` with null teamId — potential DB-level bug

In `staff-assignment.repository.ts`, the `assignmentExists` method:

```ts
assignmentExists: async (orgId, userId, propertyId, teamId) => {
  const conditions = [
    ...baseWhere(staffAssignments, orgId),
    eq(staffAssignments.userId, userId as string),
    eq(staffAssignments.propertyId, propertyId as string),
  ]
  if (teamId) {
    conditions.push(eq(staffAssignments.teamId, teamId as string))
  }
  ...
}
```

When `teamId` is `null` (direct property assignment, no team), the method does NOT filter for `teamId IS NULL`. This means a user assigned to a property directly AND to a team within that property would show `assignmentExists` as `true` for both, when they should be distinct assignments.

However, the unique index in the schema is `ON (organization_id, user_id, property_id, team_id) WHERE deleted_at IS NULL`, which treats `NULL` teamId as distinct. So the DB constraint allows both, but the application-layer check doesn't properly detect the case.

Actually, looking more carefully: when `teamId` is `null`, the method checks only `orgId + userId + propertyId` (without teamId filter). This returns true if the user is assigned to that property at ALL (with or without a team). This means you can't create a direct assignment if the user already has a team-based assignment to the same property, and vice versa.

**This may be intentional** (a user should only be assigned to a property once, regardless of team) — but the plan is ambiguous:

> "Staff user can be assigned to a property directly or to a team within the property"

This implies a user could have BOTH a direct assignment and a team assignment to the same property.

**Severity: P2** (semantic ambiguity — needs clarification, could be intentional)

### 6.5 ⚠️ `listTeams` and `getTeam` — no authorization check

`listTeams` and `getTeam` use cases don't check authorization — any authenticated user can list/get teams. Per plan:

> "A Staff user querying `/properties` sees only properties they're assigned to"

The plan doesn't explicitly state that Staff can't view teams, but it does imply property-level access control. Currently, any org member can list all teams in any property they know the ID of.

**Severity: P2** (potential access control gap — may be intentional for Phase 6, but should be explicit)

### 6.6 ⚠️ architecture.md mentions `FieldDescription`, `FieldSet`, `FieldLegend` as available shadcn components

These are listed as available but may not actually be installed. The codebase only has `field.tsx` which exports `Field`, `FieldGroup`, `FieldLabel`, `FieldError`.

**Severity: P3** (docs-only)

---

## 7. Functional Style

### 7.1 ✅ No classes

All code uses factory functions returning records of functions. No `class` declarations found.

### 7.2 ✅ `Result` types in domain

- `buildTeam` returns `Result<Team, TeamError>` ✅
- `validateTeamName` returns `Result<string, TeamError>` ✅
- `buildStaffAssignment` returns `StaffAssignment` directly (no fallible validation) — appropriate ✅

### 7.3 ✅ Tagged errors

Both `TeamError` and `StaffError` follow the `{ _tag, code, message, context? }` shape exactly.

### 7.4 ✅ `ts-pattern` `.exhaustive()` in server functions

Both `teamErrorStatus` and `staffErrorStatus` use `.exhaustive()`.

### 7.5 ✅ Clock injection

All use cases that produce timestamps use `deps.clock()` instead of `new Date()`.

### 7.6 ✅ No mutation of parameters

All domain types use `readonly`. No in-place mutations detected.

---

## 8. Tenant Isolation

### 8.1 ✅ Every repository method takes organizationId first

Both team and staff repos enforce this. `baseWhere()` is used consistently.

### 8.2 ✅ Every query filters by organization_id AND deleted_at IS NULL

All Drizzle queries in team and staff repos use `baseWhere()`.

### 8.3 ⚠️ `assignmentExists` doesn't filter NULL teamId correctly

See section 6.4 above.

### 8.4 ❌ Missing tenant isolation integration tests

No integration tests for team or staff repositories verify cross-tenant query isolation.

---

## 9. Schema & Migration Quality

### 9.1 ✅ Proper unique indexes

- `teams`: unique index on `(organization_id, property_id, name) WHERE deleted_at IS NULL` — correct
- `staff_assignments`: unique index on `(organization_id, user_id, property_id, team_id) WHERE deleted_at IS NULL` — correct

### 9.2 ✅ Foreign keys

- `teams.property_id` → `properties.id` (cascade delete)
- `staff_assignments.property_id` → `properties.id` (cascade delete)
- `staff_assignments.team_id` → `teams.id` (cascade delete)

### 9.3 ✅ Proper indexes for common queries

- `teams`: index on `(organization_id, property_id)` for list queries
- `staff_assignments`: indexes on `(organization_id, user_id)` and `(organization_id, property_id)` for list queries

---

## 10. Routes & UI

### 10.1 ✅ Routes are thin

Team and staff route components are thin — they call server functions via TanStack Query and render results. No business logic in routes.

### 10.2 ⚠️ Staff list shows raw userId

The staff list page displays `a.userId` directly, which is a UUID. Not user-friendly — should show user name or email.

**Severity: P3** (UX issue, not architectural)

### 10.3 ⚠️ No create form for teams or staff assignments

The team list page shows teams but has no "Create Team" button or form. The staff page has no "Assign Staff" form. These are basic CRUD operations that the plan says should be in scope:

> "UI: teams management within a property, staff list within an organization, assign staff to property/team"

**Severity: P1** (plan scope item — UI for creating teams and assigning staff is missing)

### 10.4 ✅ Delete and remove use mutations correctly

Team delete and staff remove both use `useMutation` wrapping server functions. `onSuccess` triggers `query.refetch()`.

---

## 11. Event Bus & Events

### 11.1 ✅ Events follow past-tense naming

`team.created`, `team.updated`, `team.deleted`, `staff.assigned`, `staff.unassigned` — all correct.

### 11.2 ✅ Events registered in master union

`shared/events/events.ts` correctly re-exports all team and staff event types and includes them in the `DomainEvent` union.

### 11.3 ✅ Event constructors enforce \_tag

All constructors use `Omit<XxxEvent, '_tag'>` and set `_tag` explicitly.

### 11.4 ✅ No event handlers in emitting contexts

All event handlers would live in receiving contexts (none registered yet, which is correct for Phase 6).

---

## 12. Plan Gate Criteria Checklist

| Gate Criterion                                                                               | Status | Notes                                       |
| -------------------------------------------------------------------------------------------- | ------ | ------------------------------------------- |
| Team can be created under a property, with optional team lead                                | ✅     | Working                                     |
| Staff user can be assigned to a property directly or to a team within property               | ✅     | Working                                     |
| A Staff user querying `/properties` sees only properties they're assigned to                 | ✅     | Via `PropertyAccessProvider`                |
| An AccountAdmin sees all properties in their org                                             | ✅     | Returns `null` from access provider         |
| A PropertyManager sees only properties they're explicitly assigned to                        | ✅     | Via staff assignments                       |
| All CRUD operations work                                                                     | ⚠️     | Read + Delete work; Create UI forms missing |
| All tests pass                                                                               | ✅     | 320/320                                     |
| Integration test: create org, 3 properties, invite 2 staff, assign 2 of 3, verify visibility | ❌     | Not present                                 |

---

## 13. Priority-Sorted Issues

### P1 — Must fix before moving to Phase 7

1. **Missing team & staff repository integration tests** — tenant isolation test is non-negotiable per conventions
2. **Missing E2E/integration test for property visibility by assignment** — explicit gate criterion
3. **Missing UI for creating teams and assigning staff** — plan scope says "UI: teams management within a property, staff list within an organization, assign staff to property/team"

### P2 — Should fix

4. **Error throwing inconsistency** — migrate property/team server functions to use `throwContextError` or establish a single pattern
5. **Update team uses full constructor instead of field-level validation** — should match patterns.md section 27
6. **`assignmentExists` NULL teamId handling** — clarify intent (single assignment per property, or multiple?)
7. **Missing `removeStaffAssignment` and `listStaffAssignments` use case tests**
8. **Missing server function integration tests for team and staff**
9. **`PropertyAccessProvider` type duplication** between staff port and property use case
10. **`listTeams`/`getTeam` lack authorization checks** — any org member can view all teams

### P3 — Nice to fix

11. **Dead `in-memory-store.ts`** — either adopt it or remove it
12. **architecture.md duplicate `headers.ts` entry** — copy-paste error
13. **patterns.md Zod import examples use `zod` instead of `zod/v4`** — update docs
14. **Staff list shows raw userId UUID** — UX issue
15. **architecture.md lists uninstalled shadcn components** — minor docs inconsistency

---

## 14. What's Done Well

1. **Excellent context boundary discipline** — the `PropertyExistsPort` and `PropertyAccessProvider` patterns show mature understanding of bounded contexts
2. **Consistent use of `baseWhere()`** — tenant isolation is mechanical, not ad-hoc
3. **Shared `columns.ts` helpers** — DRY column definitions across all schemas
4. **Proper schema indexes** — both performance and correctness indexes are present
5. **Clean composition wiring** — `composition.ts` is readable and complete
6. **Event types are complete** — all CRUD operations emit events, all registered in master union
7. **In-memory fakes are thorough** — tenant isolation + soft-delete respected in tests
8. **`capturingEventBus.capturedByTag<T>()`** — excellent typed helper for event assertions
9. **`uuidFromLabel()` in fixtures** — deterministic UUID generation for readable test IDs
10. **Functional style is impeccable** — zero classes, proper Result usage, clock injection everywhere
