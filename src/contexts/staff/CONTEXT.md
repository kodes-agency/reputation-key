# Staff Context

## Bounded context

TODO: One sentence describing what this context does.

Staff assignment management — linking users to properties (directly or via teams).

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

| Tag                | Payload                                         | When                        |
| ------------------ | ----------------------------------------------- | --------------------------- |
| `staff.assigned`   | assignmentId, orgId, userId, propertyId, teamId | Staff assigned to property  |
| `staff.unassigned` | assignmentId, orgId, userId, propertyId         | Staff removed from property |

## Events consumed

None. Staff context does not subscribe to events from other contexts.

## Public API

Exported from `application/public-api.ts`:

- Types: `StaffPublicApi` interface
  - `getAccessiblePropertyIds(orgId, userId, role)` — Returns property IDs accessible to a user based on role and assignments. Returns `null` for AccountAdmin (all properties).
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
                       list-staff-assignments.ts
    public-api.ts      re-exports StaffPublicApi, event types/constructors
  infrastructure/
    repositories/      staff-assignment.repository.ts (Drizzle)
    mappers/           staff-assignment.mapper.ts
  server/              staff-assignments.ts
  build.ts
```

## Use cases

| Name                    | Input                                                           | Output              | Permission    |
| ----------------------- | --------------------------------------------------------------- | ------------------- | ------------- |
| `createStaffAssignment` | `propertyId`, `userId`, `teamId?`, `portalId?`, `orgId`, `role` | `StaffAssignment`   | `staff:write` |
| `listStaffAssignments`  | `propertyId`, `orgId`, `role`                                   | `StaffAssignment[]` | `staff:read`  |
| `removeStaffAssignment` | `assignmentId`, `orgId`, `role`                                 | `void`              | `staff:write` |

## Server functions

- **`staff-assignments.ts`** — Server functions for staff assignment CRUD (create, remove, list).

## Permissions

- `staff_assignment.create` — Assign staff to properties/teams.
- `staff_assignment.delete` — Remove staff assignments.
- `staff_assignment.read` — List and view staff assignments.

## Dependencies

- **Identity context** — Staff assignments reference `userId` from identity. No direct import; user existence validated via shared auth context.
- **Property context** — `propertyId` references properties. Assignment creation validates property exists via shared schema.
