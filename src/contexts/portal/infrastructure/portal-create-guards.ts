// Portal command store — the guards of the create-Portal command.
//
// The application builds the command; these refuse one whose parts do not
// describe the same Portal, so a wrong tenant, a foreign fact, a copied row
// that points at another Portal, or a copied link with no destination can never
// be committed. Whether a destination is still approved is not decided here: the
// application checks it when it reads the source Portal, and publishing checks
// it again.

import { MAX_PORTAL_LINKS } from '../domain/portal-linktree'
import { portalError } from '../domain/errors'
import type { CreatePortalCommand } from '../application/ports/portal-command-store.port'
import { sameInstant } from './portal-command-guards'
import { assertMembershipCommand } from './portal-group-commands'

/** The `portal.created` fact must name exactly the Portal being written. */
function matchesPortalCreationScope(command: CreatePortalCommand): boolean {
  const { portal, event } = command
  return (
    portal.organizationId === command.organizationId &&
    event.organizationId === command.organizationId &&
    event.propertyId === portal.propertyId &&
    event.portalId === portal.id &&
    event.publicationState === portal.publicationState &&
    event.sourceAggregateVersion === portal.updatedAt.toISOString() &&
    sameInstant(event.occurredAt, portal.createdAt)
  )
}

/** Initial Health may only assert the Draft posture, pinned to the creation revision. */
function matchesInitialDraftHealth(
  health: NonNullable<CreatePortalCommand['health']>,
  portal: CreatePortalCommand['portal'],
): boolean {
  return (
    health.sourceVersion === portal.updatedAt.toISOString() &&
    sameInstant(health.effectiveAt, portal.createdAt) &&
    health.value.status === 'unavailable' &&
    health.value.reason === 'publication_draft'
  )
}

/** The recovery fact must carry the same scope and revision as the Portal it covers. */
function matchesResponsibilityFactScope(
  fact: NonNullable<CreatePortalCommand['responsibilityNeededEvent']>,
  command: CreatePortalCommand,
): boolean {
  const { portal } = command
  return (
    fact.organizationId === command.organizationId &&
    fact.propertyId === portal.propertyId &&
    fact.portalId === portal.id &&
    fact.sourceAggregateVersion === portal.updatedAt.toISOString() &&
    sameInstant(fact.occurredAt, portal.createdAt)
  )
}

function assertResponsibility(command: CreatePortalCommand): void {
  const { portal, responsibilityNeededEvent, initialResponsibleManagerIds } = command
  const needsResponsibility = initialResponsibleManagerIds.length === 0
  if (
    needsResponsibility !== Boolean(responsibilityNeededEvent) ||
    needsResponsibility !== (portal.responsibilityNeededSince !== null)
  ) {
    throw portalError(
      'revision_conflict',
      'Portal responsibility state and recovery fact must be committed together',
    )
  }
  if (
    new Set(initialResponsibleManagerIds).size !== initialResponsibleManagerIds.length
  ) {
    throw portalError(
      'responsible_manager_ineligible',
      'initial responsible managers must be distinct',
    )
  }
  if (
    responsibilityNeededEvent &&
    !matchesResponsibilityFactScope(responsibilityNeededEvent, command)
  ) {
    throw portalError(
      'forbidden',
      'Tenant or resource mismatch on Portal responsibility fact',
    )
  }
}

function assertGroupMembership(command: CreatePortalCommand): void {
  const membership = command.groupMembership
  if (!membership) return
  const { portal } = command
  if (portal.createdBy === null) {
    throw portalError('forbidden', 'A Portal joining a group needs its creator')
  }
  if (membership.revision.getTime() <= membership.expectedGroupUpdatedAt.getTime()) {
    throw portalError(
      'revision_conflict',
      'Portal Group command revision must advance monotonically',
    )
  }
  assertMembershipCommand(
    {
      organizationId: command.organizationId,
      propertyId: portal.propertyId,
      portalGroupId: membership.portalGroupId,
      portalId: portal.id,
      expectedUpdatedAt: membership.expectedGroupUpdatedAt,
      revision: membership.revision,
      occurredAt: portal.createdAt,
      changedBy: portal.createdBy,
      event: membership.event,
    },
    'portal_group.portal_added',
  )
}

/**
 * Every copied row must belong to the new Portal, in its languages, and every
 * copied link must name a destination. That the destination is approved is read
 * and checked by the application, not guarded here.
 */
function assertCopiedContent(command: CreatePortalCommand): void {
  const copy = command.copiedContent
  if (!copy) return
  const { portal } = command
  if (portal.createdBy === null) {
    throw portalError('forbidden', 'A Portal with copied content needs its creator')
  }
  const offered: readonly string[] = [
    portal.primaryGuestLocale,
    ...portal.additionalGuestLocales,
  ]
  const categoryIds = new Set(copy.categories.map((category) => category.id))
  const linkIds = new Set(copy.links.map((link) => link.id))
  const ownsRow = (row: { portalId: string; organizationId: string }): boolean =>
    row.portalId === portal.id && row.organizationId === command.organizationId
  const ok =
    copy.sourcePortalId !== portal.id &&
    copy.links.length <= MAX_PORTAL_LINKS &&
    copy.categories.every(ownsRow) &&
    copy.links.every(
      (link) =>
        ownsRow(link) &&
        link.propertyId === portal.propertyId &&
        link.destinationId !== null &&
        categoryIds.has(link.categoryId),
    ) &&
    copy.linkTexts.every(
      (text) => linkIds.has(text.linkId) && offered.includes(text.locale),
    ) &&
    copy.links.every((link) =>
      copy.linkTexts.some(
        (text) => text.linkId === link.id && text.locale === portal.primaryGuestLocale,
      ),
    ) &&
    copy.overrides.every((override) => offered.includes(override.locale))
  if (!ok) {
    throw portalError(
      'forbidden',
      'Copied Portal content does not belong to the Portal being created',
    )
  }
}

export function assertCreateCommand(command: CreatePortalCommand): void {
  if (!matchesPortalCreationScope(command)) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal creation')
  }
  assertResponsibility(command)
  if (command.health && !matchesInitialDraftHealth(command.health, command.portal)) {
    throw portalError('forbidden', 'Initial Portal Health does not match Draft state')
  }
  assertGroupMembership(command)
  assertCopiedContent(command)
}
