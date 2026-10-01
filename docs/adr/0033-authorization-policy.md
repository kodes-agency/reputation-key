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
