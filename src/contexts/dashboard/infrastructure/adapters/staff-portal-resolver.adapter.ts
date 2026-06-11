// Dashboard context — staff portal resolver adapter
// Delegates to staff context's public API to resolve assigned portals.
// Per ADR-0007: dashboard facade ports are implemented by adapters that
// delegate to other contexts' public APIs.

import type { StaffPortalResolverPort } from '../../application/ports/staff-portal-resolver.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'

export function createStaffPortalResolverAdapter(
  staffPublicApi: StaffPublicApi,
): StaffPortalResolverPort {
  return (input, ctx) => staffPublicApi.getAssignedPortals(input, ctx)
}
