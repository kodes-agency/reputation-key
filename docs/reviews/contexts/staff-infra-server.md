# Staff Context — Infrastructure & Server Review

**Scope:** `src/contexts/staff/infrastructure/` and `src/contexts/staff/server/`
**Dimensions:** D1, D5, D7, D8, D12, D15
**Date:** 2026-06-10

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 5     |
| MINOR    | 3     |
| NIT      | 1     |

**Overall:** Multi-tenancy (D7) is solid — every repository query routes through `baseWhere(table, orgId)` which enforces `organization_id` + `deleted_at IS NULL`. The repository adapter matches its port contract correctly (D5). Main concerns are: missing `can()` permission checks in 4 of 5 server functions (D8), cross-context `portalRepo` access bypassing the portal context's application layer (D1), and CONTEXT.md inaccuracies around server file structure and input documentation (D12).

---

## Findings

### [D8] [MAJOR] 4 of 5 server functions lack explicit `can()` permission check

File: src/contexts/staff/server/staff-assignments.ts:44-57,69-85,97-118
File: src/contexts/staff/server/staff-portals-update.ts:28-65
Quote:

```
// createStaffAssignment — no can() check
const assignment = await useCases.createStaffAssignment(data, ctx)

// removeStaffAssignment — no can() check
await useCases.removeStaffAssignment({ assignmentId: ... }, ctx)

// listStaffAssignments — no can() check
const assignments = await useCases.listStaffAssignments({ ... }, ctx)

// updateStaffPortals — no can() check
const result = await useCases.updateStaffPortals({ ... }, ctx)
```

Rule: D8 — server functions must include: tracedServerFn + auth middleware + input validation + **permission check** + use case from composition. All 5 use cases do check `can()` internally (defense-in-depth), but the server layer gate is missing for 4 functions. `listStaffPortals` is the only server function with an explicit `can()` gate, creating inconsistency.
Fix: Add `can(ctx.role, 'staff_assignment.<action>')` check in each server function handler, before calling the use case. Remove the duplicate check from use cases if D6 is interpreted strictly, or keep both for defense-in-depth but make the server-level check mandatory.

### [D1] [MAJOR] Server layer accesses cross-context portal repository directly

File: src/contexts/staff/server/staff-portals.ts:52
Quote:

```
const portal = await container.portalRepo.findById(ctx.organizationId, pid)
```

File: src/contexts/staff/server/staff-portals-update.ts:38-41
Quote:

```
const propertyPortals = await container.portalRepo.listByProperty(
  ctx.organizationId,
  data.propertyId,
)
```

Rule: D1 — server/ imports application/ + shared/ + TanStack Start. Forbidden: business logic, direct DB access. Accessing another context's repository adapter bypasses that context's application layer (use cases, rules, authorization).
Fix: Consume portal data through the portal context's public API or a shared query service. If performance requires direct repo access, extract a dedicated read-only port in the staff application layer and implement it via composition.

### [D12] [MAJOR] CONTEXT.md doesn't document `staff-portals-update.ts`

File: src/contexts/staff/CONTEXT.md:50
Quote:

```
server/              staff-assignments.ts, staff-portals.ts
```

Rule: D12 — CONTEXT.md architecture layers must match actual code. The file `staff-portals-update.ts` exists in `server/` but is not listed. The `updateStaffPortals` function lives there, not in `staff-portals.ts`.
Fix: Update architecture layers section:

```
server/              staff-assignments.ts, staff-portals.ts, staff-portals-update.ts
```

### [D12] [MAJOR] CONTEXT.md misattributes `updateStaffPortals` to `staff-portals.ts`

File: src/contexts/staff/CONTEXT.md:79
Quote:

```
staff-portals.ts — Server functions for staff portal access (listStaffPortals, updateStaffPortals).
```

Rule: D12 — context documentation accuracy. `updateStaffPortals` is defined in `staff-portals-update.ts` and re-exported from `staff-assignments.ts` (line 126). It does not appear in `staff-portals.ts`.
Fix: Split the server functions section:

```
- **`staff-portals.ts`** — listStaffPortals server function.
- **`staff-portals-update.ts`** — updateStaffPortals server function.
```

### [D12] [MAJOR] CONTEXT.md Input column conflates request input with auth context fields

File: src/contexts/staff/CONTEXT.md:57-62
Quote:

```
| `createStaffAssignment` | `propertyId`, `userId`, `teamId?`, `portalId?`, `organizationId`, `role` |
| `removeStaffAssignment` | `assignmentId`, `organizationId`, `role`                                 |
| `listStaffAssignments`  | `propertyId`, `organizationId`, `role`                                   |
```

Rule: D12 — context documentation accuracy. `organizationId` and `role` are never part of the request input (DTO schemas). They come from `AuthContext` resolved by server middleware. Listing them as "Input" is misleading — a reader would expect them in the request body or query params.
Fix: Add a footnote or column clarifying that `organizationId` and `role` are derived from auth context, not request input. Alternatively, rename the column to "Parameters" and separate `Input: ... | Auth: organizationId, role`.

### [D8] [MINOR] `createStaffAssignment` passes raw string data; other server functions convert to branded IDs

File: src/contexts/staff/server/staff-assignments.ts:50
Quote:

```
const assignment = await useCases.createStaffAssignment(data, ctx)
```

Contrast with removeStaffAssignment (line 76):

```
await useCases.removeStaffAssignment(
  { assignmentId: toStaffAssignmentId(data.assignmentId) }, ctx,
)
```

Rule: D8 — consistency. Four server functions convert DTO strings to branded IDs before calling the use case. `createStaffAssignment` delegates conversion to the use case, creating an inconsistent boundary.
Fix: Convert IDs in the server handler for `createStaffAssignment` (same as other functions), or document this as an intentional exception.

### [D15] [MINOR] N+1 query pattern in `listStaffPortals`

File: src/contexts/staff/server/staff-portals.ts:51-56
Quote:

```
for (const pid of portalIds) {
  const portal = await container.portalRepo.findById(ctx.organizationId, pid)
  if (portal && portal.isActive) {
    portals.push({ id: portal.id, name: portal.name })
  }
}
```

Rule: D15 / performance — sequential DB queries in a loop. For a typical user with ≤10 portal assignments this is acceptable, but it won't scale if portal counts grow.
Fix: Batch-fetch with `portalRepo.findByIds(orgId, portalIds)` or accept the tradeoff and add a comment noting the intentional N+1 for small cardinality.

### [D12] [MINOR] CONTEXT.md Ports section documents only `listByUserAndProperty`; 8 other methods undocumented

File: src/contexts/staff/CONTEXT.md:89-91
Quote:

```
- **StaffAssignmentRepository** — Persistence port for staff assignments.
  - `listByUserAndProperty(organizationId, userId, propertyId)` — Returns assignments for a user in a specific property.
```

Rule: D12 — context documentation accuracy. The port interface defines 9 methods (`findById`, `listByUser`, `listByProperty`, `listByTeam`, `listByUserAndProperty`, `assignmentExists`, `insert`, `softDelete`, `getAccessiblePropertyIds`). Only one is documented.
Fix: List all port methods with one-line descriptions, or explicitly state "see application/ports/staff-assignment.repository.ts for full interface" if the section is intentionally abbreviated.

### [D12] [NIT] CONTEXT.md lists `staff-portals-update.ts` re-export chain incorrectly

File: src/contexts/staff/CONTEXT.md:50
File: src/contexts/staff/server/staff-assignments.ts:126
Quote (server-assignments.ts):

```
export { updateStaffPortals } from './staff-portals-update'
```

Rule: D12 — `updateStaffPortals` is defined in `staff-portals-update.ts` and re-exported from `staff-assignments.ts`. CONTEXT.md doesn't document this re-export chain, which could confuse consumers who import from `staff-assignments.ts` expecting the function to be defined there.
Fix: Add a note in the server functions section documenting the re-export, or remove the re-export and have consumers import directly from `staff-portals-update.ts`.

---

## Positive Observations

- **D5 (Repository ports):** The `StaffAssignmentRepository` port is well-typed with branded IDs. The Drizzle adapter (`createStaffAssignmentRepository`) implements every port method. The mapper (`staffAssignmentFromRow` / `staffAssignmentToRow`) cleanly separates DB row types from domain types.
- **D7 (Multi-tenancy):** Every single query method uses `baseWhere(staffAssignments, orgId)`, which enforces `WHERE organization_id = ? AND deleted_at IS NULL`. The `insert` method has an additional guard: `if (assignment.organizationId !== orgId) throw staffError(...)`. Tenant isolation is consistently enforced.
- **D7 (Tests):** Integration tests (`staff-assignment.repository.test.ts`) use two separate organizations (`ORG_A`, `ORG_B`) and verify cross-tenant data leakage doesn't occur.
- **D15 (Error handling):** Domain uses plain `StaffError` objects (not `throw new Error`), server functions map domain errors to HTTP status via `staffErrorStatus`, and `catchUntagged` provides a safety net for unexpected errors. No bare `catch` blocks or swallowed errors found.
- **D8 (Tracing):** All server functions use `tracedHandler` with method + label. All repository methods use `trace()` spans.
- **Events:** `StaffAssigned` and `StaffUnassigned` events follow the tag naming convention (`staff.assigned`, `staff.unassigned`), include `eventId`, `occurredAt`, `correlationId`, and use flat payloads. Constructors validate `occurredAt instanceof Date`.
