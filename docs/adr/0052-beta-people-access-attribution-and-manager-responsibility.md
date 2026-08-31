---
status: accepted
date: 2026-08-25
---

# 0052 — Beta people, access, attribution, and manager responsibility

## Context

The beta design needs to answer four different questions without inferring one
answer from another:

1. Who can sign in, and with which Organization role?
2. Which Properties may an interactive manager access?
3. Which Staff Participant's work should a Portal's future metrics be attributed to?
4. Which managers should receive and handle workflow notifications for a Property
   or Portal?

The legacy `staff_assignments` model mixes login identity, Property access, Team
membership, and Portal assignment. ADR 0039 separated several of those concerns,
but retained login-bound Staff Participation and Team Membership. ADR 0013 also
kept Team as an administrative concept. Those clauses no longer match the agreed
beta product: Teams are not used, Portal Groups group Portals rather than people,
and a person tracked for operational attribution does not need an account.

## Decision

The canonical beta model has the following independent concepts:

| Concept                      | Meaning                                                                                                                                                                                                                    | Explicit non-implications                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `OrganizationMembership`     | Login identity and built-in Organization role.                                                                                                                                                                             | Does not create Staff Participation, Property access, attribution, or notification responsibility. |
| `PropertyAccessGrant`        | Property scope available to an interactive AccountAdmin or PropertyManager. AccountAdmin remains Organization-wide by role.                                                                                                | Does not make the user staff, attribute metrics, or subscribe the user to notifications.           |
| `StaffParticipant`           | Manager-maintained business/person profile. It may exist without a login.                                                                                                                                                  | Does not grant application access or receive manager notifications.                                |
| `StaffUserLink`              | Optional future link from a Staff Participant to a login identity.                                                                                                                                                         | Deferred for beta; linking must not silently grant access.                                         |
| `StaffParticipation`         | Effective-dated relationship between a Staff Participant and a Property.                                                                                                                                                   | Does not grant Property access or notification authority.                                          |
| `PortalResponsibility`       | Effective-dated Staff Participation-to-Portal performance attribution. One active Primary Staff Attribution is allowed per Portal; supporting relationships provide operational context without duplicating metric credit. | Does not grant access and does not select notification recipients.                                 |
| `PortalResponsibleManager`   | Effective-dated AccountAdmin/PropertyManager workflow and notification assignment for one Portal. Multiple eligible managers may be assigned.                                                                              | Does not grant Property access and is not staff attribution.                                       |
| `PropertyResponsibleManager` | Effective-dated AccountAdmin/PropertyManager workflow and notification assignment for Property-wide Google/import/sync/health work.                                                                                        | Does not grant Property access and is not inferred from all Property managers.                     |
| `PortalGroup`                | Reporting and Goal scope for zero or more Portals. A Portal may remain ungrouped.                                                                                                                                          | It is not a people Team and Team data must never be mapped to it.                                  |

### Manager eligibility and defaults

- An active AccountAdmin is Organization-wide eligible.
- A PropertyManager additionally needs a current `PropertyAccessGrant` and active
  participation for the Property.
- The eligible Portal creator becomes the initial Portal Responsible Manager.
- There is no single-owner restriction: multiple eligible managers may be assigned.
- Only assigned Responsible Managers receive normal Portal notifications. Other
  Property managers do not receive them merely because they can access the Property.
- If an assignment becomes ineligible, end only that effective-dated assignment,
  preserve its history, and leave other assignments unchanged. Never auto-promote.
- If no eligible Portal manager remains, expose **Responsible Manager needed** and
  send AccountAdmins one content-free recovery alert. Recovery fallback is not an
  implicit assignment.

### Attribution and history

- Intervals are half-open: `[effective_from, effective_to)`. Unchanged relationships
  retain their original identifier, creator, and `effective_from` during an edit.
- Reassignment affects future facts only. Each eligible Guest response snapshots
  the active Primary Staff Attribution interval.
- Supporting attribution never multiplies Portal, Portal Group, or Property totals.
- Authorization, participation, attribution, and manager responsibility are each
  checked from their own authority; no fallback may silently substitute another.

### Team and legacy data

- Team has no beta route, navigation, UI, built-in role permission, job, or event
  consumer. Direct Team entry points are hard-denied by the unconditionally blocked
  `team.use` capability.
- Team tables, historical events, and bounded reconciliation code remain in a
  quarantine window. They are not deleted or mapped to Portal Groups.
- `staff_assignments` remains only for reconciliation/rollback evidence while readers
  and writers move to the canonical model. It is not the beta attribution authority.
- Schema contraction waits for a verified release, zero unexplained reconciliation
  rows, retention/export decisions, and restore proof.

### Staff login posture

Staff Participant management is a beta manager feature. Staff User login,
invitation, and dashboard affordances are deferred. Legitimate existing account
records are retained and receive an explicit migration/support outcome rather than
being deleted or silently admitted to an undefined shell.

## Supersession

This ADR supersedes:

- ADR 0039 where it defines `StaffParticipation` as necessarily user-bound or keeps
  `TeamMembership` in the canonical beta model;
- ADR 0013 decision 4, which says Teams remain an administrative concept;
- ADR 0006 wherever `StaffAssignment` is described as the active access or Portal
  attribution authority.

ADR 0039's separation and effective-dating principles remain valid. ADR 0013's
Portal Group/Goal scope decisions remain valid.

## Consequences

- People UI manages Staff Participants and Portal Responsibility, never Teams.
- Dashboard, Goal, Metric, Badge, and other cross-context readers use the Staff public
  API backed by current Portal Responsibility, not `staff_assignments`.
- Notification routing waits for explicit Portal/Property Responsible Manager seams;
  it must not reuse Staff Portal Responsibility.
- Participant-without-login, manager responsibility, offboarding, reconciliation,
  and later schema contraction require expand/migrate/cut over/contract phases.
- Existing code that still exposes legacy Staff or Team paths is migration debt and
  cannot be described as canonical merely because its tables or use cases remain.

## Rejected alternatives

- **Reuse Team for Portal Groups** — it merges a people structure with a reporting
  structure and recreates ambiguous scope.
- **Treat every PropertyManager as responsible** — access and notification ownership
  are different; this creates noise and violates the agreed assigned-manager audience.
- **Use Staff Portal Responsibility for notifications** — staff attribution may refer
  to a person without a login and must not imply manager authority.
- **Require a login for every Staff Participant** — it blocks operational attribution
  for real staff who do not use the application.
- **Designate exactly one Portal owner** — the workflow explicitly supports multiple
  assigned managers, with creator default and AccountAdmin recovery fallback.
