// Client-side permission hook — reads role from route context and exposes can().
// Components call this instead of receiving canEdit/canCreate props.

import { useRouteContext } from '@tanstack/react-router'
import { can } from '#/shared/domain/permissions'
import type { Permission } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'

export function usePermissions() {
  // Cast to minimal shape — avoids importing AuthRouteContext from routes layer.
  // The authenticated route always provides { role } in context.
  const { role } = useRouteContext({ from: '/_authenticated' }) as { role: Role }

  return {
    role: role as Role,
    can: (permission: Permission) => can(role, permission),
  }
}
