# Staff Context — Domain & Application Layer Review

**Reviewer:** automated deep review  
**Date:** 2026-06-10  
**Scope:** `src/contexts/staff/domain/`, `src/contexts/staff/application/`, `src/contexts/staff/build.ts`  
**Dimensions:** D2 (events), D3 (use cases), D4 (build), D11 (domain purity), D12 (context doc accuracy), D15 (error handling)

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 1     |
| MAJOR    | 7     |
| MINOR    | 5     |
| NIT      | 3     |

---

## Findings

### [D11] BLOCKER Domain event constructors call `crypto.randomUUID()` — side effect in domain layer

File: src/contexts/staff/domain/events.ts:32,55
Quote: ```typescript
eventId: crypto.randomUUID(),

````
Rule:  D11 — domain layer must have no side effects. `crypto.randomUUID()` is I/O/side-effect and should be injected via an `IdGenerator` port.
Fix:   Add an `idGen` parameter to both `staffAssigned()` and `staffUnassigned()` constructors (same pattern as use-case `deps.idGen`), or accept `eventId` as an argument the same way `occurredAt` is.

### [D15] MAJOR Use cases `throw staffError(…)` instead of returning `Result`
File: src/contexts/staff/application/use-cases/create-staff-assignment.ts:62,81
Quote: ```typescript
    throw staffError('already_assigned', 'this user is already assigned to this property/team/portal')
````

File: src/contexts/staff/application/use-cases/remove-staff-assignment.ts:29,38
File: src/contexts/staff/application/use-cases/list-staff-assignments.ts:30
File: src/contexts/staff/application/use-cases/get-assigned-portals.ts:27
File: src/contexts/staff/application/use-cases/update-staff-portals.ts:42,88
Rule: D15 — no `throw` in domain/application; errors should be returned as `Result` types. The `rules.ts` correctly uses `ok()`/`err()` but the use cases unwrap and re-throw.
Fix: Return `Result<Output, StaffError>` from all use cases. Let the server function layer translate to HTTP responses.

### [D3] MAJOR Remove use case skips steps 3–4 in the standard flow

File: src/contexts/staff/application/use-cases/remove-staff-assignment.ts:41-44
Quote: ```typescript
// 5. Persist
await deps.assignmentRepo.softDelete(ctx.organizationId, assignment.id)
// 6. Emit event

````
Rule:  D3 — use case steps: Authorize → Load → Check rules → Build domain → Persist → Emit → Return. Steps 3 (Check rules) and 4 (Build domain) are absent and the numbering jumps from 2 to 5.
Fix:   Either add explicit "no additional rules to check" step or renumber to reflect actual steps. Consider adding a comment for step 3 if there genuinely are no rules to validate before deletion.

### [D3] MAJOR Self-assignment bypass in create use case bypasses domain rule
File: src/contexts/staff/application/use-cases/create-staff-assignment.ts:44-50
Quote: ```typescript
  // PropertyManagers are allowed to self-assign, so skip constructor guard for them
  const isSelfAssignment = userId === ctx.userId
  const actingUserId =
    isSelfAssignment && can(ctx.role, 'staff_assignment.create')
      ? undefined
      : ctx.userId
````

Rule: D3 — business rules belong in the domain layer, not application. Bypassing the domain constructor's self-assignment guard based on role check violates layering: application layer is making a business decision about self-assignment.
Fix: Either (a) make the domain rule accept an `allowSelfAssignment` flag, or (b) move the PM self-assignment exception into `rules.ts` as a domain rule that considers the role.

### [D3] MAJOR Duplicate `ListStaffAssignmentsInput` type — DTO and use-case define independently

File: src/contexts/staff/application/dto/staff-assignment.dto.ts:28
File: src/contexts/staff/application/use-cases/list-staff-assignments.ts:12
Quote:

```typescript
// dto:
export type ListStaffAssignmentsInput = z.infer<typeof listStaffAssignmentsInputSchema>
// use-case:
export type ListStaffAssignmentsInput = Readonly<{
  propertyId?: PropertyId
  userId?: UserId
  teamId?: TeamId
}>
```

Rule: D3 — use cases should use the DTO input types. The DTO version uses plain strings; the use-case version uses branded IDs. They shadow each other and the DTO's Zod-validated type is unused.
Fix: Import `ListStaffAssignmentsInput` from the DTO in the use case, or have the use-case accept branded IDs and make the DTO import from the use case. Remove the duplicate.

### [D2] MAJOR Event constructors set `correlationId: null` — not injected

File: src/contexts/staff/domain/events.ts:33,57
Quote: ```typescript
correlationId: null,

````
Rule:  D2 — envelope should include `correlationId`. Setting it to `null` permanently means no event ever carries a correlation ID, defeating tracing. The `updateStaffPortals` use case spreads `correlationId` over the constructed event, which is a workaround but fragile.
Fix:   Accept `correlationId` as an optional parameter in the constructor (like `eventId` should be). Default to `null` if not provided.

### [D4] MAJOR `build.ts` imports `randomUUID` from Node.js `crypto` — composition root uses raw string, not branded ID
File: src/contexts/staff/build.ts:53
Quote: ```typescript
    idGen: () => staffAssignmentId(randomUUID()),
````

Rule: D4 — the `updateStaffPortals` use case's `idGen` type is `() => string`, then line 74 wraps it again with `staffAssignmentId(deps.idGen())`. This double-wraps: `build.ts` returns `StaffAssignmentId` but the use case expects `string` and wraps again.
Fix: Align the `UpdateStaffPortalsDeps.idGen` type to `() => StaffAssignmentId` (matching other use cases) and remove the redundant `staffAssignmentId()` call at line 74 of `update-staff-portals.ts`.

### [D12] MAJOR CONTEXT.md `updateStaffPortals` input mismatch — doc says `organizationId` + `role`; code takes neither

File: src/contexts/staff/CONTEXT.md:62
Quote: ```  |`updateStaffPortals`|`userId`, `propertyId`, `portalIds`|`{ added, removed }`|`staff_assignment.create`+`staff_assignment.delete` |

````
Rule:  D12 — CONTEXT.md documents the input as including `organizationId` and `role` implicitly via the use case table, but the actual `UpdateStaffPortalsInput` type is `{ userId, propertyId, portalIds }` with `organizationId` coming from `ctx`. The table's "Input" column should match the DTO type, and should note `ctx` for organizationId/role.
Fix:   Update CONTEXT.md use case table to clarify that `organizationId` and `role` come from `AuthContext`, matching the actual function signature.

### [D11] MINOR Domain event constructors import `node:assert/strict`
File: src/contexts/staff/domain/events.ts:4
Quote: ```typescript
import assert from 'node:assert/strict'
````

Rule: D11 — domain layer should avoid Node.js runtime dependencies. `assert` is a runtime assertion that throws on failure, violating the "no throw in domain" principle.
Fix: Replace `assert()` with a pure validation returning `Result`, or move the assertion into the constructor and return `Result<StaffAssigned, Error>`.

### [D2] MINOR CONTEXT.md claims events have `occurredAt` but envelope standard also requires `eventId` and `correlationId` — these are not documented in the payload column

File: src/contexts/staff/CONTEXT.md:29-30
Quote: ```  |`staff.assigned` | assignmentId, organizationId, userId, propertyId, teamId, portalId | ...

````
Rule:  D2 — envelope fields `eventId`, `occurredAt`, `correlationId` are part of every event but omitted from the CONTEXT.md payload column. Not a code bug but a documentation gap.
Fix:   Add "…plus envelope: eventId, occurredAt, correlationId" note to the events table, or include them in the payload column.

### [D3] MINOR `getAssignedPortals` use case does not match CONTEXT.md documented input
File: src/contexts/staff/CONTEXT.md:61
Quote: ```
| `getAssignedPortals` | `userId`, `propertyId` | `PortalId[]` | `staff_assignment.read` |
````

File: src/contexts/staff/application/use-cases/get-assigned-portals.ts:10-13
Code input is `{ userId: UserId, propertyId: PropertyId }` — matches. But CONTEXT.md doesn't show `organizationId` from `ctx`. Minor doc accuracy issue.
Rule: D12 — context documentation must match actual code.
Fix: Add a note that `organizationId` is sourced from `AuthContext`.

### [D3] MINOR `createStaffAssignment` use case accepts DTO (plain strings) but internally brands them — type coercion is hidden

File: src/contexts/staff/application/use-cases/create-staff-assignment.ts:39-42
Quote: ```typescript
const userId = toUserId(input.userId)
const propertyId = toPropertyId(input.propertyId)
const teamId = input.teamId != null ? toTeamId(input.teamId) : null

````
Rule:  D3 — this pattern is acceptable but the coercion from DTO string to branded ID is undocumented. The use case function signature accepts `CreateStaffAssignmentInput` (plain strings) but internally works with branded IDs.
Fix:   No code change needed; this is an acceptable adapter pattern. Document in a comment if desired.

### [D12] MINOR CONTEXT.md "Ports" section only lists `listByUserAndProperty` but port interface has 8 methods
File: src/contexts/staff/CONTEXT.md:90
Quote: ```
- `listByUserAndProperty(organizationId, userId, propertyId)` — Returns assignments for a user in a specific property.
````

Rule: D12 — context documentation is incomplete. The actual `StaffAssignmentRepository` port has `findById`, `listByUser`, `listByProperty`, `listByTeam`, `listByUserAndProperty`, `assignmentExists`, `insert`, `softDelete`, `getAccessiblePropertyIds`.
Fix: Document all port methods in CONTEXT.md or add "see port interface for full API" note.

### [D15] NIT `removeStaffAssignment` input type defined locally instead of imported from DTO

File: src/contexts/staff/application/use-cases/remove-staff-assignment.ts:13-15
Quote: ```typescript
export type RemoveStaffAssignmentInput = Readonly<{
assignmentId: StaffAssignmentId
}>

````
Rule:  D3/D15 — there is already a `RemoveStaffAssignmentInput` in the DTO file (plain string), but it's not imported. The use-case defines its own with branded ID. Inconsistency: create use-case imports DTO, remove does not.
Fix:   Decide on one pattern: either all use cases import DTO types (with coercion inside) or all define their own typed inputs. Currently inconsistent.

### [D2] NIT `updateStaffPortals` spreads `correlationId` over event constructor output
File: src/contexts/staff/application/use-cases/update-staff-portals.ts:93-104
Quote: ```typescript
      await deps.events.emit({
        ...staffAssigned({ ... }),
        correlationId,
      })
````

Rule: D2 — the event constructor returns a `Readonly` type, but the spread + override mutates the shape. This works at runtime but violates the `Readonly` contract.
Fix: Accept `correlationId` as a constructor parameter in the event constructors instead of spreading.

### [D12] NIT CONTEXT.md architecture shows `errors.test.ts`, `constructors.test.ts`, `rules.test.ts` missing from file listing

File: src/contexts/staff/CONTEXT.md:40
Quote: ```
domain/ types.ts, constructors.ts, events.ts, errors.ts, rules.ts

```
Rule:  D12 — the domain directory also contains `errors.test.ts`, `constructors.test.ts`, `rules.test.ts` not listed. Minor documentation gap.
Fix:   Either omit test files from architecture listing consistently, or include them.
```
