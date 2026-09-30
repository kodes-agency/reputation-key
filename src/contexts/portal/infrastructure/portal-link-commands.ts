// Portal command store — link and link-category commands.
// Split out of portal-command-store.ts (round 4 F3); composed back behind the
// same PortalCommandStore port by createAtomicPortalCommandStore.

import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalLinkCategories, portalLinks } from '#/shared/db/schema'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'
import type {
  CreatePortalLinkCategoryCommand,
  CreatePortalLinkCommand,
  DeletePortalLinkCategoryCommand,
  DeletePortalLinkCommand,
  PortalCommandStore,
  ReorderPortalLinkCategoriesCommand,
  ReorderPortalLinksCommand,
  UpdatePortalCommand,
  UpdatePortalLinkCategoryCommand,
  UpdatePortalLinkCommand,
} from '../application/ports/portal-command-store.port'
import { portalError } from '../domain/errors'
import { categoryToRow, linkToRow } from './mappers/portal-link.mapper'
import { fencePortalContent } from './portal-aggregate-fence'
import { sameInstant } from './portal-command-guards'
import { recordPortalPendingContentChange } from './portal-pending-content-changes'

export type PortalLinkCommandStore = Pick<
  PortalCommandStore,
  | 'createPortalLinkCategory'
  | 'updatePortalLinkCategory'
  | 'deletePortalLinkCategory'
  | 'reorderPortalLinkCategories'
  | 'createPortalLink'
  | 'updatePortalLink'
  | 'deletePortalLink'
  | 'reorderPortalLinks'
>

async function recordPortalContentCommandPending(
  tx: Tx,
  command: Readonly<{
    organizationId: UpdatePortalCommand['organizationId']
    propertyId: UpdatePortalCommand['propertyId']
    portalId: UpdatePortalCommand['portalId']
    revision: Date
    occurredAt: Date
  }>,
): Promise<void> {
  await recordPortalPendingContentChange(tx, {
    organizationId: unbrand(command.organizationId),
    propertyId: unbrand(command.propertyId),
    portalId: unbrand(command.portalId),
    kind: 'portal_links',
    sourceVersion: command.revision.toISOString(),
    changedAt: command.occurredAt,
  })
}

type PortalContentCommand =
  | CreatePortalLinkCategoryCommand
  | UpdatePortalLinkCategoryCommand
  | DeletePortalLinkCategoryCommand
  | ReorderPortalLinkCategoriesCommand
  | CreatePortalLinkCommand
  | UpdatePortalLinkCommand
  | DeletePortalLinkCommand
  | ReorderPortalLinksCommand

function assertPortalContentCommand(command: PortalContentCommand): void {
  const event = command.event
  let scoped = false
  switch (event._tag) {
    case 'portal_link_category.created':
      scoped =
        'category' in command &&
        command.category.organizationId === command.organizationId &&
        command.category.portalId === command.portalId &&
        event.categoryId === command.category.id
      break
    case 'portal_link_category.updated':
      scoped = 'title' in command && event.categoryId === command.categoryId
      break
    case 'portal_link_category.deleted':
      scoped =
        'categoryId' in command &&
        !('linkId' in command) &&
        event.categoryId === command.categoryId
      break
    case 'portal_link_category.reordered':
      scoped = 'updates' in command && !('categoryId' in command)
      break
    case 'portal_link.created':
      scoped =
        'link' in command &&
        command.link.organizationId === command.organizationId &&
        command.link.portalId === command.portalId &&
        event.linkId === command.link.id &&
        event.categoryId === command.link.categoryId
      break
    case 'portal_link.updated':
    case 'portal_link.deleted':
      scoped =
        'linkId' in command &&
        event.linkId === command.linkId &&
        event.categoryId === command.categoryId
      break
    case 'portal_link.reordered':
      scoped =
        'updates' in command &&
        'categoryId' in command &&
        event.categoryId === command.categoryId
      break
  }
  if (
    event.organizationId !== command.organizationId ||
    event.propertyId !== command.propertyId ||
    event.portalId !== command.portalId ||
    event.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(event.occurredAt, command.occurredAt) ||
    !scoped
  ) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal content change')
  }
}

export const createPortalLinkCommands = (db: Database): PortalLinkCommandStore => {
  return {
    createPortalLinkCategory: async (command) =>
      trace('portal.commandStore.createPortalLinkCategory', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          await tx.insert(portalLinkCategories).values(categoryToRow(command.category))
          await recordPortalContentCommandPending(tx, command)
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    updatePortalLinkCategory: async (command) =>
      trace('portal.commandStore.updatePortalLinkCategory', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          const [updated] = await tx
            .update(portalLinkCategories)
            .set({ title: command.title, updatedAt: command.occurredAt })
            .where(
              and(
                eq(portalLinkCategories.organizationId, unbrand(command.organizationId)),
                eq(portalLinkCategories.portalId, unbrand(command.portalId)),
                eq(portalLinkCategories.id, unbrand(command.categoryId)),
              ),
            )
            .returning({ id: portalLinkCategories.id })
          if (!updated) {
            throw portalError(
              'revision_conflict',
              'Portal category changed during update',
            )
          }
          await recordPortalContentCommandPending(tx, command)
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    deletePortalLinkCategory: async (command) =>
      trace('portal.commandStore.deletePortalLinkCategory', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          const [deleted] = await tx
            .delete(portalLinkCategories)
            .where(
              and(
                eq(portalLinkCategories.organizationId, unbrand(command.organizationId)),
                eq(portalLinkCategories.portalId, unbrand(command.portalId)),
                eq(portalLinkCategories.id, unbrand(command.categoryId)),
              ),
            )
            .returning({ id: portalLinkCategories.id })
          if (!deleted) {
            throw portalError(
              'revision_conflict',
              'Portal category changed during delete',
            )
          }
          await recordPortalContentCommandPending(tx, command)
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    reorderPortalLinkCategories: async (command) =>
      trace('portal.commandStore.reorderPortalLinkCategories', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          const ids = command.updates.map(({ id }) => unbrand(id))
          if (ids.length > 0) {
            const scoped = await tx
              .select({ id: portalLinkCategories.id })
              .from(portalLinkCategories)
              .where(
                and(
                  eq(
                    portalLinkCategories.organizationId,
                    unbrand(command.organizationId),
                  ),
                  eq(portalLinkCategories.portalId, unbrand(command.portalId)),
                  inArray(portalLinkCategories.id, ids),
                ),
              )
            if (scoped.length !== ids.length) {
              throw portalError('forbidden', 'Portal category scope mismatch')
            }
          }
          for (const update of command.updates) {
            await tx
              .update(portalLinkCategories)
              .set({ sortKey: update.sortKey, updatedAt: command.occurredAt })
              .where(
                and(
                  eq(
                    portalLinkCategories.organizationId,
                    unbrand(command.organizationId),
                  ),
                  eq(portalLinkCategories.portalId, unbrand(command.portalId)),
                  eq(portalLinkCategories.id, unbrand(update.id)),
                ),
              )
          }
          await recordPortalContentCommandPending(tx, command)
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    createPortalLink: async (command) =>
      trace('portal.commandStore.createPortalLink', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          await tx.insert(portalLinks).values(linkToRow(command.link))
          await recordPortalContentCommandPending(tx, command)
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
          const [updated] = await tx
            .update(portalLinks)
            .set({
              label: command.patch.label,
              destinationId: command.patch.destinationId
                ? unbrand(command.patch.destinationId)
                : null,
              url: command.patch.destinationId ? null : command.patch.url,
              legacyDestinationState: command.patch.legacyDestinationState,
              iconKey: command.patch.iconKey,
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
          await recordPortalContentCommandPending(tx, command)
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
          await recordPortalContentCommandPending(tx, command)
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
          await recordPortalContentCommandPending(tx, command)
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),
  }
}
