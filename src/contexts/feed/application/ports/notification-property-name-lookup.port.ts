import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

/**
 * The tenant-authored display name of a Property, for notices that have no
 * Inbox item to read it from (ADR 0046 r.8 admits property names).
 */
export type PropertyNameLookupPort = Readonly<{
  findPropertyName(
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<string | null>
}>
