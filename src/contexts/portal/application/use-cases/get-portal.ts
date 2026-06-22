// Portal context — get portal use case

import type { PortalRepository } from '../ports/portal.repository'
import type { Portal } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { portalId } from '#/shared/domain/ids'
import { can } from '#/shared/domain/permissions'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'

// fallow-ignore-next-line unused-type
export type GetPortalInput = Readonly<{
  portalId: string
}>

// fallow-ignore-next-line unused-type
export type GetPortalDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
}>

export const getPortal =
  (deps: GetPortalDeps) =>
  async (input: GetPortalInput, ctx: AuthContext): Promise<Portal> => {
    if (!can(ctx.role, 'portal.read')) {
      throw portalError('forbidden', 'Insufficient permissions to view portal')
    }
    const pid = portalId(input.portalId)
    const portal = await deps.portalRepo.findById(ctx.organizationId, pid)
    if (!portal) {
      throw portalError('portal_not_found', 'portal not found in this organization')
    }
    // D6-001: verify caller's staff_assignment includes this portal's property
    await assertPropertyAccess(deps.staffPublicApi, ctx, portal.propertyId)
    return portal
  }

// fallow-ignore-next-line unused-type
export type GetPortal = ReturnType<typeof getPortal>
