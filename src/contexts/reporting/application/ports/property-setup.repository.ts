import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { PropertySetupFacts } from '../../domain/property-setup'

export type { PropertySetupFacts } from '../../domain/property-setup'

/**
 * Content-free setup facts read from their canonical owners at request time.
 * Nothing is recorded: per-Property setup keeps no milestone history.
 */
export type PropertySetupRepository = Readonly<{
  /** Facts for one live Property of the Organization; null when absent or deleted. */
  readPropertyFacts(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
    }>,
  ): Promise<PropertySetupFacts | null>
  /**
   * Facts for every live Property in scope. `null` scope means
   * Organization-wide; an array is the exact accessible Property set.
   */
  listPropertyFacts(
    input: Readonly<{
      organizationId: OrganizationId
      accessiblePropertyIds: readonly PropertyId[] | null
    }>,
  ): Promise<readonly PropertySetupFacts[]>
}>
