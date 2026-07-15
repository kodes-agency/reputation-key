# ADR 0039 — People, Access, and Attribution Are Separate Effective-Dated Concepts

**Status:** Accepted
**Date:** 2026-07-15
**Supersedes:** Staff assignment shape described in ADR 0006 (does not change the staff bounded context boundary)

## Context

The current `staff_assignments` table combines property access, team membership, and portal responsibility in one row. This coupling causes:

1. Updating one concern can duplicate, clear, or infer another.
2. Portal ownership uses polymorphic `entityType/entityId` without database integrity.
3. Team lead is not validated against current membership and property.
4. Authorization may derive from team/portal ownership rather than an explicit access grant.

## Decision

`PropertyAccessGrant`, `StaffParticipation`, `TeamMembership`, and `PortalResponsibility` are **separate effective-dated concepts** with distinct owners:

| Concept                | Owner                  | Meaning                                                                                |
| ---------------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| `PropertyAccessGrant`  | Identity authorization | User may perform declared actions within a property scope.                             |
| `StaffParticipation`   | Staff context          | User participates as staff at a property; holds profile/display and active lifecycle.  |
| `TeamMembership`       | Team context           | Effective-dated relation between staff participation and team, `member` or `lead`.     |
| `PortalResponsibility` | Staff context          | Effective-dated attribution of staff participation to a portal. Does not grant access. |

### Invariants

- Every relation carries `organization_id` and `property_id`; referenced rows must match both.
- Time intervals are half-open: `[effective_from, effective_to)`. `effective_to = null` means active.
- The same relation cannot have overlapping active intervals.
- Authorization **never** derives from team membership, lead status, or portal responsibility.
- Removing property access does not erase participation or history.
- One active lead per team (default). One primary portal responsibility per portal (default).

## Consequences

- `staff_assignments` is retired after migration; all consumers use the new modules.
- Portal `entityType/entityId` polymorphic ownership is replaced by explicit responsibility commands.
- Team lead shortcut column is replaced by role-bearing effective-dated membership.
- Destructive cascades on team/portal deletion are replaced by lifecycle-aware behavior.
- Migration backfill must be deterministic: every existing row gets a clear interpretation or is quarantined.

## Rejected Alternatives

- **Keep the combined assignment row** — the coupling is the root cause of authorization, history, and attribution bugs.
- **Derive authorization from team membership** — violates the principle that authorization is an explicit grant, not an inference from organizational structure.
