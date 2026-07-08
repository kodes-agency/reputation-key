// Client-side permission hook — reads role + authz (ClientAuthz) from route context and
// exposes can() + scopeForPermission(). Components call this instead of receiving
// canEdit/canCreate props.
//
// `can` prefers the server-resolved effectivePermissions (correct for custom/multi roles,
// ADR 0001) and falls back to the static role table when authz is empty (e.g. no active org).

import { useRouteContext } from '@tanstack/react-router'
import { can } from '#/shared/domain/permissions'
import type { Permission } from '#/shared/domain/permissions'
import type { DataScope } from '#/shared/domain/data-scope'
import type { Role } from '#/shared/domain/roles'
import type { ClientAuthz } from '#/shared/domain/auth-context'
import { EMPTY_CLIENT_AUTHZ } from '#/shared/domain/auth-context'

type RouteCtx = { role: Role; authz: ClientAuthz }

export function usePermissions() {
  // Cast to minimal shape — avoids importing AuthRouteContext from the routes layer.
  // The authenticated route always provides { role, authz } in context.
  const { role, authz } = useRouteContext({ from: '/_authenticated' }) as RouteCtx
  const effective = authz ?? EMPTY_CLIENT_AUTHZ

  return {
    role: role as Role,
    can: (permission: Permission) =>
      effective.effectivePermissions.length > 0
        ? effective.effectivePermissions.includes(permission)
        : can(role, permission),
    scopeForPermission: (permission: Permission): DataScope =>
      effective.scopeByPermission[permission] ?? 'none',
  }
}
