/**
 * Shared RoleBadge component — uses unified roleLabel from role-utils.
 */

import type { Role } from '#/shared/domain/roles'
import { Badge } from '#/components/ui/badge'
import { roleLabel } from './role-utils'

/** Render a role as a Badge with variant matching the role level. */
export function RoleBadge({
  role,
  rawRole,
}: Readonly<{ role: Role | null; rawRole: string }>) {
  // Custom-only / multi-role members have no built-in Role — show the raw string.
  if (role === null) {
    return <Badge variant="outline">{rawRole || 'Custom'}</Badge>
  }
  const variant =
    role === 'AccountAdmin'
      ? 'default'
      : role === 'PropertyManager'
        ? 'secondary'
        : 'outline'
  return <Badge variant={variant}>{roleLabel(role)}</Badge>
}
