// Portal context — the final print kit's PDF (final design spec §11, slice 7).
//
// The download behind the final Print cards section, which the Share tab shows
// only where PRINT_KIT_FINAL_ENABLED is on; today's `createPortalPrintKit` is
// untouched. It puts the code's address into a file, so the order is the same:
//
//   1. authorise, and load the Portal and what is live on it;
//   2. refuse, before anything is read or revealed: the final kit where the
//      server has it off, languages the live version does not offer, and a
//      choice the kit does not make (a quantity or a count a sheet out of range,
//      a tent for a print shop);
//   3. read the pictures from Portal media, checked against their stored hash;
//   4. fetch the address through `revealPortalAddress`, which records the
//      disclosure (as a download) before it decrypts;
//   5. draw. The renderer refuses a piece whose code would print too small (a
//      tent or Small card on today's long address), or whose two cues would not
//      fit its bar, and the refusal is turned into words here.
//
// From the manager's own printer the pieces go on office sheets, exactly as many
// as asked for; a print shop gets one piece per page. Nothing is fetched by
// address: a picture is read from the store by its asset id.

import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  defaultPrintKitPaper,
  isPrintKitLanguageChoice,
} from '#/shared/domain/portal-print-kit'
import { printAddressShape } from '#/shared/domain/portal-print-address'
import { printFinalRegionOf } from '#/shared/domain/portal-print-final'
import {
  printFinalDocumentTitle,
  printFinalFileName,
} from '#/shared/domain/portal-print-final-how-to'
import { printFinalBlocks } from '#/shared/domain/portal-print-final-languages'
import {
  printFinalChoiceProblem,
  type PrintFinalChoice,
  type PrintFinalRefusal,
} from '#/shared/domain/portal-print-final-offer'
import { PRINT_FINAL_REFUSAL_COPY } from '#/shared/domain/portal-print-final-refusals'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { portalError } from '../../domain/errors'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { loadPortalPrintKitContext } from '../load-portal-print-kit-context'
import type { DownloadPortalPrintFinalInput } from '../dto/portal-print-final.dto'
import type { PortalMediaAssetRepository } from '../ports/portal-media-asset.repository'
import {
  PrintFinalRenderRefusal,
  type PortalPrintFinalRenderer,
  type PrintFinalRenderInput,
} from '../ports/portal-print-final-renderer.port'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { PortalRepository } from '../ports/portal.repository'
import type { StoragePort } from '../ports/storage.port'
import {
  readPicturesThenReveal,
  type PortalPrintKitFile,
} from './create-portal-print-kit'
import type { RevealPortalAddress } from './reveal-portal-address'

export type CreatePortalPrintFinalDeps = Readonly<{
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
  renderer: PortalPrintFinalRenderer
  /** The Property's country (ISO 3166-1 alpha-2), or null: it sets the default paper. */
  propertyCountry: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<string | null>
  /** PRINT_KIT_FINAL_ENABLED: off, every final download is refused. */
  finalKitEnabled: boolean
}>

type Scope = Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>

/** A refusal of the choice or of its code, in the words the Share tab uses too. */
function refusalError(refusal: Pick<PrintFinalRefusal, 'code'>) {
  const code =
    refusal.code === 'needs_short_code' ||
    refusal.code === 'address_host_too_long' ||
    refusal.code === 'tile_does_not_fit'
      ? 'print_code_too_small'
      : 'print_format_not_offered'
  return portalError(code, PRINT_FINAL_REFUSAL_COPY[refusal.code], {
    cause: refusal.code,
  })
}

/** The choice as the offer reads it, on the paper the request named or the country prints on. */
async function choiceOf(
  deps: Pick<CreatePortalPrintFinalDeps, 'propertyCountry'>,
  input: DownloadPortalPrintFinalInput,
  scope: Scope,
): Promise<PrintFinalChoice> {
  const paper =
    input.paper ??
    defaultPrintKitPaper(
      await deps.propertyCountry(scope.organizationId, scope.propertyId),
    )
  return {
    piece: input.piece,
    orientation: input.orientation,
    look: input.look,
    paper,
    printer: input.printer,
    quantity: input.quantity,
    perSheet: input.perSheet,
    languageCount: input.languages.length,
  }
}

/** Draws the print, turning a refusal into a Portal error. */
async function renderOrRefuse(
  renderer: PortalPrintFinalRenderer,
  input: PrintFinalRenderInput,
): Promise<Uint8Array> {
  try {
    return await renderer.render(input)
  } catch (error) {
    if (error instanceof PrintFinalRenderRefusal) throw refusalError(error.refusal)
    throw error
  }
}

export const createPortalPrintFinal =
  (deps: CreatePortalPrintFinalDeps) =>
  async (
    input: DownloadPortalPrintFinalInput,
    ctx: AuthContext,
  ): Promise<PortalPrintKitFile> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to make a print kit',
    })
    if (!deps.finalKitEnabled) {
      throw portalError('print_format_not_offered', 'This print is not available yet.')
    }
    const context = await loadPortalPrintKitContext(deps, {
      organizationId: ctx.organizationId,
      portal,
    })
    if (!isPrintKitLanguageChoice(context.locales, input.languages)) {
      throw portalError('locale_not_offered', 'Choose languages this portal offers')
    }
    const scope = { organizationId: ctx.organizationId, propertyId: portal.propertyId }
    const choice = await choiceOf(deps, input, scope)
    const problem = printFinalChoiceProblem(choice)
    if (problem !== null) throw refusalError(problem)

    const pictures = await readPicturesThenReveal(deps, context.look, scope, ctx, input)

    const print = { ...choice, languages: input.languages }
    const pdf = await renderOrRefuse(deps.renderer, {
      title: printFinalDocumentTitle(context.portalName, choice.piece),
      face: {
        piece: choice.piece,
        orientation: choice.orientation,
        look: choice.look,
        region: printFinalRegionOf(choice.paper),
      },
      blocks: printFinalBlocks(
        input.languages,
        input.callToAction,
        context.titles,
        context.portalName,
      ),
      wordmark: context.look.wordmark,
      logo: pictures.logo,
      accentColour: context.look.accentColour,
      fieldColour: context.look.fieldColour,
      photo: pictures.photo,
      qrAddress: pictures.qrAddress,
      address: printAddressShape(pictures.qrAddress),
      ...(choice.printer === 'my_printer'
        ? {
            sheets: {
              quantity: choice.quantity,
              fillSpares: input.fillSpares ?? false,
              perSheet: choice.perSheet,
            },
          }
        : {}),
    })
    return {
      fileName: printFinalFileName(context.portalName, print),
      contentType: 'application/pdf',
      pdf,
    }
  }

export type CreatePortalPrintFinal = ReturnType<typeof createPortalPrintFinal>
