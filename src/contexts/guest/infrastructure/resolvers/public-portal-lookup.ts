import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import type { PublicPortalLookup } from '../../application/ports/public-portal-lookup.port'
import { trace } from '#/shared/observability/trace'
export const createPublicPortalLookup = (
  portalApi: PortalPublicApi,
): PublicPortalLookup => ({
  findByToken: async (rawToken) =>
    trace('publicPortal.findByToken', async () => {
      const outcome = await portalApi.findPublicPortalByToken(rawToken)
      return outcome.status === 'found' ? outcome.result : null
    }),
})
