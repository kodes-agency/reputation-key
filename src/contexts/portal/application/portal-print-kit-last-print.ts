// Portal context — the Portal's last final print, as the print kit read gives it
// (final design spec §11, slice 12): what was printed and when, and whether the
// photo the print would use now is the one it used then. The photo is judged by
// image and framing; the day it changed is when the image that prints now was
// uploaded, when that was after the print.

import { portalMediaAssetId, type OrganizationId } from '#/shared/domain/ids'
import { printFinalPhotoChange } from '#/shared/domain/portal-print-final-last'
import type { PortalMediaAssetRepository } from './ports/portal-media-asset.repository'
import type { PortalLastPrint } from './ports/portal-last-print.repository'
import type {
  PortalPrintKitContext,
  PortalPrintKitLastPrint,
} from './portal-print-kit-context'

export type PrintKitLastPrintDeps = Readonly<{
  mediaRepo: Pick<PortalMediaAssetRepository, 'findById'>
}>

/** The photo a print made now would use: the live look's, by image and framing. */
function currentPhotoOf(look: PortalPrintKitContext['look']) {
  return look.hero === null
    ? null
    : { assetId: look.hero.assetId, focalX: look.hero.focalX, focalY: look.hero.focalY }
}

export async function presentLastPrint(
  deps: PrintKitLastPrintDeps,
  organizationId: OrganizationId,
  context: PortalPrintKitContext,
  last: PortalLastPrint,
): Promise<PortalPrintKitLastPrint> {
  const photo = currentPhotoOf(context.look)
  // The image's own upload day is read only when it could be the answer.
  const asset =
    photo === null || last.settings.look !== 'immersive'
      ? null
      : await deps.mediaRepo.findById(organizationId, portalMediaAssetId(photo.assetId))
  return {
    printedAt: last.printedAt.toISOString(),
    settings: last.settings,
    photo: printFinalPhotoChange({
      last: { look: last.settings.look, photo: last.photo, printedAt: last.printedAt },
      current: { photo, addedAt: asset?.createdAt ?? null },
    }),
  }
}
