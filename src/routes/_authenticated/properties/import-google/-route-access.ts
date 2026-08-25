import { redirect } from '@tanstack/react-router'
import { can } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'

/** Keep the index and resumable-import detail routes on the same role boundary. */
export function requireGoogleImportRole(role: Role): void {
  if (!can(role, 'property.import_gbp_v2')) {
    throw redirect({ to: '/properties' })
  }
}
