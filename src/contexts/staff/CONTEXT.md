# Staff Context

## Bounded context

Staff assignment management — linking users to properties (directly or via teams), including portal access scoping for staff users.

## Glossary

- **StaffAssignment** — Links a user to a property, optionally via a team. Carries `propertyId`, `teamId` (nullable), and `portalId` (nullable).
- **Self-assignment** — A user assigning themselves to a property. Explicitly forbidden by domain rules.

## Relationships

- StaffAssignment → Property (required `propertyId`).
- StaffAssignment → Team (optional `teamId`, scopes assignment to a team).
- StaffAssignment → Portal (optional `portalId`, scopes assignment to a specific portal).
- StaffAssignment → User (via `userId`, identity context).

## Invariants

- A user cannot assign themselves to a property/team (`validateNotSelfAssignment`).
- Duplicate assignments (same user + property + team + portal) are forbidden (`already_assigned` error). Portal-scoped rows are intentionally distinct from property-level rows (no team/portal).
- Only PM+ roles can create/remove assignments (enforced by centralized permission system).

## Events produced

| Tag                | Payload                                                            | When                        |
| ------------------ | ------------------------------------------------------------------ | --------------------------- |
| `staff.assigned`   | assignmentId, organizationId, userId, propertyId, teamId, portalId | Staff assigned to property  |
| `staff.unassigned` | assignmentId, organizationId, userId, propertyId, portalId         | Staff removed from property |

All events include envelope fields: eventId, occurredAt, correlationId (may be null).

## Events consumed

None. Staff context does not subscribe to events from other contexts.

## Architecture layers

```
staff/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts
  application/
    ports/             staff-assignment.repository.ts
    dto/               staff-assignment.dto.ts (Zod schemas)
    use-cases/         create-staff-assignment.ts, remove-staff-assignment.ts,
                       list-staff-assignments.ts, get-assigned-portals.ts, update-staff-portals.ts
    public-api.ts      re-exports StaffPublicApi, event types/constructors
  infrastructure/
    repositories/      staff-assignment.repository.ts (Drizzle)
    mappers/           staff-assignment.mapper.ts
  server/              staff-assignments.ts, staff-portals.ts, staff-portals-update.ts
  build.ts
```

## Use cases

| Name                    | Input                                                                    | Output                               | Permission                                            |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------------------ | ----------------------------------------------------- |
| `createStaffAssignment` | `propertyId`, `userId`, `teamId?`, `portalId?`, `organizationId`, `role` | `StaffAssignment`                    | `staff_assignment.create`                             |
| `listStaffAssignments`  | `propertyId`, `organizationId`, `role`                                   | `StaffAssignment[]`                  | `staff_assignment.read`                               |
| `removeStaffAssignment` | `assignmentId`, `organizationId`, `role`                                 | `void`                               | `staff_assignment.delete`                             |
| `getAssignedPortals`    | `userId`, `propertyId`                                                   | `PortalId[]`                         | `staff_assignment.read`                               |
| `updateStaffPortals`    | `userId`, `propertyId`, `portalIds`                                      | `{ added: number, removed: number }` | `staff_assignment.create` + `staff_assignment.delete` |

Note: `organizationId` and `role` are derived from AuthContext (resolved via `resolveTenantContext`), not from request body/query params. The Input column shows only request-level parameters; auth context fields are implicit.

## Public API

Exported from `application/public-api.ts`:

- Types: `StaffPublicApi` interface
  - `getAccessiblePropertyIds(organizationId, userId, role)` — Returns property IDs accessible to a user based on role and assignments. Returns `null` for AccountAdmin (all properties).
  - `getAssignedPortals(input, ctx)` — Returns portal IDs assigned to a staff user for a given property. Cross-context consumers must call this, not `container.useCases`.
- Types: `StaffPortalEntry` (cross-context portal lookup shape with branded `PortalId`)
- Error types: `StaffErrorCode`, `StaffError`, `isStaffError`
- Event types: `StaffAssigned`, `StaffUnassigned`, `StaffEvent`
- Event constructors: `staffAssigned`, `staffUnassigned`

## Server functions

- **`staff-assignments.ts`** — Server functions for staff assignment CRUD (create, remove, list).
- **`staff-portals.ts`** — Server function for listing staff portals (`listStaffPortals`).
- **`staff-portals-update.ts`** — Server function for updating staff portals (`updateStaffPortals`).

## Permissions

- `staff_assignment.create` — Assign staff to properties/teams.
- `staff_assignment.delete` — Remove staff assignments.
- `staff_assignment.read` — List and view staff assignments.

## Ports

- **StaffAssignmentRepository** — Persistence port for staff assignments (`application/ports/staff-assignment.repository.ts`).
  - `findById(orgId, id)` — Find assignment by ID.
  - `listByUser(orgId, userId)` — List all assignments for a user.
  - `listByProperty(orgId, propertyId)` — List all assignments for a property.
  - `listByTeam(orgId, teamId)` — List all assignments for a team.
  - `listByUserAndProperty(orgId, userId, propertyId)` — Returns assignments for a user in a specific property.
  - `assignmentExists(orgId, userId, propertyId, teamId, portalId)` — Check for duplicate assignment.
  - `insert(orgId, assignment)` — Create new assignment.
  - `softDelete(orgId, id)` — Soft-delete assignment.
  - `getAccessiblePropertyIds(orgId, userId)` — Get all unique property IDs a user is assigned to.
