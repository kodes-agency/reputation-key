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
