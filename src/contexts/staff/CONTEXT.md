# Staff Context

## Bounded context

Staff owns business participants, their effective-dated participation at a
Property, optional links to login identities, and their Portal performance
attribution. It does not own authentication, Organization membership, Property
authorization, Portal configuration, or notification responsibility.

`StaffParticipation` and `PortalResponsibility` are the operational model.
Portal Group membership is retained as effective-dated attribution history so a
past responsibility remains interpretable at event time.

## Invariants

- Identity owns `OrganizationMembership` and `PropertyAccessGrant`.
- A `StaffParticipant` can exist without a login identity.
- A current `StaffUserLink` associates a participant with a login without
  granting membership or access.
- `StaffParticipation` and `PortalResponsibility` carry matching Organization
  and Property scope.
- Active intervals are half-open: `[effectiveFrom, effectiveTo)`. Replacing a
  responsibility set closes removed relationships, inserts new relationships,
  and preserves every unchanged row's identity, creator, and start time.
- Current `StaffUserLink` reads honor both interval boundaries. If data contains
  overlapping current links for a Participant or login, interactive eligibility
  resolves no link until the ambiguity is corrected.
- Authorization-sensitive participation checks run in the caller's command
  transaction and lock the one unambiguous current `StaffUserLink` before the
  exact Organization/Property `StaffParticipation`. Link or participation
  revocation therefore cannot race the protected write.
- At most one active Primary Staff Attribution exists per Portal. Supporting
  relationships do not confer primary credit.
- Participation and responsibility never grant login or Property access and
  never select notification recipients.
- Invitation acceptance may provision an explicitly selected
  `PropertyAccessGrant`, but never creates Staff participation or attribution.
- Authorization uses Identity's `PropertyAccessGrant`-backed lookup. It is not
  derived from participation or Portal responsibility.

## Events produced

Staff currently emits no domain events.

New participation and responsibility event contracts must be identifier-only
and added with their owning projection or consumer.

## Public API

Cross-context consumers use `application/public-api.ts`:

- `getAccessiblePropertyIds` delegates to the Identity-owned access-grant
  lookup;
- `getAssignedPortals` resolves published Portals from the current
  `PortalResponsibility` set for a user's active participation;
- participation lookup methods expose narrow current Staff state where needed.

Consumers must never access Staff repositories or `container.useCases`
directly. Notification code must use Portal/Property Responsible Manager APIs
rather than treating performance attribution as notification responsibility.

## Glossary

- **StaffParticipant** — Manager-maintained person or business profile. It does
  not require a login.
- **StaffUserLink** — Effective-dated association between a participant and a
  login identity. It grants neither Organization membership nor Property
  access.
- **StaffParticipation** — Effective-dated relationship between a Participant
  and a Property. It is operational and attribution state, never an access
  grant.
- **PortalResponsibility** — Effective-dated Staff Participation-to-Portal
  attribution. `primary` is the single metric-credit relationship;
  `supporting` is operational context and cannot multiply totals.
- **Portal Responsible Manager** — A separate Portal-owned manager workflow and
  notification responsibility. It is not represented by
  `PortalResponsibility`.

## Active application surface

| Use case                       | Purpose                                                                         | Permission                         |
| ------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------- |
| `createStaffParticipation`     | Create a login-independent participant and start participation at a Property.   | `staff.manage` plus Property scope |
| `listStaffParticipations`      | List participants and current Portal Responsibility selections.                 | `staff.read` plus Property scope   |
| `archiveStaffParticipation`    | Archive participation and close active Portal Responsibilities transactionally. | `staff.manage` plus Property scope |
| `updatePortalResponsibilities` | Replace a responsibility set without rewriting unchanged intervals.             | `staff.manage` plus Property scope |

The People route uses only these participation and responsibility seams, the
Identity member directory, and Portal options.

## Organization Export contribution

`infrastructure/adapters/staff-organization-export.adapter.ts` is Staff's
`LIF-01` contributor for people and attribution content. It reads
`staff_participants`, `staff_user_links`, `staff_participations`,
`portal_responsibilities`, and `portal_group_memberships` inside one read-only
repeatable-read snapshot bounded to fifteen minutes after the request.

It emits four `tenant_visible` CSV/JSON pairs:

- `staff/participants`;
- `staff/participations`;
- `staff/portal-responsibilities`;
- `staff/portal-group-memberships`.

An Organization with no Staff-owned rows gets the affirmative `no_data`.
Property access authority is exported by Identity, and login credentials,
sessions, and tokens are excluded as secret material.

## Organization lifecycle contribution

`infrastructure/adapters/staff-organization-lifecycle.adapter.ts` contributes
three receipt-backed phases:

- `prepareClosing` counts retained Staff data without mutating it;
- `verifyPurgeReadiness` fails closed while a Staff outbox fact is unpublished,
  then reports the retained-row count without mutation;
- `purge` deletes tenant-scoped rows from `portal_responsibilities`,
  `portal_group_memberships`, `staff_participations`, `staff_user_links`, and
  `staff_participants` in foreign-key-safe order.

The purge changes no schema and never deletes Identity-owned users,
memberships, sessions, or access grants.

## Architecture layers

```
staff/
  domain/              StaffParticipant, StaffParticipation, PortalResponsibility
  application/
    ports/             participation repository, responsibility lookup, access ports
    use-cases/         participation and responsibility commands and reads
    public-api.ts      cross-context Staff read surface
  infrastructure/
    adapters/          Organization Export and lifecycle contributors
    repositories/      effective-dated participation and responsibility persistence
  server/              manager participation/responsibility endpoints
  build.ts             constructs participation and attribution seams
```

## Deferred work

- Normalize the nullable `staff_participations.user_id` and display-name
  compatibility columns only when migration and rollback evidence permits it.
