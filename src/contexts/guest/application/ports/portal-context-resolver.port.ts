import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'

/** Resolved portal context — the org and property a portal belongs to. */
export type PortalContext = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
}>

/** Port for resolving portal context without coupling to Drizzle. */
export type PortalContextResolver = Readonly<{
  resolve: (portalId: PortalId) => Promise<PortalContext | null>
}>
