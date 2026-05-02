// Client-side permission hook — reads role from route context and exposes can().
// Components call this instead of receiving canEdit/canCreate props.

import { useRouteContext } from '@tanstack/react-router'
import { can } from '#/shared/domain/permissions'
import type { Permission } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'
import type { AuthRouteContext } from '#/routes/_authenticated'

export function usePermissions() {
  const { role } = useRouteContext({ from: '/_authenticated' }) as AuthRouteContext

  return {
    role: role as Role,
    can: (permission: Permission) => can(role, permission),
  }
}
