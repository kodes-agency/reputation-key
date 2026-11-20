import type { PublicPortalData } from './public-portal.contracts'

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
