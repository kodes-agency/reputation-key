import { propertyId, type OrganizationId, type UserId } from '#/shared/domain/ids'
import type { ResponseTargetReminderNotificationFacts } from './ports/inbox-item-lookup.port'
import {
  resolveInboxResponsibleRecipients,
  type ResponsibleRecipientDeps,
} from './responsible-recipients'

const unique = (recipients: readonly UserId[]): readonly UserId[] => [
  ...new Set(recipients),
]

async function currentEligibleAssignee(
  deps: ResponsibleRecipientDeps,
  organizationId: OrganizationId,
  facts: ResponseTargetReminderNotificationFacts,
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
 * Resolve one Response Target reminder from current assignment and current
 * source responsibility. Halfway is routine follow-up and narrows to an
 * eligible assignee. Target-passed remains visible to the default responsible
 * scope as well as the assignee. An invalid assignee never blocks the scoped
 * recovery path.
 */
export async function resolveResponseTargetReminderRecipients(
  deps: ResponsibleRecipientDeps,
  organizationId: OrganizationId,
  facts: ResponseTargetReminderNotificationFacts,
): Promise<readonly UserId[]> {
  const assignee = await currentEligibleAssignee(deps, organizationId, facts)
  if (facts.reminderKind === 'halfway' && assignee !== null) return [assignee]

  const responsible = await resolveInboxResponsibleRecipients(deps, organizationId, facts)
  return facts.reminderKind === 'target_passed' && assignee !== null
    ? unique([...responsible, assignee])
    : responsible
}
