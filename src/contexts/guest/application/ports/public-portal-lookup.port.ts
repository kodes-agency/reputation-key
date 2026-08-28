import type { PublicPortalData } from '../dto/public-portal.dto'

export type PublicPortalLookup = Readonly<{
  findByToken: (
    rawToken: string,
    preference?: Readonly<{
      requestedLocale?: string | null
      sessionLocale?: string | null
      acceptLanguage?: string | null
    }>,
  ) => Promise<PublicPortalData | null>
}>
