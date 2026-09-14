import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import { isBetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { dashboardError } from '../../domain/dashboard-errors'
import { derivePropertySetup } from '../../domain/property-setup'
import type { PropertySetupRepository } from '../ports/property-setup.repository'

export type PropertySetupSummary = Readonly<{
  propertyId: PropertyId
  /** Setup steps with status `pending` or `needs_admin` for this viewer. */
  attentionCount: number
}>

export type ListPropertySetupSummariesInput = Readonly<{
  organizationId: OrganizationId
  /** The viewer's role decides which steps read `needs_admin`. */
  role: Role
  /** `null` for Organization-wide access; otherwise the current granted Properties. */
  accessiblePropertyIds: readonly PropertyId[] | null
}>

export type ListPropertySetupSummariesDeps = Readonly<{
  repository: PropertySetupRepository
}>

/** Attention counts for every live Property the manager can access. */
export const listPropertySetupSummaries =
  (deps: ListPropertySetupSummariesDeps) =>
  async (
    input: ListPropertySetupSummariesInput,
  ): Promise<readonly PropertySetupSummary[]> => {
    if (!isBetaInteractiveRole(input.role)) {
      throw dashboardError('forbidden', 'Property setup is unavailable for this role')
    }
    const role = input.role
    // A manager without a grant has nothing to summarise; skip the tenant read.
    if (
      input.accessiblePropertyIds !== null &&
      input.accessiblePropertyIds.length === 0
    ) {
      return []
    }

    const facts = await deps.repository.listPropertyFacts({
      organizationId: input.organizationId,
      accessiblePropertyIds: input.accessiblePropertyIds,
    })
    return facts.map((propertyFacts) => {
      const setup = derivePropertySetup(propertyFacts, { role })
      return { propertyId: setup.propertyId, attentionCount: setup.attentionCount }
    })
  }

export type ListPropertySetupSummaries = ReturnType<typeof listPropertySetupSummaries>
