import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { ResponsibleManagerLookupPort } from './ports/responsible-manager-lookup.port'
import type { UserLookupPort } from './ports/notification-user-lookup.port'
import type { NotificationRepositoryPort } from './ports/notification-repository.port'

export type EscalationResolutionRecipientDeps = Readonly<{
  responsibleManagers: ResponsibleManagerLookupPort
  userLookup: Pick<UserLookupPort, 'findByRole'>
  notifications: Pick<NotificationRepositoryPort, 'findRecipientsOfNotice'>
}>

/**
 * Resolve the one current authority tier for a resolved escalation.
 *
 * An eligible current assignee wins. Property Responsible Managers are the
 * fallback only when no eligible assignee remains. AccountAdmins and broad
 * Property access are deliberately not recipient sources. The resolving actor
 * is suppressed in either tier.
 */
async function handlingTier(
  deps: EscalationResolutionRecipientDeps,
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    assignedTo: UserId | null
    resolvedBy: UserId | null
  }>,
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

  const managers = await deps.responsibleManagers.findForProperty(
    input.organizationId,
    input.propertyId,
  )
  const unique = [...new Set(managers)].filter(
    (candidate) => candidate !== input.resolvedBy,
  )
  const eligibility = await Promise.all(
    unique.map(async (candidate) => ({
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
 * was not told is told now: the closing notice follows the raising one.
 */
async function adminsTold(
  deps: EscalationResolutionRecipientDeps,
  input: Readonly<{
    organizationId: OrganizationId
    inboxItemId: string
    resolvedBy: UserId | null
  }>,
): Promise<readonly UserId[]> {
  const [told, admins] = await Promise.all([
    deps.notifications.findRecipientsOfNotice(
      input.organizationId,
      'inbox.escalated',
      input.inboxItemId,
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
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    inboxItemId: string
    assignedTo: UserId | null
    resolvedBy: UserId | null
  }>,
): Promise<readonly UserId[]> {
  const [handling, admins] = await Promise.all([
    handlingTier(deps, input),
    adminsTold(deps, input),
  ])
  return [...new Set([...handling, ...admins])]
}
