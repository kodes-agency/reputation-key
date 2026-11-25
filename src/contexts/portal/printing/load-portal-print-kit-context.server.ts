// Portal context — reads what a print is made of, for the print kit read and the
// PDF alike. The live version decides: a print is permanent and its code opens
// the live page, so the languages, the titles and the look are the ones that
// page has, never an edit that has not been published.

import type { OrganizationId } from '#/shared/domain/ids'
import { portalError } from '../domain/errors'
import type { Portal } from '../domain/types'
import type { PortalPublicationRepository } from '../publication/portal-publication-repository.port.server'
import {
  printKitContextOfLive,
  type PortalPrintKitContext,
} from './portal-print-kit-context.server'
import { IMMERSIVE_HUB_SCHEMA_VERSION } from '../domain/portal-publication-snapshot'

export type PrintKitContextDeps = Readonly<{
  publicationRepo: Pick<PortalPublicationRepository, 'findActiveForPortal'>
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
  if (live.configuration.schemaVersion !== IMMERSIVE_HUB_SCHEMA_VERSION) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Publish this Portal again: its live version is from an earlier page design.',
    )
  }
  return printKitContextOfLive(portal.publicName ?? portal.name, live.configuration)
}
