// Portal context — remembers a final print as the Portal's last (final design
// spec §11, slice 12), once its file is made. The memory is a convenience for the
// next visit to Share, so a manager who has the file is never refused it because
// the memory could not be written: the failure is logged and the print stands.

import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { printFinalOwnWordsToSend } from '#/shared/domain/portal-print-final-custom'
import type { PrintFinalLastSettings } from '#/shared/domain/portal-print-final-last'
import type { PrintFinalChoice } from '#/shared/domain/portal-print-final-offer'
import type { DownloadPortalPrintFinalInput } from './dto/portal-print-final.dto'
import type { PortalPrintKitContext } from './portal-print-kit-context'
import type { PortalLastPrintRepository } from './ports/portal-last-print.repository'

export type RememberLastPrintDeps = Readonly<{
  lastPrintRepo: Pick<PortalLastPrintRepository, 'record'>
  clock: () => Date
  logger: Pick<LoggerPort, 'warn'>
}>

/**
 * The choices as the download took them: the paper the file was made for, and
 * the spares, crop marks and back page as asked, a print shop's file ignoring
 * the ones that mean nothing to it.
 */
function settingsOf(
  choice: PrintFinalChoice,
  input: DownloadPortalPrintFinalInput,
): PrintFinalLastSettings {
  return {
    piece: choice.piece,
    orientation: choice.orientation,
    look: choice.look,
    paper: choice.paper,
    printer: choice.printer,
    quantity: choice.quantity,
    fillSpares: input.fillSpares ?? false,
    perSheet: choice.perSheet ?? null,
    cropMarks: input.cropMarks ?? false,
    backPage: choice.backPage ?? false,
    languages: input.languages,
    callToAction: input.callToAction,
    customWords: printFinalOwnWordsToSend(
      { preset: input.callToAction, custom: input.customWords ?? null },
      input.languages,
    ),
  }
}

export async function rememberLastPrint(
  deps: RememberLastPrintDeps,
  print: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    portalId: PortalId
    choice: PrintFinalChoice
    input: DownloadPortalPrintFinalInput
    look: PortalPrintKitContext['look']
  }>,
): Promise<void> {
  const { choice, look } = print
  // Only an Immersive print uses the photo, so only it keeps one to compare with.
  const { hero } = look
  const photo =
    choice.look === 'immersive' && hero !== null
      ? { assetId: hero.assetId, focalX: hero.focalX, focalY: hero.focalY }
      : null
  try {
    await deps.lastPrintRepo.record({
      organizationId: print.organizationId,
      propertyId: print.propertyId,
      portalId: print.portalId,
      printedAt: deps.clock(),
      settings: settingsOf(choice, print.input),
      photo,
    })
  } catch (error) {
    // The cause and a code only: never the choices, the address or the file, and
    // no Portal id (a banned log key; the request's own correlation finds it).
    deps.logger.warn(
      { err: error, errorCode: 'portal_last_print_not_remembered' },
      'The last final print could not be remembered; the file was made',
    )
  }
}
