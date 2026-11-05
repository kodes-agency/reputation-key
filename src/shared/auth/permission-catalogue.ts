// Permission catalogue — the single runtime source of truth for which permission
// strings exist, derived from `statement` (shared/auth/permissions.ts).
//
// The `Permission` type union (shared/domain/permissions.ts) is maintained by hand
// and can drift from `statement`. This module derives the canonical set FROM
// `statement` so built-in role authority is computed over the real catalogue.

import { statement } from './permissions'
import type { Permission } from '#/shared/domain/permissions'

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
