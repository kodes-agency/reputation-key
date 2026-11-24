import type { PortalPublicApi } from '#/contexts/portal/public-api'
import { trace } from '#/shared/observability/trace'
import { guestError } from '../domain/errors'

export type GetPublicPortalDeps = Readonly<{
  findPublicPortalByToken: PortalPublicApi['findPublicPortalByToken']
}>

export type GetPublicPortalInput = Readonly<{
  token: string
  /**
   * Supplies the language preference once the token is admitted, so a signed
   * session can be verified against the admitted scope in the same resolution.
   */
  preference?: Parameters<PortalPublicApi['findPublicPortalByToken']>[1]
}>

export const getPublicPortal =
  (deps: GetPublicPortalDeps) => async (input: GetPublicPortalInput) =>
    trace('publicPortal.findByToken', async () => {
      const outcome = await deps.findPublicPortalByToken(input.token, input.preference)
      if (outcome.status !== 'found') {
        throw guestError('portal_not_found', 'Portal not found')
      }
      return outcome.result
    })

export type GetPublicPortal = ReturnType<typeof getPublicPortal>
