import type { AuthContext } from './auth-context'
import { sha256Hex } from './sha256'

type AuthorizationVector = Readonly<Record<string, string | number | boolean | null>>

/** Version of the cross-layer authorization vector contract. */
export const GOOGLE_CONTENT_EXECUTION_POLICY_VERSION = 'beta-local-2' as const

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
 * Keys a CROSS-TIME (frozen → recomputed) comparison must ignore. Exported so
 * the comparison and the deny-site drift report below can never disagree about
 * what is being ignored: a log that blamed an excluded key would send the next
 * investigation exactly where this one already went.
 */
export const FROZEN_VECTOR_EXCLUDED_KEYS = [
  'googleContentPolicyVersion',
  'credentialGeneration',
] as const

function withoutExcludedKeys(vector: AuthorizationVector): AuthorizationVector {
  const kept: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(vector)) {
    if ((FROZEN_VECTOR_EXCLUDED_KEYS as readonly string[]).includes(key)) continue
    kept[key] = value
  }
  return kept
}

/**
 * Compares a vector FROZEN at approval time against one recomputed later, at
 * effect time. Identical to `sameGoogleContentAuthorizationVector` — same
 * strict key-set equality, same per-key equality — except that the two keys in
 * `FROZEN_VECTOR_EXCLUDED_KEYS` are dropped from both sides.
 *
 * ── `googleContentPolicyVersion` ────────────────────────────────────────────
 * That key is not a fact about *this* authorization. It is the global
 * `policy_version.version` counter (`policy-version-sql.ts`), whose documented
 * purpose is snapshot cache invalidation: every policy-table mutation anywhere
 * in the deployment bumps that single global row in the same statement, so the
 * persisted policy store knows its snapshot is stale. It is a cache generation,
 * not an authorization epoch — and the design already has a dedicated
 * authorization epoch, `emergencyKillVersion`, a separate counter on the same
 * row that only the kill-switch paths bump and that stays compared here.
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
 * | routine Google token refresh             | see `credentialGeneration` below                       |
 *
 * So the counter can only ever report that *somebody else* changed *something
 * else*. Keeping it in this comparison made any concurrent policy write cancel
 * an in-flight delayed effect as `authorization_changed` — including a write
 * the effect's own sibling item performed. That is the sibling-epoch
 * invalidation this exclusion fixes; the fresh re-proof above is what makes it
 * safe rather than merely narrower.
 *
 * ── `credentialGeneration` ──────────────────────────────────────────────────
 * Same shape of bug, different counter. `credentialGeneration` is the SECRET
 * MATERIAL generation: `updateTokens` bumps it — and only it — on a routine
 * expired-access-token refresh
 * (`google-connection.repository.ts`, `credential_generation + 1`), while the
 * revocation epochs `lifecycleVersion` and `accessVersion` stay put. Only
 * disconnect, reconnect and status transitions move those.
 *
 * So a token that expired between approval and effect — a background
 * certainty, not an anomaly, for any delayed import — cancelled the effect as
 * `authorization_changed`, reporting revocation for a successful refresh. The
 * project already made exactly this exclusion for the same reason on the
 * performance path: the lease fence digest deliberately omits
 * `credentialGeneration` ("a routine token refresh moves the credential
 * generation only", `get-property-google-performance.ts`), pinned by
 * `authorization-lease.test.ts` ("renews across a routine credential-generation
 * bump").
 *
 * Nothing is given up here either, because credential trust is re-proved on
 * every attempt by three live checks the frozen vector does not own:
 * `connectionIsUsable` (status/credentialUseState/scopes/visibility),
 * `sameExpectedConnection` (exact `lifecycleVersion`/`accessVersion`, and
 * `credentialGeneration` monotonic — a REGRESSION still denies), and the live
 * `getAccessToken` that must actually mint a usable token.
 */
export function sameFrozenGoogleContentAuthorizationVector(
  frozen: AuthorizationVector,
  recomputed: AuthorizationVector,
): boolean {
  return sameGoogleContentAuthorizationVector(
    withoutExcludedKeys(frozen),
    withoutExcludedKeys(recomputed),
  )
}

export type FrozenVectorDriftEntry = Readonly<{
  key: string
  frozen: string | number | boolean | null | undefined
  recomputed: string | number | boolean | null | undefined
}>

/**
 * The keys that made `sameFrozenGoogleContentAuthorizationVector` return false,
 * for the deny log at the call site. Shares the exclusion list with the
 * comparison, so it reports exactly the keys that can actually cause a denial.
 */
export function frozenVectorDrift(
  frozen: AuthorizationVector,
  recomputed: AuthorizationVector,
): ReadonlyArray<FrozenVectorDriftEntry> {
  const keys = [...new Set([...Object.keys(frozen), ...Object.keys(recomputed)])].sort()
  return keys
    .filter((key) => !(FROZEN_VECTOR_EXCLUDED_KEYS as readonly string[]).includes(key))
    .filter((key) => frozen[key] !== recomputed[key])
    .map((key) => ({ key, frozen: frozen[key], recomputed: recomputed[key] }))
}

/**
 * Every differing key, the two `FROZEN_VECTOR_EXCLUDED_KEYS` included.
 *
 * For call sites that compare with `sameGoogleContentAuthorizationVector` (all
 * keys, exactly). Reporting such a site with `frozenVectorDrift` logged
 * `drift: []` for a real denial, because the difference was in a key the report
 * excluded — it cost an investigation exactly the answer the log existed to
 * give. A drift report must always mirror the comparison it explains.
 */
export function exactVectorDrift(
  left: AuthorizationVector,
  right: AuthorizationVector,
): ReadonlyArray<FrozenVectorDriftEntry> {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
  return keys
    .filter((key) => left[key] !== right[key])
    .map((key) => ({ key, frozen: left[key], recomputed: right[key] }))
}
