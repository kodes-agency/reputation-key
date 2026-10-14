import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import { isBetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { dashboardError } from '../../domain/dashboard-errors'
import { derivePropertySetup, type PropertySetup } from '../../domain/property-setup'
import type { PropertySetupRepository } from '../ports/property-setup.repository'

export type GetPropertySetupInput = Readonly<{
  organizationId: OrganizationId
  /** The viewer's role decides which steps read `needs_admin`. */
  role: Role
  propertyId: PropertyId
  /** `null` for Organization-wide access; otherwise the current granted Properties. */
  accessiblePropertyIds: readonly PropertyId[] | null
  /** The viewer may set a Google rating goal here: the rating goal step is theirs. */
  ratingGoalsEnabled: boolean
}>

export type GetPropertySetupDeps = Readonly<{
  repository: PropertySetupRepository
}>

/** One Property's setup steps for the requesting manager. */
export const getPropertySetup =
  (deps: GetPropertySetupDeps) =>
  async (input: GetPropertySetupInput): Promise<PropertySetup> => {
    if (!isBetaInteractiveRole(input.role)) {
      throw dashboardError('forbidden', 'Property setup is unavailable for this role')
    }
    if (
      input.accessiblePropertyIds !== null &&
      !input.accessiblePropertyIds.includes(input.propertyId)
    ) {
      throw dashboardError('forbidden', 'Property is not accessible to this manager')
    }

    const facts = await deps.repository.readPropertyFacts({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
    })
    if (!facts) throw dashboardError('not_found', 'Property was not found')

    return derivePropertySetup(facts, {
      role: input.role,
      ratingGoalsEnabled: input.ratingGoalsEnabled,
    })
  }

export type GetPropertySetup = ReturnType<typeof getPropertySetup>
