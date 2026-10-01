// Portal command store — link commands (a link that starts its Portal's first
// category writes the category with it).
// Split out of portal-command-store.ts (round 4 F3); composed back behind the
// same PortalCommandStore port by createAtomicPortalCommandStore.

import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalLinkCategories, portalLinks } from '#/shared/db/schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'
import type { PortalCommandStore } from '../application/ports/portal-command-store.port'
import { portalError } from '../domain/errors'
import { hasRoomForAnotherLink } from '../domain/portal-linktree'
import { portalPageEditKey } from '../domain/portal-page-edit'
import { categoryToRow, newLinkToRow } from './mappers/portal-link.mapper'
import { fencePortalContent } from './portal-aggregate-fence'
import {
  assertPortalContentCommand,
  contentScope,
  recordPortalContentCommandChange,
} from './portal-content-command-guards'
import { createPortalLinktreeCommands } from './portal-linktree-commands'
import {
  readPortalLocales,
  readPrimaryLinkLabel,
  syncPrimaryLinkText,
} from './portal-link-texts-store'

export type PortalLinkCommandStore = Pick<
  PortalCommandStore,
  | 'createPortalLink'
  | 'updatePortalLink'
  | 'deletePortalLink'
  | 'reorderPortalLinks'
  | 'savePortalLinkTexts'
  | 'savePortalLinktreeSettings'
>

export const createPortalLinkCommands = (db: Database): PortalLinkCommandStore => {
  return {
    // The Linktree working model is part of the link family; its own module
    // keeps the texts, title and switch commands out of this file.
    ...createPortalLinktreeCommands(db),
    createPortalLink: async (command) =>
      trace('portal.commandStore.createPortalLink', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          const scope = contentScope(command)
          // Counted under the Portal fence, so two creates cannot both take the last place.
          const [existing] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(portalLinks)
            .where(
              and(
                eq(portalLinks.organizationId, scope.organizationId),
                eq(portalLinks.portalId, scope.portalId),
              ),
            )
          if (!hasRoomForAnotherLink(existing?.count ?? 0)) {
            throw portalError(
              'link_limit_reached',
              'A Portal can carry at most four links',
            )
          }
          const locales = await readPortalLocales(tx, scope)
          if (command.startCategory) {
            await tx
              .insert(portalLinkCategories)
              .values(categoryToRow(command.startCategory.category))
            await insertOutboxRow(tx, command.startCategory.event, {
              recordedAt: command.occurredAt,
            })
          }
          await tx.insert(portalLinks).values(newLinkToRow(command.link))
          await syncPrimaryLinkText(
            tx,
            { ...scope, linkId: unbrand(command.link.id) },
            { actorUserId: unbrand(command.actorUserId), at: command.occurredAt },
            { locale: locales.primary, label: command.label },
          )
          await recordPortalContentCommandChange(tx, command, [
            ...(command.startCategory
              ? [
                  {
                    key: portalPageEditKey.categoryCreated(
                      unbrand(command.startCategory.category.id),
                    ),
                    newText: command.startCategory.category.title,
                  },
                ]
              : []),
            {
              key: portalPageEditKey.linkCreated(unbrand(command.link.id)),
              newText: command.label,
            },
          ])
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    updatePortalLink: async (command) =>
      trace('portal.commandStore.updatePortalLink', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          const scope = contentScope(command)
          const linkScope = { ...scope, linkId: unbrand(command.linkId) }
          const locales = await readPortalLocales(tx, scope)
          // The wording a rename replaces, read before it is written.
          const before =
            command.patch.label === undefined
              ? null
              : await readPrimaryLinkLabel(tx, linkScope, locales.primary)
          const [updated] = await tx
            .update(portalLinks)
            .set({
              destinationId: command.patch.destinationId
                ? unbrand(command.patch.destinationId)
                : null,
              url: command.patch.destinationId ? null : command.patch.url,
              legacyDestinationState: command.patch.legacyDestinationState,
              iconKey: command.patch.iconKey,
              imageAssetId: command.patch.imageAssetId
                ? unbrand(command.patch.imageAssetId)
                : null,
              updatedAt: command.occurredAt,
            })
            .where(
              and(
                eq(portalLinks.organizationId, unbrand(command.organizationId)),
                eq(portalLinks.portalId, unbrand(command.portalId)),
                eq(portalLinks.categoryId, unbrand(command.categoryId)),
                eq(portalLinks.id, unbrand(command.linkId)),
              ),
            )
            .returning({ id: portalLinks.id })
          if (!updated) {
            throw portalError('revision_conflict', 'Portal link changed during update')
          }
          const label = command.patch.label
          if (label !== undefined) {
            await syncPrimaryLinkText(
              tx,
              linkScope,
              { actorUserId: unbrand(command.actorUserId), at: command.occurredAt },
              { locale: locales.primary, label },
            )
          }
          const renamed = label !== undefined && before !== null && before !== label
          await recordPortalContentCommandChange(tx, command, [
            {
              key: portalPageEditKey.linkUpdated(unbrand(command.linkId)),
              ...(renamed ? { previousText: before, newText: label } : {}),
            },
          ])
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    deletePortalLink: async (command) =>
      trace('portal.commandStore.deletePortalLink', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          const scope = contentScope(command)
          const locales = await readPortalLocales(tx, scope)
          // Read before the link and its texts go.
          const previousText = await readPrimaryLinkLabel(
            tx,
            { ...scope, linkId: unbrand(command.linkId) },
            locales.primary,
          )
          const [deleted] = await tx
            .delete(portalLinks)
            .where(
              and(
                eq(portalLinks.organizationId, unbrand(command.organizationId)),
                eq(portalLinks.portalId, unbrand(command.portalId)),
                eq(portalLinks.categoryId, unbrand(command.categoryId)),
                eq(portalLinks.id, unbrand(command.linkId)),
              ),
            )
            .returning({ id: portalLinks.id })
          if (!deleted) {
            throw portalError('revision_conflict', 'Portal link changed during delete')
          }
          await recordPortalContentCommandChange(tx, command, [
            {
              key: portalPageEditKey.linkDeleted(unbrand(command.linkId)),
              ...(previousText === null ? {} : { previousText }),
            },
          ])
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    reorderPortalLinks: async (command) =>
      trace('portal.commandStore.reorderPortalLinks', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          const ids = command.updates.map(({ id }) => unbrand(id))
          if (ids.length > 0) {
            const scoped = await tx
              .select({ id: portalLinks.id })
              .from(portalLinks)
              .where(
                and(
                  eq(portalLinks.organizationId, unbrand(command.organizationId)),
                  eq(portalLinks.portalId, unbrand(command.portalId)),
                  eq(portalLinks.categoryId, unbrand(command.categoryId)),
                  inArray(portalLinks.id, ids),
                ),
              )
            if (scoped.length !== ids.length) {
              throw portalError('forbidden', 'Portal link scope mismatch')
            }
          }
          for (const update of command.updates) {
            await tx
              .update(portalLinks)
              .set({ sortKey: update.sortKey, updatedAt: command.occurredAt })
              .where(
                and(
                  eq(portalLinks.organizationId, unbrand(command.organizationId)),
                  eq(portalLinks.portalId, unbrand(command.portalId)),
                  eq(portalLinks.categoryId, unbrand(command.categoryId)),
                  eq(portalLinks.id, unbrand(update.id)),
                ),
              )
          }
          await recordPortalContentCommandChange(tx, command, [
            { key: portalPageEditKey.linksReordered(unbrand(command.categoryId)) },
          ])
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),
  }
}
