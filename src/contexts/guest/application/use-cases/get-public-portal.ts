import type { PublicPortalLookup } from '../ports/public-portal-lookup.port'
import { guestError } from '../../domain/errors'

export type GetPublicPortalDeps = Readonly<{
  publicPortalLookup: PublicPortalLookup
}>

export type GetPublicPortalInput = Readonly<{
  token: string
  requestedLocale?: string | null
  sessionLocale?: string | null
  acceptLanguage?: string | null
}>

export const getPublicPortal =
  (deps: GetPublicPortalDeps) => async (input: GetPublicPortalInput) => {
    const result = await deps.publicPortalLookup.findByToken(input.token, {
      requestedLocale: input.requestedLocale,
      sessionLocale: input.sessionLocale,
      acceptLanguage: input.acceptLanguage,
    })
    if (!result) {
      throw guestError('portal_not_found', 'Portal not found')
    }
    return result
  }

export type GetPublicPortal = ReturnType<typeof getPublicPortal>
