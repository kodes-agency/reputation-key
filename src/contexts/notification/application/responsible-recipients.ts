import {
  portalGroupId,
  portalId,
  propertyId,
  type OrganizationId,
  type UserId,
} from '#/shared/domain/ids'
import type { UserLookupPort } from './ports/user-lookup.port'
import type { InboxItemFacts } from './ports/inbox-item-lookup.port'
import type { ResponsibleManagerLookupPort } from './ports/responsible-manager-lookup.port'
import type { NotificationAudience } from './notification-audience'

export type ResponsibleScope =
  | Readonly<{ kind: 'property'; propertyId: string }>
  | Readonly<{ kind: 'portal'; portalId: string }>
  | Readonly<{ kind: 'portal_group'; portalGroupId: string }>

export type ResponsibleRecipientDeps = Readonly<{
  responsibleManagers: ResponsibleManagerLookupPort
  userLookup: Pick<UserLookupPort, 'findByRole'>
}>

const unique = (recipients: readonly UserId[]): readonly UserId[] => [
  ...new Set(recipients),
]

const recoveryAdmins = (deps: ResponsibleRecipientDeps, organizationId: OrganizationId) =>
  deps.userLookup.findByRole(organizationId, 'AccountAdmin')

/**
 * Resolve current explicit responsibility. AccountAdmins are a recovery path
 * only when the scoped authority has no eligible recipient.
 */
export async function resolveResponsibleRecipients(
  deps: ResponsibleRecipientDeps,
  organizationId: OrganizationId,
  scope: ResponsibleScope,
): Promise<readonly UserId[]> {
  const recipients =
    scope.kind === 'property'
      ? await deps.responsibleManagers.findForProperty(
          organizationId,
          propertyId(scope.propertyId),
        )
      : scope.kind === 'portal'
        ? await deps.responsibleManagers.findForPortal(
            organizationId,
            portalId(scope.portalId),
          )
        : await deps.responsibleManagers.findForPortalGroup(
            organizationId,
            portalGroupId(scope.portalGroupId),
          )

  return recipients.length > 0
    ? unique(recipients)
    : unique(await recoveryAdmins(deps, organizationId))
}

/**
 * Reviews are Property-wide work. Private feedback belongs to the Portal that
 * collected it. If that Portal attribution is unavailable, recovery goes to
 * AccountAdmins rather than guessing from Property access or Staff data.
 */
export function resolveInboxResponsibleRecipients(
  deps: ResponsibleRecipientDeps,
  organizationId: OrganizationId,
  facts: InboxItemFacts,
): Promise<readonly UserId[]> {
  const audience = inboxNotificationAudience(facts)
  if (audience.kind === 'responsible_scope') {
    return resolveResponsibleRecipients(deps, organizationId, {
      ...audience.scope,
    })
  }
  return recoveryAdmins(deps, organizationId).then(unique)
}

/** The durable reason for delivering a new-item or unassigned-note notice. */
export function inboxNotificationAudience(facts: InboxItemFacts): NotificationAudience {
  if (facts.sourceType !== 'feedback') {
    return {
      kind: 'responsible_scope',
      scope: { kind: 'property', propertyId: facts.propertyId },
    }
  }
  return facts.portalId
    ? {
        kind: 'responsible_scope',
        scope: { kind: 'portal', portalId: facts.portalId },
      }
    : { kind: 'account_admin' }
}
