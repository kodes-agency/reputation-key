// Reads the live print context, last print and saved wording without disclosing an address.

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
    const [last, savedWording] = await Promise.all([
      deps.lastPrintRepo.find(ctx.organizationId, portal.id),
      deps.wordingRepo.find(ctx.organizationId, portal.id),
    ])
    const lastPrint: PortalPrintKitLastPrint | null =
      last === null
        ? null
        : await presentLastPrint(deps, ctx.organizationId, context, last)
    return {
      ...presentPortalPrintKit(portal.id, context, lastPrint, savedWording),
      ...(portal.kind === 'personal' ? { personal: true } : {}),
    }
  }

export type GetPortalPrintKit = ReturnType<typeof getPortalPrintKit>
