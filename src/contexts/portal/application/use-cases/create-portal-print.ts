// Authorizes the print and checks languages, layout and wording before reading
// verified media and revealing the audited address. Only then may the renderer
// draw the PDF; refused renders record neither last-print settings nor wording.

import type { AuthContext } from '#/shared/domain/auth-context'
import { assertPersonalPortalPublicText } from '../../domain/personal-portal-public-text'
import { portalId } from '#/shared/domain/ids'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  defaultPrintKitPaper,
  isPrintKitLanguageChoice,
} from '#/shared/domain/portal-print-kit'
import { printAddressShape } from '#/shared/domain/portal-print-address'
import { printRegionOf } from '#/shared/domain/portal-print'
import { printDocumentTitle, printFileName } from '#/shared/domain/portal-print-how-to'
import { printBlocks } from '#/shared/domain/portal-print-languages'
import {
  printOwnWordsToSend,
  printWordsHeldLanguage,
  type PrintWordsChoice,
} from '#/shared/domain/portal-print-custom'
import {
  printChoiceProblem,
  type PrintChoice,
  type PrintRefusal,
} from '#/shared/domain/portal-print-offer'
import { PRINT_REFUSAL_COPY } from '#/shared/domain/portal-print-refusals'
import { printWordsOffer } from '#/shared/domain/portal-print-warnings'
import { printWordingToSave } from '#/shared/domain/portal-print-wording'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { portalError } from '../../domain/errors'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { loadPortalPrintKitContext } from '../load-portal-print-kit-context'
import type { PortalPrintKitContext } from '../portal-print-kit-context'
import type { Portal } from '../../domain/types'
import {
  rememberLastPrint,
  type RememberLastPrintDeps,
} from '../remember-portal-last-print'
import {
  rememberPrintWording,
  type RememberPrintWordingDeps,
} from '../remember-portal-print-wording'
import type { DownloadPortalPrintInput } from '../dto/portal-print.dto'
import type { PortalMediaAssetRepository } from '../ports/portal-media-asset.repository'
import {
  PrintRenderRefusal,
  type PortalPrintRenderer,
  type PrintRenderInput,
} from '../ports/portal-print-renderer.port'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { PortalRepository } from '../ports/portal.repository'
import type { StoragePort } from '../ports/storage.port'
import { readPicturesThenReveal } from '../../printing/print-download.server'
import type { PortalPrintKitFile } from '../../printing/contracts'
import type { RevealPortalAddress } from './reveal-portal-address'

export type CreatePortalPrintDeps = RememberLastPrintDeps &
  RememberPrintWordingDeps &
  Readonly<{
    portalRepo: PortalRepository
    staffPublicApi: StaffPublicApi
    publicationRepo: Pick<
      PortalPublicationRepository,
      'loadWorkingCopy' | 'loadWorkingCopyWithLook' | 'findActiveForPortal'
    >
    mediaRepo: Pick<PortalMediaAssetRepository, 'findById'>
    objectStore: Pick<StoragePort, 'getObject'>
    sha256Hex: (bytes: Uint8Array) => string
    revealAddress: RevealPortalAddress
    renderer: PortalPrintRenderer
    /** The Property's country (ISO 3166-1 alpha-2), or null: it sets the default paper. */
    propertyCountry: (
      organizationId: OrganizationId,
      propertyId: PropertyId,
    ) => Promise<string | null>
  }>

type Scope = Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>

/** A refusal of the choice or of its code, in the words the Share tab uses too. */
function refusalError(refusal: Pick<PrintRefusal, 'code'>) {
  const code =
    refusal.code === 'needs_short_code' ||
    refusal.code === 'address_host_too_long' ||
    refusal.code === 'tile_does_not_fit'
      ? 'print_code_too_small'
      : 'print_format_not_offered'
  return portalError(code, PRINT_REFUSAL_COPY[refusal.code], {
    cause: refusal.code,
  })
}

/** The choice as the offer reads it, on the paper the request named or the country prints on. */
async function choiceOf(
  deps: Pick<CreatePortalPrintDeps, 'propertyCountry'>,
  input: DownloadPortalPrintInput,
  scope: Scope,
): Promise<PrintChoice> {
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
    backPage: input.backPage ?? false,
  }
}

/**
 * Draws the print, turning a refusal into a Portal error. Words the face cannot
 * hold are the manager's to shorten when they wrote them (`shorten_to_fit`), and
 * the wording's to change when they picked it (`words_do_not_fit`), as Share says.
 */
async function renderOrRefuse(
  renderer: PortalPrintRenderer,
  input: PrintRenderInput,
  ownWords: boolean,
): Promise<Uint8Array> {
  try {
    return await renderer.render(input)
  } catch (error) {
    if (!(error instanceof PrintRenderRefusal)) throw error
    const { refusal } = error
    throw refusalError(
      ownWords && refusal.code === 'words_do_not_fit'
        ? { code: 'shorten_to_fit' }
        : refusal,
    )
  }
}

/** The Property's brand is public already; a wordmark the Portal wrote itself is not. */
async function assertPersonalPrintWordmark(
  deps: CreatePortalPrintDeps,
  ctx: AuthContext,
  portal: Portal,
  context: PortalPrintKitContext,
): Promise<void> {
  const withLook = await deps.publicationRepo.loadWorkingCopyWithLook(
    ctx.organizationId,
    portal.id,
  )
  if (withLook?.lookSources.identity === 'property') return
  if (context.look.wordmark === context.look.propertyName) return
  assertPersonalPortalPublicText(portal, { wordmark: context.look.wordmark })
}

export const createPortalPrint =
  (deps: CreatePortalPrintDeps) =>
  async (
    input: DownloadPortalPrintInput,
    ctx: AuthContext,
  ): Promise<PortalPrintKitFile> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to make a print kit',
    })
    assertPersonalPortalPublicText(portal, input.customWords)
    const context = await loadPortalPrintKitContext(deps, {
      organizationId: ctx.organizationId,
      portal,
    })
    if (portal.kind === 'personal')
      await assertPersonalPrintWordmark(deps, ctx, portal, context)
    if (!isPrintKitLanguageChoice(context.locales, input.languages)) {
      throw portalError('locale_not_offered', 'Choose languages this portal offers')
    }
    const scope = { organizationId: ctx.organizationId, propertyId: portal.propertyId }
    const choice = await choiceOf(deps, input, scope)
    const problem = printChoiceProblem(choice)
    if (problem !== null) throw refusalError(problem)
    const words: PrintWordsChoice = {
      preset: input.callToAction,
      custom: input.customWords ?? null,
    }
    if (printWordsHeldLanguage(words, input.languages) !== null) {
      throw refusalError({ code: 'wording_not_available' })
    }
    // Only a clear offer for the review stops a print (§5.8); every other note only warns.
    if (printWordsOffer(words, input.languages)) {
      throw refusalError({ code: 'remove_offer' })
    }

    const pictures = await readPicturesThenReveal(deps, context.look, scope, ctx, input)

    const cropMarks = input.cropMarks ?? false
    const print = { ...choice, languages: input.languages, cropMarks }
    const pdf = await renderOrRefuse(
      deps.renderer,
      {
        ...(portal.kind === 'personal' ? { personalName: portal.name } : {}),
        title: printDocumentTitle(context.portalName, choice.piece),
        face: {
          piece: choice.piece,
          orientation: choice.orientation,
          look: choice.look,
          region: printRegionOf(choice.paper),
        },
        blocks: printBlocks(input.languages, words, context.titles, context.portalName),
        wordmark: context.look.wordmark,
        logo: pictures.logo,
        accentColour: context.look.accentColour,
        fieldColour: context.look.fieldColour,
        photo: pictures.photo,
        qrAddress: pictures.qrAddress,
        address: printAddressShape(pictures.qrAddress),
        ...(choice.backPage === true
          ? { back: { propertyName: context.look.propertyName } }
          : {}),
        ...(choice.printer === 'my_printer'
          ? {
              sheets: {
                quantity: choice.quantity,
                fillSpares: input.fillSpares ?? false,
                perSheet: choice.perSheet,
              },
            }
          : { shop: { cropMarks } }),
      },
      printOwnWordsToSend(words, input.languages) !== null,
    )
    await rememberLastPrint(deps, {
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      choice,
      input,
      look: context.look,
    })
    // What printed is now what Share opens on, so a manager who downloads need not save too.
    await rememberPrintWording(deps, {
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      wording: printWordingToSave(words, input.languages),
    })
    return {
      fileName: printFileName(
        context.portalName,
        print,
        portal.kind === 'personal' ? portal.name : undefined,
      ),
      contentType: 'application/pdf',
      pdf,
    }
  }
