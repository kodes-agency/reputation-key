import type { PublicPortalData } from '../dto/public-portal.dto'

export type PublicPortalLookup = Readonly<{
  findByToken: (rawToken: string) => Promise<PublicPortalData | null>
}>
