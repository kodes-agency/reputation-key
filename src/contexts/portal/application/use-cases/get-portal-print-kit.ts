// Portal context — the print kit read (round 4, slice 45).
//
// What the Share tab's preview draws: the Portal's title in each language, the
// languages it offers, and the Property's look, as the live version has them. It carries no address (the
// preview draws a placeholder code), so reading it discloses nothing and needs
// only `portal.read`, like the editor's other reads. The PDF itself is
// `createPortalPrintKit`, which does disclose. It also says which kit the Share
// tab shows: today's, or the final kit where the server has it turned on, and
// for the final kit what the Portal's last print was (choices and a day, and
// whether the photo has changed since: never an address or a code) and the
// wording the manager saved for Share to open on.

import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalLastPrintRepository } from '../ports/portal-last-print.repository'
import type { PortalPrintWordingRepository } from '../ports/portal-print-wording.repository'
import type { PortalMediaAssetRepository } from '../ports/portal-media-asset.repository'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { PortalRepository } from '../ports/portal.repository'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { loadPortalPrintKitContext } from '../load-portal-print-kit-context'
import {
  presentPortalPrintKit,
  type PortalPrintKitLastPrint,
  type PortalPrintKitView,
} from '../portal-print-kit-context'
import { presentLastPrint } from '../portal-print-kit-last-print'

export type GetPortalPrintKitDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  publicationRepo: Pick<
    PortalPublicationRepository,
    'loadWorkingCopy' | 'findActiveForPortal'
  >
  /** The Portal's last final print, and the photo it names, for the final kit's Last printed. */
  lastPrintRepo: Pick<PortalLastPrintRepository, 'find'>
  /** The wording the Portal saved, which Share opens on. */
  wordingRepo: Pick<PortalPrintWordingRepository, 'find'>
  mediaRepo: Pick<PortalMediaAssetRepository, 'findById'>
  /** PRINT_KIT_FINAL_ENABLED: the Share tab shows the final kit instead of today's. */
  finalKitEnabled: boolean
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
    if (!deps.finalKitEnabled) return presentPortalPrintKit(portal.id, context, 'current')
    const [last, savedWording] = await Promise.all([
      deps.lastPrintRepo.find(ctx.organizationId, portal.id),
      deps.wordingRepo.find(ctx.organizationId, portal.id),
    ])
    const lastPrint: PortalPrintKitLastPrint | null =
      last === null
        ? null
        : await presentLastPrint(deps, ctx.organizationId, context, last)
    return presentPortalPrintKit(portal.id, context, 'final', lastPrint, savedWording)
  }

export type GetPortalPrintKit = ReturnType<typeof getPortalPrintKit>
