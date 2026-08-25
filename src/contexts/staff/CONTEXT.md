# Staff Context

## Bounded context

Staff owns business participants, their effective-dated participation at a
Property, and their Portal performance attribution. It does not own login role,
Property authorization, Team, Portal grouping, or notification responsibility.

ADR 0052 is the current beta authority. The context is mid-migration: the
StaffParticipation/PortalResponsibility path is canonical, while legacy
`staff_assignments` code and data remain only for reconciliation and controlled
rollback until contraction is safe.

## Glossary

- **StaffParticipant** — Manager-maintained person/business profile. The target
  model permits no login; the current schema is transitional and still requires
  `userId` until the expansion migration lands.
- **StaffParticipation** — Effective-dated relationship between a Participant and
  a Property. It is operational/attribution state, never an access grant.
- **PortalResponsibility** — Effective-dated Staff Participation-to-Portal
  attribution. `primary` is the single future metric-credit relationship;
  `supporting` is operational context and cannot multiply totals.
- **Portal Responsible Manager** — A separate Portal-owned manager workflow and
  notification assignment. It is not represented by `PortalResponsibility`.
- **StaffAssignment** — Legacy combined row retained for reconciliation. It is not
  the beta Portal-attribution or Property-access read authority.

## Relationships and invariants

- Identity owns `OrganizationMembership` and `PropertyAccessGrant`.
- StaffParticipation and PortalResponsibility carry matching Organization and
  Property scope.
- Active intervals are half-open: `[effectiveFrom, effectiveTo)`. Editing a set
  closes removed relationships, inserts new relationships, and preserves every
  unchanged row's identity, creator, and start time.
- At most one active Primary Staff Attribution exists per Portal. Supporting
  relationships do not confer primary credit.
- Participation and responsibility never grant login or Property access and never
  select notification recipients.
- Authorization uses Identity's PropertyAccessGrant-backed lookup. It is not
  derived from Team, legacy assignments, participation, or PortalResponsibility.
- Team data is quarantined and must never be interpreted as PortalGroup data.

## Active application surface

The canonical manager-facing use cases are:

| Use case                       | Purpose                                                                                              | Permission                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `createStaffParticipation`     | Start active participation at a Property. Transitional input currently selects an Organization user. | `staff.manage` plus Property scope |
| `listStaffParticipations`      | List participants and current Portal Responsibility selections.                                      | `staff.read` plus Property scope   |
| `archiveStaffParticipation`    | Archive participation and close its active relationships.                                            | `staff.manage` plus Property scope |
| `updatePortalResponsibilities` | Replace a responsibility set without rewriting unchanged intervals.                                  | `staff.manage` plus Property scope |
| `listStaffPortals`             | Resolve a Staff user's published Portals from current PortalResponsibility.                          | `staff.read`                       |

The People route uses only these participation/responsibility seams, the Identity
member directory, and Portal options. It has no Team dependency.

## Public API

Cross-context consumers use `application/public-api.ts`:

- `getAccessiblePropertyIds` delegates to the Identity-owned access-grant lookup;
- `getAssignedPortals` resolves current PortalResponsibility for the active
  participation and is the canonical attribution read seam;
- participation lookup methods expose narrow current Staff state where needed.

Consumers must never access Staff repositories or `container.useCases` directly.
Notification code must use future Portal/Property Responsible Manager APIs instead
of `getAssignedPortals`.

## Legacy quarantine

Legacy assignment use cases, repositories, events, and server functions remain in
the package because the migration has not reached contraction. They must not gain a
new beta consumer. Schema removal waits for:

1. an exact/mappable/conflict/orphan/unsafe reconciliation report with zero
   unexplained rows;
2. replacement write/read parity and denial of legacy mutations;
3. one verified release plus retention/export and restore evidence.

## Architecture layers

```
staff/
  domain/              StaffParticipation, PortalResponsibility, legacy assignment
  application/
    ports/             participation repository, responsibility lookup, access ports
    use-cases/         canonical participation/responsibility plus quarantined legacy paths
    public-api.ts      cross-context Staff read surface
  infrastructure/
    repositories/      effective-dated participation/responsibility and legacy assignment
  server/              manager participation endpoints plus retained legacy endpoints
  build.ts             constructs canonical and quarantine seams
```

## Events

`staff.assigned` and `staff.unassigned` belong to the legacy assignment path and
remain for historical/reconciliation compatibility. New participation and manager
responsibility event contracts must be identifier-only and added with their owning
projection/consumer; do not relabel legacy events.

## Deferred work

- Expand StaffParticipant so it can exist without `userId`, with an optional future
  StaffUserLink.
- Add revision/CAS and conflict UI for concurrent responsibility editing.
- Persist explicit archive reason on the participation lifecycle.
- Add PortalResponsibleManager and PropertyResponsibleManager in their owning
  contexts; do not place them in Staff PortalResponsibility.
- Cut over remaining legacy readers (including any Badge/recognition path), then
  deny legacy mutations and contract only after the quarantine gates pass.
