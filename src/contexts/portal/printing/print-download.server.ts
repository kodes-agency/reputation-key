import type { AuthContext } from '#/shared/domain/auth-context'
import {
  portalMediaAssetId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import { isServablePortalMediaAsset } from '../domain/portal-media-asset'
import { portalError } from '../domain/errors'
import type { PortalPrintKitContext } from '../application/portal-print-kit-context'
import type { PortalMediaAssetRepository } from '../application/ports/portal-media-asset.repository'
import {
  StoredObjectTooLargeError,
  type StoragePort,
} from '../application/ports/storage.port'
import type { RevealPortalAddress } from '../application/use-cases/reveal-portal-address'
import type {
  PrintKitPhoto,
  PortalPrintKitFile,
  PortalPrintKitDownload,
} from './contracts'

type PrintDownloadDeps = Readonly<{
  mediaRepo: Pick<PortalMediaAssetRepository, 'findById'>
  objectStore: Pick<StoragePort, 'getObject'>
  sha256Hex: (bytes: Uint8Array) => string
  revealAddress: RevealPortalAddress
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
  deps: Pick<PrintDownloadDeps, 'mediaRepo' | 'objectStore' | 'sha256Hex'>,
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

type PrintKitLook = PortalPrintKitContext['look']

/**
 * The print's pictures, read from Portal media, then the code's address through
 * the audited reveal: in that order, so a picture that cannot be read costs no
 * disclosure.
 */
export async function readPicturesThenReveal(
  deps: PrintDownloadDeps,
  look: Pick<PrintKitLook, 'hero' | 'logo'>,
  scope: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  ctx: AuthContext,
  input: Readonly<{ portalId: string }>,
): Promise<
  Readonly<{ photo: PrintKitPhoto | null; logo: Uint8Array | null; qrAddress: string }>
> {
  const { hero, logo } = look
  const photoBytes = hero ? await readStoredImage(deps, scope, hero.assetId) : null
  const logoBytes = logo ? await readStoredImage(deps, scope, logo.assetId) : null
  const revealed = await deps.revealAddress(
    { portalId: input.portalId, purpose: 'download' },
    ctx,
  )
  return {
    photo:
      hero && photoBytes
        ? { bytes: photoBytes, focalX: hero.focalX, focalY: hero.focalY }
        : null,
    logo: logoBytes,
    qrAddress: revealed.publicUrl,
  }
}
