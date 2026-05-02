import type { PublicPortalLoaderData } from '../dto/public-portal.dto'

export type PublicPortalLookup = Readonly<{
  findBySlug: (
    orgSlug: string,
    portalSlug: string,
  ) => Promise<PublicPortalLoaderData | null>
}>
