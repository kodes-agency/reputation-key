---
status: proposed
---

# 0033 — Authorization policy

Identity owns action/resource/property-scope decisions and owner invariants through a stable `AuthorizationPolicy`. Contexts do not infer permission from role strings or branch on `role === 'owner'`.

## Decision

Authorization is a single decision: `AuthorizationPolicy.authorize(actor, action, resource)` returns `{ allowed: boolean, scope?: PropertyScope, reason?: string }`.

Inputs:

- **Actor**: authenticated user with active organization membership and effective role.
- **Action**: a stable permission key (e.g. `property.admin`, `inbox.manage`, `staff_assignment.read`).
- **Resource**: target entity with organization/property ownership.

Invariants enforced:

1. **Organization membership**: actor must belong to the same organization as the resource.
2. **Property scope**: actor's effective property scope (direct assignment, team assignment, or org-wide) must include the target property.
3. **Built-in role capability**: owner > admin > member capability matrix; custom roles require `ENABLE_CUSTOM_ROLES=true` and a resolved `organization_role_policy` with `data_scope`.
4. **Last-owner protection**: the last owner of an organization cannot be removed or demoted.
5. **Sensitive operations**: role-change, property-delete, and connection-disconnect require owner role.
6. **Suspension/capability state**: suspended organizations or disabled capabilities deny before role evaluation.

The policy is cached per-request via `permission_version` — any role/assignment mutation increments the version, invalidating the cache within one request.

## Implementation

- `src/shared/auth/authorization-policy.ts` — decision function
- `src/shared/auth/permission-catalogue.ts` — action/resource definitions
- `src/shared/auth/resolve-permissions.ts` — effective permission resolver
- `src/shared/auth/role-definitions.ts` — built-in role → capability mapping

## Migration path

Each context replaces direct role checks (`if (role === 'owner')`) with `AuthorizationPolicy.authorize()`. Highest-risk surfaces migrate first: identity, property, staff, integration, review, inbox, notification, portal.

## Considered options

- **Per-context role branching.** Current approach — rejected because it's inconsistent, untestable, and misses cross-tenant checks.
- **CASL or OSO.** Deferred — the current permission catalogue is small and stable; a library adds indirection without proportional value at beta scale.
