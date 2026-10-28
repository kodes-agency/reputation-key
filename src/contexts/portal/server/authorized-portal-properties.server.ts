// Server-only: the Properties whose Portals this reader may see. A plain
// function over the container, so it lives in a `*.server.ts` file: exported
// from a server-function file it would drag the composition root into every
// client chunk that imports a server function from there.
import { getContainer } from '#/composition'
import { getExecutionPolicy } from '#/shared/auth/execution-policy'
import type { AuthContext } from '#/shared/domain/auth-context'

/**
 * The Properties that hold a Portal and whose execution policy lets this reader
 * `portal.read` them: the narrowing `listPortals`, `listPortalOverview` and the
 * presence read all start from.
 */
export async function listAuthorizedPortalPropertyIds(
  ctx: AuthContext,
): Promise<readonly string[]> {
  const container = getContainer()
  const { management: useCases } = container.portalPublicApi
  const { clock } = container
  const propertyIds = await useCases.listPortalManagementPropertyIds(ctx.organizationId)
  const observedAt = clock()
  const decisions = await Promise.all(
    propertyIds.map(async (propertyId) => ({
      propertyId,
      decision: await getExecutionPolicy().decide({
        principal: { kind: 'user', ctx },
        action: 'portal.read',
        capability: 'portal.read',
        organizationId: ctx.organizationId,
        propertyId,
        executionKind: 'interactive',
        now: observedAt,
      }),
    })),
  )
  return decisions
    .filter(({ decision }) => decision.allowed)
    .map(({ propertyId }) => propertyId)
}
