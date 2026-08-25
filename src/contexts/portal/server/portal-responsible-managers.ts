import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { portalId } from '#/shared/domain/ids'
import { isPortalError, portalError } from '../domain/errors'
import { portalErrorStatus } from './portals'
import { requirePortalResourceScope } from './property-scope'

const listInput = z.object({ portalId: z.string().min(1) })
const updateInput = z.object({
  portalId: z.string().min(1),
  managerUserIds: z.array(z.string().min(1).max(255)).max(500),
  expectedRevision: z.number().int().positive(),
})

function rethrow(error: unknown): never {
  if (isPortalError(error)) {
    throwContextError('PortalError', error, portalErrorStatus(error.code))
  }
  throw catchUntagged(error)
}

async function authorizePortal(
  ctx: Awaited<ReturnType<typeof resolveTenantContext>>,
  rawPortalId: string,
  action: 'portal.read' | 'portal.update',
): Promise<void> {
  await requirePortalResourceScope({
    actor: ctx,
    action,
    capability: action === 'portal.read' ? 'portal.read' : 'portal.write',
    notFound: portalError('portal_not_found', 'portal not found'),
    lookup: () =>
      getContainer().useCases.resolvePortalManagementScope(portalId(rawPortalId)),
  })
}

export const listPortalResponsibleManagers = createServerFn({ method: 'GET' })
  .validator(listInput)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        try {
          await authorizePortal(ctx, data.portalId, 'portal.read')
          return await getContainer().useCases.listPortalResponsibleManagers(data, ctx)
        } catch (error) {
          rethrow(error)
        }
      },
      'GET',
      'portal.listPortalResponsibleManagers',
    ),
  )

export const updatePortalResponsibleManagers = createServerFn({ method: 'POST' })
  .validator(updateInput)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        try {
          await authorizePortal(ctx, data.portalId, 'portal.update')
          return await getContainer().useCases.updatePortalResponsibleManagers(data, ctx)
        } catch (error) {
          rethrow(error)
        }
      },
      'POST',
      'portal.updatePortalResponsibleManagers',
    ),
  )
