// Portal context — the print kit read (round 4, slice 45).
//
// What the Share tab's preview draws: the Portal's title in each language, the
// languages it offers, and the Property's look, as the live version has them. It carries no address (the
// preview draws a placeholder code), so reading it discloses nothing and needs
// only `portal.read`, like the editor's other reads. The PDF itself is
// `createPortalPrintKit`, which does disclose.

import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { PortalRepository } from '../ports/portal.repository'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { loadPortalPrintKitContext } from '../load-portal-print-kit-context'
import {
  presentPortalPrintKit,
  type PortalPrintKitView,
} from '../portal-print-kit-context'

export type GetPortalPrintKitDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  publicationRepo: Pick<
    PortalPublicationRepository,
    'loadWorkingCopy' | 'findActiveForPortal'
  >
}>

export const getPortalPrintKit =
  (deps: GetPortalPrintKitDeps) =>
  async (
    input: Readonly<{ portalId: string }>,
    ctx: AuthContext,
  ): Promise<PortalPrintKitView> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.read',
      forbiddenMessage: 'Insufficient permissions to read this Portal',
    })
    const context = await loadPortalPrintKitContext(deps, {
      organizationId: ctx.organizationId,
      portal,
    })
    return presentPortalPrintKit(portal.id, context)
  }

export type GetPortalPrintKit = ReturnType<typeof getPortalPrintKit>
