import type { AuthContext } from './auth-context'
import { sha256Hex } from './sha256'

type AuthorizationVector = Readonly<Record<string, string | number | boolean | null>>

export function googleAuthorizationPermissionDigest(actor: AuthContext): string {
  const permissions = [...(actor.effectivePermissions ?? [])].sort((left, right) =>
    left.localeCompare(right),
  )
  const scopes = [...(actor.scopeByPermission ?? new Map())]
    .map(([permission, scope]) => [permission, scope] as const)
    .sort(([left], [right]) => left.localeCompare(right))
  return sha256Hex(JSON.stringify({ permissions, scopes }))
}

export function sameGoogleContentAuthorizationVector(
  left: AuthorizationVector,
  right: AuthorizationVector,
): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
  )
}

/**
 * Compares a vector FROZEN at approval time against one recomputed later, at
 * effect time. Identical to `sameGoogleContentAuthorizationVector` — same
 * strict key-set equality, same per-key equality — except that
 * `googleContentPolicyVersion` is excluded on both sides.
 *
 * That key is the only one in the vector that is not a fact about *this*
 * authorization. It is the global `policy_version.version` counter
 * (`policy-version-sql.ts`), whose documented purpose is snapshot cache
 * invalidation: every policy-table mutation anywhere in the deployment bumps
 * that single global row in the same statement, so the persisted policy store
 * knows its snapshot is stale. It is a cache generation, not an authorization
 * epoch — and the design already has a dedicated authorization epoch,
 * `emergencyKillVersion`, a separate counter on the same row that only the
 * kill-switch paths bump and that stays compared here.
 *
 * Why excluding it takes nothing away. A delayed effect's authorization is
 * re-proved from scratch on every attempt, so every dimension whose mutation
 * bumps that global counter is already caught, precisely and freshly:
 *
 * | mutation (bumps the global counter)      | caught by                                              |
 * | ---------------------------------------- | ------------------------------------------------------ |
 * | org suspended                            | `policyAuthorizes` re-queries `organization_policy`    |
 * | property suspended                       | `policyAuthorizes` re-queries `property_policy`        |
 * | org capability granted/revoked           | `policyAuthorizes` re-queries `organization_capability`|
 * | property capability granted/revoked      | `policyAuthorizes` re-queries `property_capability`    |
 * | capability denied / emergency kill       | `control.denied`, `emergencyKillVersion` (still compared) |
 * | consent recorded/revoked                 | `hasActiveConsent`, a live read on every `decide()`    |
 * | property access grant added/removed      | `hasActivePropertyGrant` + `role`/`permissionDigest`   |
 * | approval binding replaced                | `approvalBindingId`, compared separately               |
 * | org cohort changed                       | not an authorization input anywhere                    |
 *
 * So the counter can only ever report that *somebody else* changed *something
 * else*. Keeping it in this comparison made any concurrent policy write cancel
 * an in-flight delayed effect as `authorization_changed` — including a write
 * the effect's own sibling item performed. That is the sibling-epoch
 * invalidation this exclusion fixes; the fresh re-proof above is what makes it
 * safe rather than merely narrower.
 */
export function sameFrozenGoogleContentAuthorizationVector(
  frozen: AuthorizationVector,
  recomputed: AuthorizationVector,
): boolean {
  const { googleContentPolicyVersion: _frozenGeneration, ...frozenFacts } = frozen
  const { googleContentPolicyVersion: _recomputedGeneration, ...recomputedFacts } =
    recomputed
  return sameGoogleContentAuthorizationVector(frozenFacts, recomputedFacts)
}
