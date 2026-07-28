import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import type { PublicPortalLookup } from '../../application/ports/public-portal-lookup.port'
import { guestError } from '../../domain/errors'
import { trace } from '#/shared/observability/trace'
export const createPublicPortalLookup = (
  portalApi: PortalPublicApi,
): PublicPortalLookup => ({
  // PUBLIC API — no organizationId scoping by design.
  // These resolvers serve unauthenticated guest requests where the
  // link/portal ID acts as a capability token (unguessable UUID).
  findBySlug: async (propertySlug: string, portalSlug: string) => {
    return trace('publicPortal.findBySlug', async () => {
      // BQC-5.6: the portal public-api owns the inactive/not-found mapping
      // and returns a typed outcome union — no portal domain error imports
      // here. 'inactive' becomes guestError('portal_inactive') so the
      // server fn surfaces a 410 instead of a 500.
      const outcome = await portalApi.findPublicPortalBySlug(propertySlug, portalSlug)
      if (outcome.status === 'inactive') {
        throw guestError('portal_inactive', 'Portal is inactive')
      }
      if (outcome.status === 'not_found') return null
      return outcome.result
    })
  },
})
