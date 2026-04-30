// Portal context — get portal use case

import type { PortalRepository } from '../ports/portal.repository'
import type { Portal } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { portalId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type GetPortalDeps = Readonly<{
  portalRepo: PortalRepository
}>

export const getPortal =
  (deps: GetPortalDeps) =>
  async (input: { portalId: string }, ctx: AuthContext): Promise<Portal> => {
    const pid = portalId(input.portalId)
    const portal = await deps.portalRepo.findById(ctx.organizationId, pid)
    if (!portal) {
      throw portalError('portal_not_found', 'portal not found in this organization')
    }
    return portal
  }

// fallow-ignore-next-line unused-type
export type GetPortal = ReturnType<typeof getPortal>
