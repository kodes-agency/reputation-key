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
