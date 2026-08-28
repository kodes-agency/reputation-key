import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { ResponsibleManagerLookupPort } from './ports/responsible-manager-lookup.port'

export type EscalationResolutionRecipientDeps = Readonly<{
  responsibleManagers: ResponsibleManagerLookupPort
}>

/**
 * Resolve the one current authority tier for a resolved escalation.
 *
 * An eligible current assignee wins. Property Responsible Managers are the
 * fallback only when no eligible assignee remains. AccountAdmins and broad
 * Property access are deliberately not recipient sources. The resolving actor
 * is suppressed in either tier.
 */
export async function resolveEscalationResolutionRecipients(
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
