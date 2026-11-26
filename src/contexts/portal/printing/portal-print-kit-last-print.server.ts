// Portal context — the Portal's last print, as the print kit read gives it
// (design spec §11, slice 12): what was printed and when, and whether the
// photo the print would use now is the one it used then. The photo is judged by
// image and framing; the day it changed is when the image that prints now was
// uploaded, when that was after the print.

import { portalMediaAssetId, type OrganizationId } from '#/shared/domain/ids'
import { printPhotoChange } from '#/shared/domain/portal-print-last'
import type { PortalMediaAssetRepository } from '../media/portal-media-asset-repository.port.server'
import type { PortalLastPrint } from './portal-last-print-repository.port.server'
import type {
  PortalPrintKitContext,
  PortalPrintKitLastPrint,
} from './portal-print-kit-context.server'

export type PrintKitLastPrintDeps = Readonly<{
  mediaRepo: Pick<PortalMediaAssetRepository, 'findById'>
}>

export async function presentLastPrint(
  deps: PrintKitLastPrintDeps,
  organizationId: OrganizationId,
  context: PortalPrintKitContext,
  last: PortalLastPrint,
): Promise<PortalPrintKitLastPrint> {
  // The photo a print made now would use: the live look's, by image and framing.
  const photo = context.look.hero
  // The image's own upload day is read only when it could be the answer.
  const asset =
    photo === null || last.settings.look !== 'immersive'
      ? null
      : await deps.mediaRepo.findById(organizationId, portalMediaAssetId(photo.assetId))
  return {
    printedAt: last.printedAt.toISOString(),
    settings: last.settings,
    photo: printPhotoChange({
      last: { look: last.settings.look, photo: last.photo, printedAt: last.printedAt },
      current: { photo, addedAt: asset?.createdAt ?? null },
    }),
  }
}
