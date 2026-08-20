// Portal context — get portal use case

import type { PortalRepository } from '../ports/portal.repository'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import type { Portal } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { portalId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'

export type GetPortalInput = Readonly<{
  portalId: string
}>

/**
 * PB2.1 / ADR 0044: whether the portal currently has a reachable public token,
 * plus the metadata the Share tab needs to label it. Existence only — never the
 * raw token or its digest, which issue/rotate alone return. Without this the
 * client cannot know a live token exists after a reload and so cannot offer
 * rotate/revoke, the only mitigations for a leaked opaque token.
 */
export type PortalTokenStatus = Readonly<{
  hasActiveToken: boolean
  version: number | null
  issuedAt: string | null
  graceExpiresAt: string | null
}>

export type GetPortalResult = Readonly<{
  portal: Portal
  tokenStatus: PortalTokenStatus
}>

const NO_ACTIVE_TOKEN: PortalTokenStatus = {
  hasActiveToken: false,
  version: null,
  issuedAt: null,
  graceExpiresAt: null,
}

export type GetPortalDeps = Readonly<{
  portalRepo: PortalRepository
  portalTokenRepo: Pick<PortalTokenRepository, 'findResolvableSummaryForPortal'>
  staffPublicApi: StaffPublicApi
  clock: () => Date
}>

export const getPortal =
  (deps: GetPortalDeps) =>
  async (input: GetPortalInput, ctx: AuthContext): Promise<GetPortalResult> => {
    if (!canForContext(ctx, 'portal.read')) {
      throw portalError('forbidden', 'Insufficient permissions to view portal')
    }
    const pid = portalId(input.portalId)
    const portal = await deps.portalRepo.findById(ctx.organizationId, pid)
    if (!portal) {
      throw portalError('portal_not_found', 'portal not found in this organization')
    }
    // D6-001: verify caller's staff_assignment includes this portal's property
    await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.read', portal.propertyId)

    const token = await deps.portalTokenRepo.findResolvableSummaryForPortal(
      ctx.organizationId,
      pid,
      deps.clock(),
    )
    return {
      portal,
      tokenStatus: token
        ? {
            hasActiveToken: true,
            version: token.version,
            issuedAt: token.issuedAt.toISOString(),
            graceExpiresAt: token.gracePeriodEnds?.toISOString() ?? null,
          }
        : NO_ACTIVE_TOKEN,
    }
  }

export type GetPortal = ReturnType<typeof getPortal>
