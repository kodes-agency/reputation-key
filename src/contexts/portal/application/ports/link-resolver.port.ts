// Portal context — port for resolving a link by ID with its parent portal info.
// Used by guest context to resolve review links without direct DB access.

import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'

export type ResolvedLinkInfo = Readonly<{
  id: string
  url: string
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
}>

export type LinkResolverPort = Readonly<{
  resolveLinkById: (linkId: string) => Promise<ResolvedLinkInfo | null>
}>
