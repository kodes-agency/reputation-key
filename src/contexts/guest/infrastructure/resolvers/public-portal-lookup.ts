import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import type { PublicPortalLookup } from '../../application/ports/public-portal-lookup.port'
import { guestError } from '../../domain/errors'
import { isPortalError } from '#/contexts/portal/application/public-api'
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
        // The portal repo throws portalError('portal_inactive', …) whose _tag
        // is 'PortalError' (the inactive case is a *code*, not the _tag).
        // Map it to a GuestError so the server fn surfaces a 410 instead of a
        // 500 (the old _tag comparison never matched and fell through).
        if (isPortalError(err) && err.code === 'portal_inactive') {
          throw guestError('portal_inactive', 'Portal is inactive')
        }
        throw err
      }
    })
  },
})
