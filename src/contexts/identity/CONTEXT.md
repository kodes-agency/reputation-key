# Identity Context

## Scope

Identity owns authentication, sessions, Organizations, memberships, invitations,
Property access grants, lifecycle/export authority, and the People model. People
covers Staff Participants, effective-dated Property participation, optional login
links, and Portal performance attribution. Better Auth remains an infrastructure
adapter; no other context reads its tables directly.

## Vocabulary

- **Member** — a Better Auth login belonging to one Organization. Built-in roles
  map as `owner → AccountAdmin`, `admin → PropertyManager`, and `member → Member`.
- **Staff Participant** — a manager-maintained person or business profile. It may
  exist without a login and is not the `Member` role.
- **Staff Participation** — an effective-dated Participant-to-Property relation.
- **Portal Responsibility** — effective-dated performance attribution from a
  Staff Participation to a Portal; `primary` is the single metric-credit relation.
- **Property Access Grant** — the only explicit Property-scope authority.
- **Invitation** — a pending Organization membership request with a built-in role.
- **Organization Lifecycle Authority** — the revisioned closure, recovery, purge,
  and terminal-state control plane.

## Invariants

- The role hierarchy is `AccountAdmin > PropertyManager > Member`. Only the first
  two roles are interactive during the closed beta; Member/custom-role rows are
  retained but tenant resolution fails closed.
- Better Auth membership is Organization authority. An interactive login belongs
  to exactly one Organization, and the final AccountAdmin cannot leave or be removed.
- Invitation-bound registration is the only beta account-creation path. Invitation
  acceptance locks and rechecks membership before provisioning selected grants.
- Property authorization derives only from current Identity-owned grants. Staff
  Participation, login links, Portal Responsibility, Team history, and responsible
  manager assignments never grant membership or Property access.
- Staff Participants may exist without users. Current login links and participation
  checks are effective-dated, ambiguity-denying, and transactionally locked.
- Participation and responsibility intervals are half-open. Replacing a responsibility
  set preserves unchanged rows and closes removed relationships.
- At most one active primary Portal attribution exists. Supporting attribution does
  not multiply metrics or select notification recipients.
- Member, role, grant, policy, and lifecycle mutations advance their governing
  revision in the same transaction; stale command authority denies.
- Organization closure and export require a current, transactionally rechecked
  AccountAdmin. Purging is irreversible and Closed is terminal.
- Exports are deterministic, encrypted, time-bounded, and assembled from exactly one
  contribution per stable data-owner slot; raw retrieval tokens are never stored.

## Runtime seams

`buildIdentityContext` constructs the People surface first, then the remaining
Identity repositories and request APIs. The composition root publishes one
`IdentityPublicApi`; its nested `people` surface supplies `StaffPublicApi` facts,
primary attribution resolution, and participation management. Cross-context code
imports only `#/contexts/identity/application/public-api`.

Server functions for Organizations, settings, invitations, registration, policy,
feedback, and Staff Participation live in `server/`. Application code owns use
cases and ports; Drizzle, Better Auth, storage, and lifecycle implementations stay
under `infrastructure/`.

Identity produces identifier-minimal Organization, invitation, member, merchant-AI,
and lifecycle facts through the durable outbox. It subscribes to no foreign events.

## Lifecycle and export compatibility

People rows are Identity-owned, but durable lifecycle receipt context `staff` and
export paths under `staff/` remain stable persisted identifiers. The moved
`staff-organization-lifecycle` and `staff-organization-export` adapters therefore
retain those keys while living under Identity infrastructure. Purge order remains
Portal Responsibilities, Portal Group memberships, Staff Participations, Staff user
links, then Staff Participants; it never deletes users, memberships, sessions, or
Property access grants.
