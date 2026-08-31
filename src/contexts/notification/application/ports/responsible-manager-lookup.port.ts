import type {
  OrganizationId,
  PortalGroupId,
  PortalId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'

/**
 * Current, delivery-time manager responsibility supplied by the owning
 * Property and Portal contexts. Access grants and Staff attribution are not
 * recipient sources.
 */
export type ResponsibleManagerLookupPort = Readonly<{
  findForProperty(
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<readonly UserId[]>
  findForPortal(
    organizationId: OrganizationId,
    portalId: PortalId,
  ): Promise<readonly UserId[]>
  findForPortalGroup(
    organizationId: OrganizationId,
    portalGroupId: PortalGroupId,
  ): Promise<readonly UserId[]>
  /** Current role/access/participation eligibility for a direct work recipient. */
  isEligibleForProperty(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    userId: UserId,
  ): Promise<boolean>
}>
