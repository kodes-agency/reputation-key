import {
  inboxItemId,
  type OrganizationId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'
import type { ResponsibleManagerLookupPort } from './ports/responsible-manager-lookup.port'
import type { UserLookupPort } from './ports/notification-user-lookup.port'
import type { NotificationRepositoryPort } from './ports/notification-repository.port'
import type { InboxItemLookupPort } from './ports/notification-inbox-item-lookup.port'
import {
  findScopeResponsibleManagers,
  inboxNotificationAudience,
} from './responsible-recipients'

export type EscalationResolutionRecipientDeps = Readonly<{
  responsibleManagers: ResponsibleManagerLookupPort
  userLookup: Pick<UserLookupPort, 'findByRole'>
  notifications: Pick<NotificationRepositoryPort, 'findRecipientsOfNotice'>
  /** Which scope owns the item, so the resolution follows the escalation. */
  inboxItemLookup: Pick<InboxItemLookupPort, 'findInboxItemFacts'>
}>

type ResolutionInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  inboxItemId: string
  assignedTo: UserId | null
  resolvedBy: UserId | null
  /** When the escalation being resolved was raised; null if never recorded. */
  escalatedAt: Date | null
}>

/**
 * The managers of the scope the escalation itself went to: the Property's
 * for a review, the Portal's for private feedback. Feedback no Portal can be
 * found for was escalated to the AccountAdmins, who hear the resolution only
 * through `adminsTold`, so no manager is named for it. An item whose facts
 * are gone is read as the Property's, which is where the resolution was
 * recorded.
 */
async function escalationScopeManagers(
  deps: EscalationResolutionRecipientDeps,
  input: ResolutionInput,
): Promise<readonly UserId[]> {
  const facts = await deps.inboxItemLookup.findInboxItemFacts(
    inboxItemId(input.inboxItemId),
    input.organizationId,
  )
  const audience = facts
    ? inboxNotificationAudience(facts)
    : ({
        kind: 'responsible_scope',
        scope: { kind: 'property', propertyId: input.propertyId },
      } as const)
  return audience.kind === 'responsible_scope'
    ? findScopeResponsibleManagers(deps, input.organizationId, audience.scope)
    : []
}

/**
 * Resolve the one current authority tier for a resolved escalation.
 *
 * An eligible current assignee wins. The responsible managers of the scope
 * the escalation went to are the fallback only when no eligible assignee
 * remains: a private-feedback escalation went to the Portal's managers, so
 * its resolution does too, not to the Property's (I5.3). AccountAdmins and
 * broad Property access are deliberately not recipient sources. The resolving
 * actor is suppressed in either tier.
 */
async function handlingTier(
  deps: EscalationResolutionRecipientDeps,
  input: ResolutionInput,
): Promise<readonly UserId[]> {
  if (
    input.assignedTo !== null &&
    (await deps.responsibleManagers.isEligibleForProperty(
      input.organizationId,
      input.propertyId,
      input.assignedTo,
    ))
  ) {
    return input.assignedTo === input.resolvedBy ? [] : [input.assignedTo]
  }

  const managers = await escalationScopeManagers(deps, input)
  const others = managers.filter((candidate) => candidate !== input.resolvedBy)
  const eligibility = await Promise.all(
    others.map(async (candidate) => ({
      candidate,
      eligible: await deps.responsibleManagers.isEligibleForProperty(
        input.organizationId,
        input.propertyId,
        candidate,
      ),
    })),
  )
  return eligibility
    .filter((candidate) => candidate.eligible)
    .map((candidate) => candidate.candidate)
}

/**
 * The AccountAdmins who were told the escalation was raised, and are still
 * AccountAdmins. They used to hear that something was escalated and never that
 * it had been dealt with, so the notice sat unread for good (I5.3). Nobody who
 * was not told is told now: the closing notice follows the raising one — this
 * one, not an earlier escalation of the same item, whose rows are still there.
 */
async function adminsTold(
  deps: EscalationResolutionRecipientDeps,
  input: ResolutionInput,
): Promise<readonly UserId[]> {
  const [told, admins] = await Promise.all([
    deps.notifications.findRecipientsOfNotice(
      input.organizationId,
      'inbox.escalated',
      input.inboxItemId,
      input.escalatedAt,
    ),
    deps.userLookup.findByRole(input.organizationId, 'AccountAdmin'),
  ])
  const current = new Set(admins)
  return [...new Set(told)].filter(
    (candidate) => current.has(candidate) && candidate !== input.resolvedBy,
  )
}

/**
 * Everyone the resolution is news to: the one current handling authority, plus
 * the AccountAdmins who were told it was raised. The resolving actor is
 * suppressed in every tier.
 */
export async function resolveEscalationResolutionRecipients(
  deps: EscalationResolutionRecipientDeps,
  input: ResolutionInput,
): Promise<readonly UserId[]> {
  const [handling, admins] = await Promise.all([
    handlingTier(deps, input),
    adminsTold(deps, input),
  ])
  return [...new Set([...handling, ...admins])]
}
