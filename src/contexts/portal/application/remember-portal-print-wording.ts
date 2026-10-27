// Portal context — remembers a final print's wording as the Portal's saved one
// (2026-10-27), once its file is made: after a download, the saved wording is what
// printed. Like the last print's memory it is a convenience for the next visit to
// Share, so a manager who has the file is never refused it because the wording
// could not be written: the failure is logged and the print stands.

import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { PrintFinalSavedWording } from '#/shared/domain/portal-print-final-wording'
import type { PortalPrintWordingRepository } from './ports/portal-print-wording.repository'

export type RememberPrintWordingDeps = Readonly<{
  wordingRepo: Pick<PortalPrintWordingRepository, 'save'>
  clock: () => Date
  logger: Pick<LoggerPort, 'warn'>
}>

export async function rememberPrintWording(
  deps: RememberPrintWordingDeps,
  print: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    portalId: PortalId
    wording: PrintFinalSavedWording
  }>,
): Promise<void> {
  try {
    await deps.wordingRepo.save({
      organizationId: print.organizationId,
      propertyId: print.propertyId,
      portalId: print.portalId,
      wording: print.wording,
      savedAt: deps.clock(),
    })
  } catch (error) {
    // The cause and a code only: never the words, and no Portal id (a banned log
    // key; the request's own correlation finds it).
    deps.logger.warn(
      { err: error, errorCode: 'portal_print_wording_not_remembered' },
      'The print wording could not be saved; the file was made',
    )
  }
}
