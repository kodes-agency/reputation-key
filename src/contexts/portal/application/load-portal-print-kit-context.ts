// Portal context — reads what a print is made of, for the print kit read and the
// PDF alike. The live version decides: a print is permanent and its code opens
// the live page, so the languages, the titles and the look are the ones that
// page has, never an edit that has not been published.

import type { OrganizationId } from '#/shared/domain/ids'
import { portalError } from '../domain/errors'
import type { Portal } from '../domain/types'
import type { PortalPublicationRepository } from './ports/portal-publication.repository'
import {
  buildPortalPrintKitContext,
  isImmersiveConfiguration,
  liveLocalesOf,
  printKitContextOfLive,
  type PortalPrintKitContext,
} from './portal-print-kit-context'

export type PrintKitContextDeps = Readonly<{
  publicationRepo: Pick<
    PortalPublicationRepository,
    'loadWorkingCopy' | 'findActiveForPortal'
  >
}>

export async function loadPortalPrintKitContext(
  deps: PrintKitContextDeps,
  scope: Readonly<{ organizationId: OrganizationId; portal: Portal }>,
): Promise<PortalPrintKitContext> {
  const { organizationId, portal } = scope
  const live = await deps.publicationRepo.findActiveForPortal(organizationId, portal.id)
  if (!live) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Publish this Portal before printing it: a print carries the live code.',
    )
  }
  if (isImmersiveConfiguration(live.configuration)) {
    return printKitContextOfLive(portal.name, live.configuration)
  }
  const source = await deps.publicationRepo.loadWorkingCopy(organizationId, portal.id)
  if (!source) throw portalError('portal_not_found', 'portal not found')
  return buildPortalPrintKitContext(source, liveLocalesOf(live.configuration))
}
