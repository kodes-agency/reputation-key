import type { PortalPublicApi } from '#/contexts/portal/public-api'
import type { PublicPortalLookup } from './public-portal-lookup.port.server'
import { trace } from '#/shared/observability/trace'
export const createPublicPortalLookup = (
  portalApi: PortalPublicApi,
): PublicPortalLookup => ({
  findByToken: async (rawToken, preference) =>
    trace('publicPortal.findByToken', async () => {
      const outcome = await portalApi.findPublicPortalByToken(rawToken, preference)
      return outcome.status === 'found' ? outcome.result : null
    }),
})
