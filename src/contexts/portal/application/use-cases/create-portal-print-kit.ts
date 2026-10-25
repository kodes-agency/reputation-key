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
//      and the size and output: a size managers may not choose yet, or a print
//      the kit does not make, is refused here too;
//   3. read the pictures from Portal media, checked against their stored hash;
//   4. fetch the address through `revealPortalAddress`, which records the
//      disclosure (as a download) before it decrypts, and refuses a code that
//      was not sealed or is no longer live;
//   5. draw. The renderer refuses a size whose code tile would print the code
//      too small to scan (a long address on Table or Mini), and the refusal is
//      turned into words here. A photo that would print soft is not refused: the
//      renderer reports it and the Share tab warns before the file is asked for.
//
// Nothing is fetched by address: a picture is read from the store by its asset
// id, so a stored URL cannot make the server request anything.

import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId, portalMediaAssetId } from '#/shared/domain/ids'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  defaultPrintKitOutput,
  defaultPrintKitPaper,
  isPrintKitLanguageChoice,
  printKitFaces,
  printKitFileName,
  printKitPieceNoun,
  PRINT_KIT_SELECTABLE_SIZES,
  type PrintKitFormat,
  type PrintKitOutput,
  type PrintKitSize,
} from '#/shared/domain/portal-print-kit'
import { PRINT_CODE_TOO_SMALL_COPY } from '#/shared/domain/portal-print-kit-code-tile'
import { printKitFormatProblem } from '#/shared/domain/portal-print-kit-formats'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { isServablePortalMediaAsset } from '../../domain/portal-media-asset'
import { portalError } from '../../domain/errors'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { loadPortalPrintKitContext } from '../load-portal-print-kit-context'
import type { DownloadPortalPrintKitInput } from '../dto/portal-print-kit.dto'
import type { PortalMediaAssetRepository } from '../ports/portal-media-asset.repository'
import {
  PrintKitRenderRefusal,
  type PortalPrintKitRenderer,
  type PrintKitPhoto,
  type PrintKitRefusal,
} from '../ports/portal-print-kit-renderer.port'
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
  /** The Property's country (ISO 3166-1 alpha-2), or null: it sets the default paper. */
  propertyCountry: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<string | null>
  /** The sizes a manager may choose: `PRINT_KIT_SELECTABLE_SIZES` unless a test reaches for the hidden ones. */
  selectableSizes?: readonly PrintKitSize[]
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

type PrintKitLook = Awaited<ReturnType<typeof loadPortalPrintKitContext>>['look']

/**
 * The print's pictures, read from Portal media, then the code's address through
 * the audited reveal: in that order, so a picture that cannot be read costs no
 * disclosure. Shared by today's print kit and the final one.
 */
export async function readPicturesThenReveal(
  deps: Pick<
    CreatePortalPrintKitDeps,
    'mediaRepo' | 'objectStore' | 'sha256Hex' | 'revealAddress'
  >,
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

type FullFormat = Required<PrintKitFormat>

/**
 * The style and paper a download asked for: the style is Paper unless the request
 * says otherwise (the schema's default), and the paper is the one the Property's
 * country prints on unless the request names one, Letter when the country is
 * unknown (spec 7.1). The country is read only when the paper is not named. The
 * size is the schema's (Large unless named) and the output the style's own
 * unless named.
 */
async function formatOf(
  deps: Pick<CreatePortalPrintKitDeps, 'propertyCountry'>,
  input: DownloadPortalPrintKitInput,
  scope: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
): Promise<FullFormat> {
  const paper =
    input.paper ??
    defaultPrintKitPaper(
      await deps.propertyCountry(scope.organizationId, scope.propertyId),
    )
  return { style: input.style, paper, size: sizeOf(input), output: outputOf(input) }
}

const sizeOf = (input: DownloadPortalPrintKitInput): PrintKitSize => input.size ?? 'large'

const outputOf = (input: DownloadPortalPrintKitInput): PrintKitOutput =>
  input.output ?? defaultPrintKitOutput(input.style)

/**
 * Refuses a size managers may not choose yet, and a print the kit does not make
 * (`printKitFormatProblem`), before anything is read or revealed.
 */
function checkPrintable(
  deps: Pick<CreatePortalPrintKitDeps, 'selectableSizes'>,
  input: DownloadPortalPrintKitInput,
): void {
  const selectable = deps.selectableSizes ?? PRINT_KIT_SELECTABLE_SIZES
  const size = sizeOf(input)
  if (!selectable.includes(size)) {
    throw portalError('print_format_not_offered', 'This size is not available yet.', {
      size,
    })
  }
  const problem = printKitFormatProblem({
    piece: input.piece,
    size,
    style: input.style,
    output: outputOf(input),
    languageCount: input.languages.length,
  })
  if (problem !== null) throw portalError('print_format_not_offered', problem)
}

/** The renderer's refusal, in words a manager can act on. */
function refusalError(refusal: PrintKitRefusal) {
  return portalError('print_code_too_small', PRINT_CODE_TOO_SMALL_COPY[refusal.cause], {
    cause: refusal.cause,
    size: refusal.size,
    moduleMm: refusal.moduleMm,
  })
}

/** Draws the print, turning a refusal into a Portal error. */
async function renderOrRefuse(
  renderer: PortalPrintKitRenderer,
  input: Parameters<PortalPrintKitRenderer['render']>[0],
): Promise<Uint8Array> {
  try {
    return await renderer.render(input)
  } catch (error) {
    if (error instanceof PrintKitRenderRefusal) {
      throw refusalError(error.refusal)
    }
    throw error
  }
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
    checkPrintable(deps, input)

    const scope = { organizationId: ctx.organizationId, propertyId: portal.propertyId }
    const format = await formatOf(deps, input, scope)
    const pictures = await readPicturesThenReveal(deps, context.look, scope, ctx, input)

    const faces = printKitFaces(
      {
        piece: input.piece,
        languages: input.languages,
        callToAction: input.callToAction,
      },
      context.titles,
      context.portalName,
    )
    const pdf = await renderOrRefuse(deps.renderer, {
      title: `${context.portalName} ${printKitPieceNoun(input.piece, format.size)}`,
      piece: input.piece,
      ...format,
      faces,
      wordmark: context.look.wordmark,
      propertyName: input.showPropertyName === false ? null : context.look.propertyName,
      logo: pictures.logo,
      photo: pictures.photo,
      accentColour: context.look.accentColour,
      fieldColour: context.look.fieldColour,
      qrAddress: pictures.qrAddress,
    })
    return {
      fileName: printKitFileName(
        context.portalName,
        input.piece,
        input.languages,
        format,
      ),
      contentType: 'application/pdf',
      pdf,
    }
  }

export type CreatePortalPrintKit = ReturnType<typeof createPortalPrintKit>
