// Portal command store — the guards every Portal content command shares:
// the scope assertion on its fact and the pending-change row that says the
// working copy has moved past what is published. Split out of
// portal-link-commands.ts when the Linktree commands needed the same guards.

import { unbrand } from '#/shared/domain/ids'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import type {
  CreatePortalLinkCommand,
  DeletePortalLinkCommand,
  ReorderPortalLinksCommand,
  SavePortalLinkTextsCommand,
  SavePortalLinktreeSettingsCommand,
  UpdatePortalCommand,
  UpdatePortalLinkCommand,
} from '../application/ports/portal-command-store.port'
import { portalError } from '../domain/errors'
import { sameInstant } from './portal-command-guards'
import { recordPortalContentChange, type PortalPageEditEntry } from './portal-page-edits'

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

/**
 * The fence and the ledger of a generic link command. The fence key stays coarse
 * (`portal_links`/`all`); `ledger` names the link (or the category it started)
 * and what was done to it.
 */
export async function recordPortalContentCommandChange(
  tx: Tx,
  command: Readonly<{
    organizationId: UpdatePortalCommand['organizationId']
    propertyId: UpdatePortalCommand['propertyId']
    portalId: UpdatePortalCommand['portalId']
    actorUserId: UpdatePortalCommand['actorUserId']
    revision: Date
    occurredAt: Date
  }>,
  ledger: readonly PortalPageEditEntry[],
): Promise<void> {
  await recordPortalContentChange(tx, {
    organizationId: unbrand(command.organizationId),
    propertyId: unbrand(command.propertyId),
    portalId: unbrand(command.portalId),
    kind: 'portal_links',
    ledger,
    sourceVersion: command.revision.toISOString(),
    changedAt: command.occurredAt,
    actorUserId: unbrand(command.actorUserId),
  })
}

export type PortalContentCommand =
  | CreatePortalLinkCommand
  | UpdatePortalLinkCommand
  | DeletePortalLinkCommand
  | ReorderPortalLinksCommand
  | SavePortalLinkTextsCommand
  | SavePortalLinktreeSettingsCommand

/**
 * A link that starts its Portal's first category writes that category and its
 * fact in the same transaction; both must sit in the command's scope and be the
 * link's own category, or the composite foreign key alone would let a category
 * (and an outbox fact) of another Portal through.
 */
function startedCategoryIsScoped(command: CreatePortalLinkCommand): boolean {
  const started = command.startCategory
  if (!started) return true
  const { category, event } = started
  return (
    category.organizationId === command.organizationId &&
    category.portalId === command.portalId &&
    category.id === command.link.categoryId &&
    event._tag === 'portal_link_category.created' &&
    event.categoryId === category.id &&
    event.organizationId === command.organizationId &&
    event.propertyId === command.propertyId &&
    event.portalId === command.portalId &&
    event.sourceAggregateVersion === command.revision.toISOString() &&
    sameInstant(event.occurredAt, command.occurredAt)
  )
}

// fallow-ignore-next-line complexity
export function assertPortalContentCommand(command: PortalContentCommand): void {
  const event = command.event
  let scoped = false
  switch (event._tag) {
    case 'portal_link.created':
      scoped =
        'link' in command &&
        command.link.organizationId === command.organizationId &&
        command.link.portalId === command.portalId &&
        event.linkId === command.link.id &&
        event.categoryId === command.link.categoryId &&
        startedCategoryIsScoped(command)
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
      // Only the Linktree settings command reports a Portal fact; a link or
      // text command carrying one is a mismatched pair.
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
