# Staff Context

Staff assignment management — linking users to properties (directly or via teams) with referral code generation and resolution.

## Glossary

- **StaffAssignment** — Links a user to a property, optionally via a team. Carries `propertyId`, `teamId` (nullable), `portalId` (nullable), and a `referralCode` (nullable).
- **Referral Code** — Unique slug-based code for a staff member (e.g., `jane-d-a3f2`). Used for scan attribution on guest-facing portal pages. Generated from the user's name + random hash.
- **Self-assignment** — A user assigning themselves to a property. Explicitly forbidden by domain rules.

## Relationships

- StaffAssignment → Property (required `propertyId`).
- StaffAssignment → Team (optional `teamId`, scopes assignment to a team).
- StaffAssignment → Portal (optional `portalId`, scopes assignment to a specific portal).
- StaffAssignment → User (via `userId`, identity context).
- Guest context depends on `StaffPublicApi.findByReferralCode` for scan attribution.
- Goal context subscribes to `staff.unassigned` events to cancel staff-scoped goals.
- Dashboard context may query staff counts via facade ports.

## Invariants

- A user cannot assign themselves to a property/team (`validateNotSelfAssignment`).
- Duplicate assignments (same user + property + team) are forbidden (`already_assigned` error).
- Referral codes must be unique per organization. Collisions trigger regeneration.
- Only PM+ roles can create/remove assignments (enforced by centralized permission system).

## Events produced

| Tag                | Payload                                         | When                        |
| ------------------ | ----------------------------------------------- | --------------------------- |
| `staff.assigned`   | assignmentId, orgId, userId, propertyId, teamId | Staff assigned to property  |
| `staff.unassigned` | assignmentId, orgId, userId, propertyId         | Staff removed from property |

## Events consumed

None. Staff context does not subscribe to events from other contexts.

## Public API

- `src/contexts/staff/application/public-api.ts` — `StaffPublicApi` type
  - `getAccessiblePropertyIds(orgId, userId, role)` — Returns property IDs accessible to a user based on role and assignments. Returns `null` for AccountAdmin (all properties).
  - `findByReferralCode(orgId, referralCode)` — Resolves a referral code to the assigned staff member's user ID.

## Architecture layers

```
staff/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts, referral-code.ts
  application/
    ports/             staff-assignment.repository.ts
    dto/               staff-assignment.dto.ts (Zod schemas)
    use-cases/         create-staff-assignment.ts, remove-staff-assignment.ts,
                       list-staff-assignments.ts, resolve-referral-code.ts
  infrastructure/
    repositories/      staff-assignment.repository.ts (Drizzle)
    mappers/           staff-assignment.mapper.ts
  server/              staff-assignments.ts
```

## Dependencies

- **Identity context** — Staff assignments reference `userId` from identity. No direct import; user existence validated via shared auth context.
- **Property context** — `propertyId` references properties. Assignment creation validates property exists via shared schema.
