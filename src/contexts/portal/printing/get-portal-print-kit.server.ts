// Reads the live print context, last print and saved wording without disclosing an address.

import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import type { PortalLastPrintRepository } from './portal-last-print-repository.port.server'
import type { PortalPrintWordingRepository } from './portal-print-wording-repository.port.server'
import type { PortalMediaAssetRepository } from '../media/portal-media-asset-repository.port.server'
import type { PortalPublicationRepository } from '../publication/portal-publication-repository.port.server'
import type { PortalRepository } from '../publication/portal-repository.port.server'
import { loadPortalOrThrow } from '../publication/load-accessible-portal.server'
import { loadPortalPrintKitContext } from './load-portal-print-kit-context.server'
import {
  presentPortalPrintKit,
  type PortalPrintKitLastPrint,
  type PortalPrintKitView,
} from './portal-print-kit-context.server'
import { presentLastPrint } from './portal-print-kit-last-print.server'

export type GetPortalPrintKitDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  publicationRepo: Pick<
    PortalPublicationRepository,
    'loadWorkingCopy' | 'findActiveForPortal'
  >
  /** The Portal's last print, and the photo it names, for the kit's Last printed. */
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
