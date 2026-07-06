// Permission catalogue — the single runtime source of truth for which permission
// strings exist, derived from `statement` (shared/auth/permissions.ts).
//
// The `Permission` type union (shared/domain/permissions.ts) is maintained by hand
// and can drift from `statement`. This module derives the canonical set FROM
// `statement` so the resolver (Stage 2 step 3) and the app-owned role services
// (step 7) validate permission strings against the real catalogue instead of
// trusting unvalidated DB/user input or `as Permission` casts.
//
// Fail-soft: corrupt or unknown input is logged and dropped, never thrown — a bad
// role definition degrades to fewer (or zero) permissions rather than 500ing a
// request or blocking resolution.

import { statement } from './permissions'
import type { Permission } from '#/shared/domain/permissions'
import { getLogger } from '#/shared/observability/logger'

// Flatten `statement` ({ resource: action[] }) into the canonical `resource.action`
// set. Actions may themselves contain dots (e.g. identity.password.change), so the
// join is always exactly one `${resource}.${action}` — never split on '.'.
const VALID_PERMISSION_SET: ReadonlySet<string> = new Set(
  Object.entries(statement).flatMap(([resource, actions]) =>
    actions.map((action) => `${resource}.${action}`),
  ),
)

/** Every permission the application recognises, derived from `statement`. */
export const VALID_PERMISSIONS: readonly Permission[] = [
  ...VALID_PERMISSION_SET,
] as Permission[]

/** Runtime type guard — a string is a real Permission iff `statement` defines it. */
export function isPermission(value: string): value is Permission {
  return VALID_PERMISSION_SET.has(value)
}

/**
 * Parse a role's permission statement (Better Auth's `organizationRole.permission`
 * column) into a validated `Permission[]`.
 *
 * Stored shape: JSON text of `{ resource: string[] }` (the same shape as `statement`,
 * usually a subset). Unknown resources/actions are dropped with a warn log; corrupt
 * JSON / non-object / null all return `[]`. Never throws.
 */
export function parsePermissionStatement(
  raw: string | null | undefined,
): readonly Permission[] {
  if (!raw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    getLogger().warn(
      { raw },
      'permission_catalogue: organizationRole.permission is not valid JSON; treating as no permissions',
    )
    return []
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    getLogger().warn(
      { raw },
      'permission_catalogue: organizationRole.permission is not a record; treating as no permissions',
    )
    return []
  }

  const result: Permission[] = []
  for (const [resource, actions] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(actions)) continue
    for (const action of actions) {
      if (typeof action !== 'string') continue
      const candidate = `${resource}.${action}`
      if (isPermission(candidate)) {
        result.push(candidate)
      } else {
        getLogger().warn(
          { permission: candidate },
          'permission_catalogue: unknown permission in role statement; dropping',
        )
      }
    }
  }
  return result
}
