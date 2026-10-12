---
status: accepted
date: 2026-07-15
---

# 0033 — Authorization policy

## Decision

`ExecutionPolicy` is the single authorization path. One normalized request
returns an allow or a typed denial with a stable reason and policy version,
covering principal, Organization membership, Property scope, capability state,
suspension, consent, and the operation's resource.

Interactive entry points call `requireExecutionAllowed`. Delayed work is
re-authorized at execution through the delayed-execution gate. Contexts do not
infer permission from role strings, Team membership, attribution, or assignment,
and a capability allowlist never grants access.

The last AccountAdmin cannot be removed or demoted. Sensitive role, lifecycle,
connection, publication, and destructive operations require their explicit
action and scope; an unavailable or unknown policy input fails closed.

## Consequences

- The deleted `requireAuthorized`, `authorize`, and `checkAuthorization` seams
  are not compatibility APIs.
- Permission-to-capability mapping lives in
  `src/shared/auth/capability-for-permission.ts`.
- New entry points must name one execution-policy action and resource scope.
- Every delayed entry point that shares an action declares the same resource
  scope, and the delayed gate decides with the scope of the row it resolved. A
  tenant-cross sweep and the per-item work it discovers are separate actions:
  one Property-scoped job once made every Organization-scoped notification
  consumer that shared its action deny `missing_scope`.
- An Organization- or Property-scoped job is enqueued with its `organizationId`
  (and `propertyId`) in the payload, because the delayed gate reads a job's
  scope from there and nowhere else. A producer that leaves them out is refused
  by nothing: every job completes as a terminal `missing_scope` denial and the
  work never runs. Property AI trends were enqueued with their schedule alone
  and none was generated. `scoped-job-enqueue-scope.test.ts` drives every scoped
  family's producer through the gate, and a new scoped family fails there until
  it names how it is enqueued.

## Amended 2026-10-01 — manager administration is AccountAdmin-only

An AccountAdmin may change any member's role, another AccountAdmin's included,
but nobody changes their own role, and a change that leaves the role as it was
is refused; both refusals come before the last-AccountAdmin guard, so they are
never reported as it, and that guard still holds under the Organization lock.
Only an AccountAdmin changes a PropertyManager's Property scope (`member.update`
at Organization scope).

The PropertyManager permission table matches. Only an AccountAdmin invites,
cancels or resends invitations, creates members, and edits Organization
settings, response targets and the logo included (`identity.logo_upload` is
the AccountAdmin's alone, since finalizing a logo writes through the same
Organization update); a PropertyManager holds `member.list` and nothing else
about members, invitations or the Organization, and keeps it because Inbox
assignment and Responsible managers read the member list. The Members page reads only what the
viewer's role may read, so a PropertyManager's page issues no invitation or
grant read.

## Amended 2026-10-12 — the provider's HTTP routes are an allow list

Better Auth serves every endpoint of its core and of its organization plugin
from one handler, and those endpoints decide with the library's own checks:
membership for the organization reads, the role table for its writes, and a
session alone for creating an Organization. None of them asks `ExecutionPolicy`,
so each one reachable over HTTP is a second authorization path. Refusing a list
of paths did not hold. A PropertyManager could read every invitation of the
Organization, ids included, and an invitation id is all that invited
registration asks for besides the invited address. Any signed-in account could
create an Organization and own it. An AccountAdmin could update the Organization
with the kill switch pulled or the Organization suspended.

`/api/auth/*` therefore serves an allow list
(`src/routes/api/auth/-provider-routes.ts`). A request reaches the provider only
when its method and exact path name a route the product needs over HTTP: reading
one's own session, sign-in, sign-out, the password-reset steps and the mailed
verification link. Every other request is refused with 404 before the provider
sees it. A route is added only when it returns and changes nothing more than the
caller already can through app-owned server functions, with that reason written
beside it. The app keeps calling the provider in process, behind
`requireExecutionAllowed`.

The provider also refuses a session-bound Organization creation
(`allowUserToCreateOrganization: false`), so a second mount of its handler would
not reopen self-service. `createOrganizationFn`, dormant behind
`organization.create`, creates as a provider system action.

`src/routes/api/auth/-provider-routes.test.ts` enumerates the configured
provider's endpoints and fails when one is neither allowed nor refused on
purpose, so an upgrade or a new plugin cannot add a reachable route unnoticed.
`src/routes/api/auth/-$.integration.test.ts` proves the refusals against the
real provider and database.
