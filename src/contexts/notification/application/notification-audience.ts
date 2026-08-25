import type { InboxItemId, OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { UserLookupPort } from './ports/user-lookup.port'
import type { ResponsibleManagerLookupPort } from './ports/responsible-manager-lookup.port'
import type { InboxItemLookupPort } from './ports/inbox-item-lookup.port'
import {
  resolveResponsibleRecipients,
  type ResponsibleScope,
} from './responsible-recipients'

/**
 * Durable description of why a recipient may receive a notification.
 * Identifiers only: no review, guest, staff, or provider content enters the queue.
 */
export type NotificationAudience =
  | Readonly<{ kind: 'responsible_scope'; scope: ResponsibleScope }>
  | Readonly<{ kind: 'account_admin' }>
  | Readonly<{ kind: 'inbox_assignee'; inboxItemId: InboxItemId }>
  | Readonly<{ kind: 'property_operator' }>

export type NotificationAudienceAuthorizationInput = Readonly<{
  userId: UserId
  organizationId: OrganizationId
  propertyId: PropertyId
  audience: NotificationAudience
}>

export type NotificationAudienceAuthorizer = (
  input: NotificationAudienceAuthorizationInput,
) => Promise<boolean>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

/** Parse the queue trust boundary without accepting a partial scope. */
export function parseNotificationAudience(value: unknown): NotificationAudience | null {
  if (!isRecord(value)) return null
  if (value.kind === 'account_admin' || value.kind === 'property_operator') {
    return { kind: value.kind }
  }
  if (value.kind === 'inbox_assignee' && isIdentifier(value.inboxItemId)) {
    return { kind: 'inbox_assignee', inboxItemId: value.inboxItemId as InboxItemId }
  }
  if (value.kind !== 'responsible_scope' || !isRecord(value.scope)) return null
  const scope = value.scope
  if (scope.kind === 'property' && isIdentifier(scope.propertyId)) {
    return {
      kind: 'responsible_scope',
      scope: { kind: 'property', propertyId: scope.propertyId },
    }
  }
  if (scope.kind === 'portal' && isIdentifier(scope.portalId)) {
    return {
      kind: 'responsible_scope',
      scope: { kind: 'portal', portalId: scope.portalId },
    }
  }
  if (scope.kind === 'portal_group' && isIdentifier(scope.portalGroupId)) {
    return {
      kind: 'responsible_scope',
      scope: { kind: 'portal_group', portalGroupId: scope.portalGroupId },
    }
  }
  return null
}

type Deps = Readonly<{
  userLookup: Pick<UserLookupPort, 'findByRole'>
  responsibleManagers: ResponsibleManagerLookupPort
  inboxItemLookup: Pick<InboxItemLookupPort, 'findInboxItemFacts'>
}>

const includesRecipient = (recipients: readonly UserId[], recipient: UserId) =>
  recipients.includes(recipient)

/**
 * Re-check delivery authority at worker execution time. A queued recipient is
 * a candidate, never a durable permission: responsibility, membership, access,
 * or participation may have changed since the originating event was handled.
 */
export const createNotificationAudienceAuthorizer =
  (deps: Deps): NotificationAudienceAuthorizer =>
  async ({ audience, organizationId, propertyId, userId }) => {
    if (audience.kind === 'responsible_scope') {
      return includesRecipient(
        await resolveResponsibleRecipients(deps, organizationId, audience.scope),
        userId,
      )
    }
    if (audience.kind === 'account_admin') {
      return includesRecipient(
        await deps.userLookup.findByRole(organizationId, 'AccountAdmin'),
        userId,
      )
    }
    if (audience.kind === 'inbox_assignee') {
      const facts = await deps.inboxItemLookup.findInboxItemFacts(
        audience.inboxItemId,
        organizationId,
      )
      if (!facts || facts.propertyId !== propertyId || facts.assignedTo !== userId) {
        return false
      }
    }
    return deps.responsibleManagers.isEligibleForProperty(
      organizationId,
      propertyId,
      userId,
    )
  }
