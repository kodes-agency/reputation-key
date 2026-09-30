// Portal command store — the guards every Portal content command shares:
// the scope assertion on its fact and the pending-change row that says the
// working copy has moved past what is published. Split out of
// portal-link-commands.ts when the Linktree commands needed the same guards.

import { unbrand } from '#/shared/domain/ids'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import type {
  CreatePortalLinkCategoryCommand,
  CreatePortalLinkCommand,
  DeletePortalLinkCategoryCommand,
  DeletePortalLinkCommand,
  ReorderPortalLinkCategoriesCommand,
  ReorderPortalLinksCommand,
  SavePortalLinkTextsCommand,
  SavePortalLinktreeSettingsCommand,
  UpdatePortalCommand,
  UpdatePortalLinkCategoryCommand,
  UpdatePortalLinkCommand,
} from '../application/ports/portal-command-store.port'
import { portalError } from '../domain/errors'
import { sameInstant } from './portal-command-guards'
import { recordPortalPendingContentChange } from './portal-pending-content-changes'

/** The tenant scope of a Portal content command, as plain strings for queries. */
export const contentScope = (
  command: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    portalId: PortalId
  }>,
) => ({
  organizationId: unbrand(command.organizationId),
  propertyId: unbrand(command.propertyId),
  portalId: unbrand(command.portalId),
})

export async function recordPortalContentCommandPending(
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

export type PortalContentCommand =
  | CreatePortalLinkCategoryCommand
  | UpdatePortalLinkCategoryCommand
  | DeletePortalLinkCategoryCommand
  | ReorderPortalLinkCategoriesCommand
  | CreatePortalLinkCommand
  | UpdatePortalLinkCommand
  | DeletePortalLinkCommand
  | ReorderPortalLinksCommand
  | SavePortalLinkTextsCommand
  | SavePortalLinktreeSettingsCommand

export function assertPortalContentCommand(command: PortalContentCommand): void {
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
    case 'portal.updated':
      // Only the Linktree settings command reports a Portal fact; a link,
      // category or text command carrying one is a mismatched pair.
      scoped =
        ('titles' in command || 'enabled' in command) &&
        !('linkId' in command) &&
        !('link' in command) &&
        !('categoryId' in command) &&
        !('category' in command) &&
        !('updates' in command)
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
