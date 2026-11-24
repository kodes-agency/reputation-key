import type { PortalPublicApi } from '#/contexts/portal/public-api'
import { trace } from '#/shared/observability/trace'
import { guestError } from '../domain/errors'

export type GetPublicPortalDeps = Readonly<{
  findPublicPortalByToken: PortalPublicApi['findPublicPortalByToken']
}>

export type GetPublicPortalInput = Readonly<{
  token: string
  requestedLocale?: string | null
  sessionLocale?: string | null
  acceptLanguage?: string | null
}>

export const getPublicPortal =
  (deps: GetPublicPortalDeps) => async (input: GetPublicPortalInput) =>
    trace('publicPortal.findByToken', async () => {
      const outcome = await deps.findPublicPortalByToken(input.token, {
        requestedLocale: input.requestedLocale,
        sessionLocale: input.sessionLocale,
        acceptLanguage: input.acceptLanguage,
      })
      if (outcome.status !== 'found') {
        throw guestError('portal_not_found', 'Portal not found')
      }
      return outcome.result
    })

export type GetPublicPortal = ReturnType<typeof getPublicPortal>
