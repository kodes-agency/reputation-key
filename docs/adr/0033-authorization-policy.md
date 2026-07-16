---
status: accepted
---

# 0033 — Authorization policy

Identity owns action/resource/property-scope decisions and owner invariants through a stable authorization policy. Contexts do not infer permission from role strings or branch on `role === 'owner'`.

## Decision

Authorization is a single decision path (BQR-4.1 production seam):

```text
requireAuthorized({ actor, action, capability?, propertyId?, assignedPropertyIds? })
  → checkBetaCapability(capability)
  → canForContext(actor, action)
  → optional property-scope check
```

- **Server functions** call `requireAuthorized` (throws serializable `AuthError` / 403).
- **Unit / pure paths** may call `authorize` / `checkAuthorization` directly.
- **Capability** defaults from `capabilityForPermission(action)` when omitted.

Invariants enforced:

1. **Organization membership**: actor must belong to the same organization as the resource (repository tenant filters + auth context).
2. **Property scope**: when `propertyId` + `assignedPropertyIds` are provided, assigned-scope roles must include the property.
3. **Built-in / custom roles**: `canForContext` uses effective permissions; custom roles require policy resolution.
4. **Last-owner protection**: last owner cannot be removed or demoted (identity use cases).
5. **Sensitive operations**: role-change, property-delete, connection-disconnect require elevated permissions.
6. **Suspension / capability state**: suspended orgs or disabled/blocked capabilities deny before role evaluation.
7. **Dark contexts**: non-core capabilities fail closed unless allowlisted (BQR-0).

## Implementation

- `src/shared/auth/authorization-policy.ts` — `authorize`, `requireAuthorized`, `capabilityForPermission`
- `src/shared/auth/beta-capabilities.ts` — capability layer
- `src/shared/domain/permissions.ts` — permission catalogue + `canForContext`
- `src/shared/architecture/authorize-server-boundary.test.ts` — locks server-side seam usage

## Migration path

BQR-4.1 migrated server entry points from bare `canForContext` to `requireAuthorized`. Use cases may re-assert for defense-in-depth; the **server boundary is authoritative** for interactive paths.

## Considered options

- **Per-context role branching.** Rejected — inconsistent and misses capability gates.
- **CASL or OSO.** Deferred — catalogue is small and stable at beta scale.
