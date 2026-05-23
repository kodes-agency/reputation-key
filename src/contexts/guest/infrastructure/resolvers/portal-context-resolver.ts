import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import type { PortalContextResolver } from '../../application/ports/portal-context-resolver.port'
import type { PortalId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

export const createPortalContextResolver = (
  portalApi: PortalPublicApi,
): PortalContextResolver => ({
  // PUBLIC API — no organizationId scoping by design.
  // These resolvers serve unauthenticated guest requests where the
  // portal ID acts as a capability token (unguessable UUID).
  resolve: async (portalId: PortalId) => {
    return trace('portalContext.resolve', async () => {
      return portalApi.resolvePortalContext(portalId)
    })
  },
})
