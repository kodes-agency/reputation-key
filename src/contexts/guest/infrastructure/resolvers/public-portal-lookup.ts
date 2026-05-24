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
      try {
        const result = await portalApi.findPublicPortalBySlug(propertySlug, portalSlug)
        return result
      } catch (err) {
        // Re-throw domain errors from the portal public API
        if (
          err &&
          typeof err === 'object' &&
          '_tag' in err &&
          (err as { _tag: string })._tag === 'portal_inactive'
        ) {
          throw guestError('portal_inactive', 'Portal is inactive')
        }
        throw err
      }
    })
  },
})
