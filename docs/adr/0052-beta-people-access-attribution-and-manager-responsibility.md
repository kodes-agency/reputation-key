---
status: accepted
date: 2026-08-25
---

# 0052 — Beta people, access, attribution, and manager responsibility

## Context

Login role, Property access, Staff attribution, and workflow responsibility
answer different questions. Legacy Staff Assignment and Team records mixed
them; Teams are not part of the beta product, and a Staff Participant need not
have an account.

## Decision

| Authority                    | Rule                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `OrganizationMembership`     | Login identity and built-in role; creates no access, Staff, attribution, or assignment |
| `PropertyAccessGrant`        | Interactive Property scope; creates no Staff, attribution, or notification assignment  |
| `StaffParticipant`           | Manager-maintained person profile; may exist without login                             |
| `StaffUserLink`              | Deferred optional login link; linking never grants access                              |
| `StaffParticipation`         | Effective-dated Staff-to-Property relationship; grants no access                       |
| `PortalResponsibility`       | Staff attribution; one active Primary plus non-credit Supporting relationships         |
| `PortalResponsibleManager`   | Effective-dated workflow/notification assignment; multiple managers allowed            |
| `PropertyResponsibleManager` | Effective-dated assignment for Property-wide Google/import/sync/health work            |
| `PortalGroup`                | Portal reporting/Goal scope; never a people Team                                       |

Each authority is checked independently; none may be inferred from another.

### Eligibility and history

- AccountAdmins are Organization-wide eligible. A PropertyManager also needs a
  current access grant and active Property participation.
- The eligible Portal creator is the initial Responsible Manager. Only assigned
  managers receive normal Portal notifications; multiple assignments are valid.
- When an assignment becomes ineligible, end only its half-open interval and
  preserve history. Never auto-promote another manager.
- With no eligible manager, show **Responsible Manager needed** and send
  AccountAdmins one content-free recovery alert; the alert is not an assignment.
- Intervals are `[effective_from, effective_to)`. Unchanged relationships retain
  identity, creator, and start time; reassignment changes future facts only.
- Each eligible Guest response snapshots the active Primary Staff Attribution.
  Supporting attribution never multiplies reporting totals.

### Legacy posture

- Team has no beta route, navigation, permission, job, or event consumer;
  `team.use` is unconditionally blocked.
- Team and `staff_assignments` data remain only for bounded reconciliation and
  rollback evidence. They are not mapped to Portal Groups or used as authority.
- Contraction requires a verified release, zero unexplained rows,
  retention/export decisions, and restore proof.
- Staff Participant management is available to managers; member login,
  invitation, and dashboard affordances remain deferred.

## Merged from ADR 0039

Authorization never derives from Team membership, lead status, or Portal
responsibility. Removing Property access preserves participation and history.
`effective_to = null` means the half-open interval is active.

## Consequences

- People UI manages Staff Participants and attribution, never Teams.
- Cross-context readers use the Staff public API, not `staff_assignments`.
- Notification routing uses explicit manager assignments, never Staff
  attribution.
- Existing account records receive an explicit migration/support outcome;
  they are neither deleted nor silently admitted.

## Rejected alternatives

- Reusing Team for Portal Groups merges people and reporting scope.
- Treating every PropertyManager as responsible confuses access with ownership.
- Requiring login for every Staff Participant blocks real attribution.
- A single Portal owner would reject valid multiple-manager workflows.
