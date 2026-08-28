import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

/** Current Property-owned responsibility readiness used by explicit restore. */
export type PropertyLifecycleReadiness = Readonly<{
  hasEligibleResponsibleManager: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<boolean>
}>
