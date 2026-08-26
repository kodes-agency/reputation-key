# Staff Context

## Bounded context

Staff owns business participants, their effective-dated participation at a
Property, and their Portal performance attribution. It does not own login role,
Property authorization, Team, Portal grouping, or notification responsibility.

ADR 0052 is the current beta authority. The context is mid-migration: the
StaffParticipation/PortalResponsibility path is canonical, while legacy
`staff_assignments` code and data remain only for reconciliation and controlled
rollback until contraction is safe.

## Invariants

- Identity owns `OrganizationMembership` and `PropertyAccessGrant`.
- StaffParticipation and PortalResponsibility carry matching Organization and
  Property scope.
- Active intervals are half-open: `[effectiveFrom, effectiveTo)`. Editing a set
  closes removed relationships, inserts new relationships, and preserves every
  unchanged row's identity, creator, and start time.
- Current `StaffUserLink` reads honor both interval boundaries. If retained data
  contains overlapping current links for a Participant or login, interactive
  eligibility resolves no link until reconciliation removes the ambiguity.
- At most one active Primary Staff Attribution exists per Portal. Supporting
  relationships do not confer primary credit.
- Participation and responsibility never grant login or Property access and never
  select notification recipients.
- Invitation acceptance may provision an explicitly selected PropertyAccessGrant,
  but never creates Staff participation or attribution.
- Authorization uses Identity's PropertyAccessGrant-backed lookup. It is not
  derived from Team, legacy assignments, participation, or PortalResponsibility.
- Team data is quarantined and must never be interpreted as PortalGroup data.

## Events produced

The retained events belong to the inactive legacy StaffAssignment path. Its command
store and endpoints are not wired in beta, so these schemas exist only for
historical/reconciliation compatibility.

| `_tag`             | Payload fields                                                                                                           | When emitted                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `staff.assigned`   | `eventId`, `assignmentId`, `organizationId`, `userId`, `propertyId`, `teamId`, `portalId`, `occurredAt`, `correlationId` | Legacy assignment insertion only   |
| `staff.unassigned` | `eventId`, `assignmentId`, `organizationId`, `userId`, `propertyId`, `portalId`, `occurredAt`, `correlationId`           | Legacy assignment soft-delete only |

New participation and manager-responsibility event contracts must be
identifier-only and added with their owning projection/consumer; do not relabel
legacy events.

## Public API

Cross-context consumers use `application/public-api.ts`:

- `getAccessiblePropertyIds` delegates to the Identity-owned access-grant lookup;
- `getAssignedPortals` resolves current PortalResponsibility for the active
  participation and is the canonical attribution read seam;
- participation lookup methods expose narrow current Staff state where needed.

Consumers must never access Staff repositories or `container.useCases` directly.
Notification code must use future Portal/Property Responsible Manager APIs instead
of `getAssignedPortals`.

The Identity-owned operator-only reconciliation seam is
`../identity/infrastructure/repositories/people-authority-reconciliation.repository.ts`.
It is read-only and compares legacy assignment/access rows, Better Auth
membership, canonical Participant/link/participation/attribution rows, manager
responsibility, and quarantined Team history at one explicit observation time.
Its stable outcomes are `exact`, `mappable`, `conflict`, `orphan`, and `unsafe`;
no outcome performs or authorizes a write.

## Glossary

- **StaffParticipant** — Manager-maintained person/business profile. The target
  model permits no login. A current `StaffUserLink` may associate a retained
  login identity without granting application access.
- **StaffParticipation** — Effective-dated relationship between a Participant and
  a Property. It is operational/attribution state, never an access grant.
- **PortalResponsibility** — Effective-dated Staff Participation-to-Portal
  attribution. `primary` is the single future metric-credit relationship;
  `supporting` is operational context and cannot multiply totals.
- **Portal Responsible Manager** — A separate Portal-owned manager workflow and
  notification assignment. It is not represented by `PortalResponsibility`.
- **StaffAssignment** — Legacy combined row retained for reconciliation. It is not
  the beta Portal-attribution or Property-access read authority.

## Active application surface

| Use case                       | Purpose                                                                                   | Permission                         |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| `createStaffParticipation`     | Create a login-independent StaffParticipant and start active participation at a Property. | `staff.manage` plus Property scope |
| `listStaffParticipations`      | List participants and current Portal Responsibility selections.                           | `staff.read` plus Property scope   |
| `archiveStaffParticipation`    | Archive participation and close its active relationships.                                 | `staff.manage` plus Property scope |
| `updatePortalResponsibilities` | Replace a responsibility set without rewriting unchanged intervals.                       | `staff.manage` plus Property scope |
| `listStaffPortals`             | Resolve a Staff user's published Portals from current PortalResponsibility.               | `staff.read`                       |

The People route uses only these participation/responsibility seams, the Identity
member directory, and Portal options. It has no Team dependency.

## Legacy quarantine

Legacy assignment repositories, the older plural `property_access_grants` table,
inactive use-case/source files, events, and Team data remain because the migration
has not reached contraction. Their network endpoints and activity consumers have
been removed; they must not gain a new beta consumer. The deterministic authority
report is the current review input; older conversion utilities are not authority
to revive Team or infer access/manager responsibility. Schema removal waits for:

1. an exact/mappable/conflict/orphan/unsafe reconciliation report with zero
   unexplained rows;
2. replacement write/read parity and denial of legacy mutations;
3. one verified release plus retention/export and restore evidence.

## Architecture layers

```
staff/
  domain/              StaffParticipant, StaffParticipation, PortalResponsibility, legacy assignment
  application/
    ports/             participation repository, responsibility lookup, access ports
    use-cases/         canonical participation/responsibility plus inactive legacy source
    public-api.ts      cross-context Staff read surface
  infrastructure/
    repositories/      effective-dated participation/responsibility and legacy assignment
  server/              manager participation/responsibility endpoints only
  build.ts             constructs canonical and quarantine seams
```

## Deferred work

- Contract the nullable legacy `staff_participations.user_id` and display-name
  shadows only after rollback/parity evidence permits it.
- Cut over remaining internal legacy readers (including any Badge/recognition path)
  and contract inactive source/data only after the quarantine gates pass.
