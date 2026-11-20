// Delegates to staff context's public API to resolve assigned portals.
// Per ADR-0007: dashboard facade ports are implemented by adapters that
// delegate to other contexts' public APIs.

import type { StaffPortalResolverPort } from './staff-portal-resolver.port.server'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'

export const createStaffPortalResolverAdapter =
  (peopleApi: StaffPublicApi): StaffPortalResolverPort =>
  (input, ctx) =>
    peopleApi.getAssignedPortals(input, ctx)
