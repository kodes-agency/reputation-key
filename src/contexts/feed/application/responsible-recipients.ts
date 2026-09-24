import {
  portalGroupId,
  portalId,
  propertyId,
  type OrganizationId,
  type UserId,
} from '#/shared/domain/ids'
import type { UserLookupPort } from './ports/notification-user-lookup.port'
import type { InboxItemFacts } from './ports/notification-inbox-item-lookup.port'
import type { ResponsibleManagerLookupPort } from './ports/responsible-manager-lookup.port'
import type { NotificationAudience } from './notification-audience'
import type { GoalSubject } from '#/contexts/reporting/application/public-api'

export type ResponsibleScope =
  | Readonly<{ kind: 'property'; propertyId: string }>
  | Readonly<{ kind: 'portal'; portalId: string }>
  | Readonly<{ kind: 'portal_group'; portalGroupId: string }>

/** A Goal's subject is the scope whose responsible managers hear of its results. */
export const goalSubjectScope = (subject: GoalSubject): ResponsibleScope =>
  subject.kind === 'property'
    ? { kind: 'property', propertyId: subject.propertyId }
    : subject.kind === 'portal_group'
      ? { kind: 'portal_group', portalGroupId: subject.portalGroupId }
      : { kind: 'portal', portalId: subject.portalId }

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

/**
 * The item's current assignee when they may still act on its Property.
 * Assignment is operational metadata, never an authority, so it only ever
 * ADDS a recipient to the responsible scope — and only while they are still
 * eligible.
 */
export async function currentEligibleAssignee(
  deps: ResponsibleRecipientDeps,
  organizationId: OrganizationId,
  facts: Pick<InboxItemFacts, 'assignedTo' | 'propertyId'>,
): Promise<UserId | null> {
  if (facts.assignedTo === null) return null
  return (await deps.responsibleManagers.isEligibleForProperty(
    organizationId,
    propertyId(facts.propertyId),
    facts.assignedTo,
  ))
    ? facts.assignedTo
    : null
}

/**
 * Who hears that one Handling Cycle moved — a Review revision, a reopen, a
 * grouped reopen. The item's responsible scope, plus the person actually
 * working on it: a non-responsible manager drafting a reply used to be told
 * neither (I15), although a passed Response Target already reaches them.
 */
export async function resolveHandlingCycleRecipients(
  deps: ResponsibleRecipientDeps,
  organizationId: OrganizationId,
  facts: InboxItemFacts,
): Promise<readonly UserId[]> {
  const [responsible, assignee] = await Promise.all([
    resolveInboxResponsibleRecipients(deps, organizationId, facts),
    currentEligibleAssignee(deps, organizationId, facts),
  ])
  return assignee === null ? responsible : unique([...responsible, assignee])
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
