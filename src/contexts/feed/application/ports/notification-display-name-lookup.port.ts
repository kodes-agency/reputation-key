import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

/**
 * Tenant-authored display names for notices that have nothing else to read
 * them from (ADR 0046 r.8 admits Property and Organization names).
 */
export type DisplayNameLookupPort = Readonly<{
  findPropertyName(
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<string | null>
  findOrganizationName(organizationId: OrganizationId): Promise<string | null>
}>
