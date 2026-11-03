// Portal command store — a person's guest page takes over another Portal's wording,
// links and look. One transaction, under the Property's publication fence: the source
// must still be what was reviewed, and the page must still be what was read. Going live
// is a separate commit, by the ordinary publication.

import { and, eq, isNull, ne } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalLinkCategories,
  portalLocalizedOverrides,
  portalLookOverrides,
  portals,
} from '#/shared/db/schema'
import { portalPrintWordings } from '#/shared/db/schema/portal-print-wording.schema'
import { unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import type {
  PortalCommandStore,
  ReplacePersonalPortalContentCommand,
} from '../application/ports/portal-command-store.port'
import { portalError } from '../domain/errors'
import { PORTAL_LOOK_FACETS } from '../domain/portal-look'
import { portalPageEditKey } from '../domain/portal-page-edit'
import { assertPersonalSourceFence } from './personal-portal-source-fence'
import { assertCommittedRevision } from './portal-command-guards'
import { insertCopiedContent, refusingGoneLookImage } from './portal-copied-content'
import { recordPortalContentChange } from './portal-page-edits'
import { lockPortalPublicationWorkingCopy } from './portal-publication-serialization'

const CHANGED = 'This guest page changed. Refresh Staff and try again.'

/** A copied look stays above the version this page has already had. */
async function lookAboveCurrent(
  tx: Tx,
  scope: Readonly<{ organizationId: string; portalId: string }>,
  look: ReplacePersonalPortalContentCommand['content']['look'],
) {
  if (!look) return look
  const [current] = await tx
    .select({ lookVersion: portalLookOverrides.lookVersion })
    .from(portalLookOverrides)
    .where(
      and(
        eq(portalLookOverrides.organizationId, scope.organizationId),
        eq(portalLookOverrides.portalId, scope.portalId),
      ),
    )
  return current
    ? { ...look, lookVersion: Math.max(look.lookVersion, current.lookVersion + 1) }
    : look
}

async function clearContent(
  tx: Tx,
  scope: Readonly<{ organizationId: string; portalId: string }>,
): Promise<void> {
  const { organizationId, portalId } = scope
  await tx
    .delete(portalLocalizedOverrides)
    .where(
      and(
        eq(portalLocalizedOverrides.organizationId, organizationId),
        eq(portalLocalizedOverrides.portalId, portalId),
      ),
    )
  // Links and their texts go with their category.
  await tx
    .delete(portalLinkCategories)
    .where(
      and(
        eq(portalLinkCategories.organizationId, organizationId),
        eq(portalLinkCategories.portalId, portalId),
      ),
    )
  await tx
    .delete(portalLookOverrides)
    .where(
      and(
        eq(portalLookOverrides.organizationId, organizationId),
        eq(portalLookOverrides.portalId, portalId),
      ),
    )
}

async function writePrintWording(
  tx: Tx,
  command: ReplacePersonalPortalContentCommand,
): Promise<void> {
  const values = {
    callToAction: command.printWording.callToAction,
    callToActionCustom: command.printWording.customWords,
    updatedAt: command.revision,
  }
  await tx
    .insert(portalPrintWordings)
    .values({
      organizationId: unbrand(command.organizationId),
      propertyId: unbrand(command.propertyId),
      portalId: unbrand(command.portalId),
      ...values,
    })
    .onConflictDoUpdate({ target: portalPrintWordings.portalId, set: values })
}

/** Who replaced what: the History names it, and the open fences say guests don't see it yet. */
async function recordReplacement(
  tx: Tx,
  command: ReplacePersonalPortalContentCommand,
): Promise<void> {
  const base = {
    organizationId: unbrand(command.organizationId),
    propertyId: unbrand(command.propertyId),
    portalId: unbrand(command.portalId),
    sourceVersion: `guest-page:${command.revision.toISOString()}`,
    changedAt: command.revision,
    actorUserId: unbrand(command.actorUserId),
  }
  await recordPortalContentChange(tx, {
    ...base,
    kind: 'portal_localized_override',
    ledger: [{ key: 'all' }],
  })
  await recordPortalContentChange(tx, {
    ...base,
    kind: 'portal_links',
    ledger: [{ key: 'all' }],
  })
  await recordPortalContentChange(tx, {
    ...base,
    kind: 'portal_configuration',
    ledger: PORTAL_LOOK_FACETS.map((facet) => ({
      key: portalPageEditKey.portalLook(facet),
    })),
  })
}

async function commit(
  db: Database,
  command: ReplacePersonalPortalContentCommand,
): Promise<void> {
  const organizationId = unbrand(command.organizationId)
  const propertyId = unbrand(command.propertyId)
  const portalId = unbrand(command.portalId)
  await db.transaction(async (tx) => {
    // Takes the Property's publication lock, so two batches can't cross.
    await assertPersonalSourceFence(
      tx,
      { organizationId: command.organizationId, propertyId: command.propertyId },
      command.sourceFence,
    )
    const found = await lockPortalPublicationWorkingCopy(
      tx,
      organizationId,
      propertyId,
      portalId,
    )
    if (!found) throw portalError('portal_not_found', 'This guest page is unavailable')
    const [updated] = await tx
      .update(portals)
      .set({
        publicName: command.publicName,
        primaryGuestLocale: command.primaryGuestLocale,
        additionalGuestLocales: [...command.additionalGuestLocales],
        linktreeEnabled: command.linktreeEnabled,
        updatedAt: command.revision,
      })
      .where(
        and(
          eq(portals.organizationId, organizationId),
          eq(portals.propertyId, propertyId),
          eq(portals.id, portalId),
          eq(portals.kind, 'personal'),
          eq(portals.updatedAt, command.expectedUpdatedAt),
          ne(portals.publicationState, 'archived'),
          isNull(portals.deletedAt),
        ),
      )
      .returning({ updatedAt: portals.updatedAt })
    assertCommittedRevision(updated, command.revision, 'Portal', CHANGED)
    const look = await lookAboveCurrent(
      tx,
      { organizationId, portalId },
      command.content.look,
    )
    await clearContent(tx, { organizationId, portalId })
    await insertCopiedContent(
      tx,
      {
        organizationId,
        propertyId,
        portalId,
        actorUserId: unbrand(command.actorUserId),
        at: command.revision,
      },
      { ...command.content, look },
    )
    await writePrintWording(tx, command)
    await recordReplacement(tx, command)
    await insertOutboxRow(tx, command.event, { recordedAt: command.revision })
  })
}

export const createPersonalPortalContentCommand = (
  db: Database,
): Pick<PortalCommandStore, 'replacePersonalPortalContent'> => ({
  replacePersonalPortalContent: async (command) =>
    trace('portal.commandStore.replacePersonalPortalContent', () =>
      refusingGoneLookImage(() => commit(db, command)),
    ),
})
