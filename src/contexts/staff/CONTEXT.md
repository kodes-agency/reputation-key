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
- Duplicate assignments (same user + property + team) are forbidden (`already_assigned` error).
- Only PM+ roles can create/remove assignments (enforced by centralized permission system).

## Events produced

| Tag                | Payload                                                            | When                        |
| ------------------ | ------------------------------------------------------------------ | --------------------------- |
| `staff.assigned`   | assignmentId, organizationId, userId, propertyId, teamId, portalId | Staff assigned to property  |
| `staff.unassigned` | assignmentId, organizationId, userId, propertyId, portalId         | Staff removed from property |

## Events consumed

None. Staff context does not subscribe to events from other contexts.

## Public API

Exported from `application/public-api.ts`:

- Types: `StaffPublicApi` interface
  - `getAccessiblePropertyIds(organizationId, userId, role)` — Returns property IDs accessible to a user based on role and assignments. Returns `null` for AccountAdmin (all properties).
  - `getAssignedPortals(input, ctx)` — Returns portal IDs assigned to a staff user for a given property. Cross-context consumers must call this, not `container.useCases`.
- Types: `StaffPortalEntry` (cross-context portal lookup shape with branded `PortalId`)
- Error types: `StaffErrorCode`, `StaffError`, `isStaffError`
- Event types: `StaffAssigned`, `StaffUnassigned`, `StaffEvent`
- Event constructors: `staffAssigned`, `staffUnassigned`

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
  server/              staff-assignments.ts, staff-portals.ts
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

## Server functions

- **`staff-assignments.ts`** — Server functions for staff assignment CRUD (create, remove, list).
- **`staff-portals.ts`** — Server functions for staff portal access (listStaffPortals, updateStaffPortals).

## Permissions

- `staff_assignment.create` — Assign staff to properties/teams.
- `staff_assignment.delete` — Remove staff assignments.
- `staff_assignment.read` — List and view staff assignments.

## Ports

- **StaffAssignmentRepository** — Persistence port for staff assignments.
  - `listByUserAndProperty(organizationId, userId, propertyId)` — Returns assignments for a user in a specific property.
