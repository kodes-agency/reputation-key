import type { PublicPortalLoaderData } from '../dto/public-portal.dto'

export type PublicPortalLookup = Readonly<{
  findBySlug: (
    propertySlug: string,
    portalSlug: string,
  ) => Promise<PublicPortalLoaderData | null>
}>
