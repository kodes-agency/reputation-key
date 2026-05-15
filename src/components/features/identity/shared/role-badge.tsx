/**
 * Shared RoleBadge component — uses unified roleLabel from role-utils.
 */

import type { Role } from '#/shared/domain/roles'
import { Badge } from '#/components/ui/badge'
import { roleLabel } from './role-utils'

/** Render a role as a Badge with variant matching the role level. */
export function RoleBadge({ role }: Readonly<{ role: Role }>) {
  const variant =
    role === 'AccountAdmin'
      ? 'default'
      : role === 'PropertyManager'
        ? 'secondary'
        : 'outline'
  return <Badge variant={variant}>{roleLabel(role)}</Badge>
}
