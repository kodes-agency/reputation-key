// Portal context — the print kit PDF (round 4, slice 45).
//
// Makes the file a manager takes to a print shop: a table tent or a counter
// card, in one or two of the Portal's languages, with one call to action, in
// the Property's look, with the live code on it. It is the only use case that
// puts the code's address into a file, so the order is the point:
//
//   1. authorise, and load the Portal and what is live on it;
//   2. check the languages against the live version's own, so a refusal costs
//      nothing and a language added in the editor but not published is refused;
//   3. read the pictures from Portal media, checked against their stored hash;
//   4. fetch the address through `revealPortalAddress`, which records the
//      disclosure (as a download) before it decrypts, and refuses a code that
//      was not sealed or is no longer live;
//   5. draw.
//
// Nothing is fetched by address: a picture is read from the store by its asset
// id, so a stored URL cannot make the server request anything.

import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId, portalMediaAssetId } from '#/shared/domain/ids'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  isPrintKitLanguageChoice,
  printKitFaces,
  printKitFileName,
  PRINT_KIT_PIECE_FACTS,
  shortPrintAddress,
} from '#/shared/domain/portal-print-kit'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { isServablePortalMediaAsset } from '../../domain/portal-media-asset'
import { portalError } from '../../domain/errors'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { loadPortalPrintKitContext } from '../load-portal-print-kit-context'
import type { DownloadPortalPrintKitInput } from '../dto/portal-print-kit.dto'
import type { PortalMediaAssetRepository } from '../ports/portal-media-asset.repository'
import type { PortalPrintKitRenderer } from '../ports/portal-print-kit-renderer.port'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { PortalRepository } from '../ports/portal.repository'
import { StoredObjectTooLargeError, type StoragePort } from '../ports/storage.port'
import type { RevealPortalAddress } from './reveal-portal-address'

export type CreatePortalPrintKitDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  publicationRepo: Pick<
    PortalPublicationRepository,
    'loadWorkingCopy' | 'findActiveForPortal'
  >
  mediaRepo: Pick<PortalMediaAssetRepository, 'findById'>
  objectStore: Pick<StoragePort, 'getObject'>
  sha256Hex: (bytes: Uint8Array) => string
  revealAddress: RevealPortalAddress
  renderer: PortalPrintKitRenderer
}>

export type PortalPrintKitFile = Readonly<{
  fileName: string
  contentType: 'application/pdf'
  pdf: Uint8Array
}>

/** What the server function answers: a server function speaks JSON, so the file is base64. */
export type PortalPrintKitDownload = Readonly<{
  fileName: string
  contentType: 'application/pdf'
  pdfBase64: string
}>

export const printKitDownloadOf = (file: PortalPrintKitFile): PortalPrintKitDownload => ({
  fileName: file.fileName,
  contentType: file.contentType,
  pdfBase64: Buffer.from(file.pdf).toString('base64'),
})

const photoUnreadable = () =>
  portalError(
    'media_not_found',
    'A picture for this print could not be read. Try again in a moment.',
  )

/**
 * A stored picture's bytes, or null when it may no longer be served (taken down
 * since the working copy was read). A picture whose object is missing, or is
 * not the bytes that were stored, is an error: printing without it would hand
 * the manager a card that is not the one they previewed.
 */
async function readStoredImage(
  deps: Pick<CreatePortalPrintKitDeps, 'mediaRepo' | 'objectStore' | 'sha256Hex'>,
  scope: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  assetId: string,
): Promise<Uint8Array | null> {
  const asset = await deps.mediaRepo.findById(
    scope.organizationId,
    portalMediaAssetId(assetId),
  )
  if (!asset || asset.propertyId !== scope.propertyId) return null
  if (!isServablePortalMediaAsset(asset)) return null
  let object: Awaited<ReturnType<StoragePort['getObject']>>
  try {
    object = await deps.objectStore.getObject(asset.objectKey, asset.byteSize)
  } catch (error) {
    if (error instanceof StoredObjectTooLargeError) throw photoUnreadable()
    throw error
  }
  if (
    !object ||
    object.body.length !== asset.byteSize ||
    deps.sha256Hex(object.body) !== asset.contentSha256
  ) {
    throw photoUnreadable()
  }
  return object.body
}

export const createPortalPrintKit =
  (deps: CreatePortalPrintKitDeps) =>
  async (
    input: DownloadPortalPrintKitInput,
    ctx: AuthContext,
  ): Promise<PortalPrintKitFile> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to make a print kit',
    })
    const context = await loadPortalPrintKitContext(deps, {
      organizationId: ctx.organizationId,
      portal,
    })
    if (!isPrintKitLanguageChoice(context.locales, input.languages)) {
      throw portalError('locale_not_offered', 'Choose languages this portal offers')
    }

    const scope = { organizationId: ctx.organizationId, propertyId: portal.propertyId }
    const { hero, logo } = context.look
    const photoBytes = hero ? await readStoredImage(deps, scope, hero.assetId) : null
    const logoBytes = logo ? await readStoredImage(deps, scope, logo.assetId) : null

    const revealed = await deps.revealAddress(
      { portalId: input.portalId, purpose: 'download' },
      ctx,
    )

    const faces = printKitFaces(
      {
        piece: input.piece,
        languages: input.languages,
        callToAction: input.callToAction,
      },
      context.titles,
      context.portalName,
    )
    const pdf = await deps.renderer.render({
      title: `${context.portalName} ${PRINT_KIT_PIECE_FACTS[input.piece].noun}`,
      piece: input.piece,
      faces,
      wordmark: context.look.wordmark,
      logo: logoBytes,
      photo:
        hero && photoBytes
          ? { bytes: photoBytes, focalX: hero.focalX, focalY: hero.focalY }
          : null,
      accentColour: context.look.accentColour,
      fieldColour: context.look.fieldColour,
      qrAddress: revealed.publicUrl,
      shortAddress: shortPrintAddress(revealed.publicUrl),
    })
    return {
      fileName: printKitFileName(context.portalName, input.piece),
      contentType: 'application/pdf',
      pdf,
    }
  }

export type CreatePortalPrintKit = ReturnType<typeof createPortalPrintKit>
