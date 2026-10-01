// Portal context — the Languages section's coverage read (server function).
// Thin: resolve auth, check the Portal's scope, call the use case, translate errors.

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

const coverageInput = z.object({ portalId: z.string().min(1, 'Portal ID is required') })

export const getPortalLanguageCoverage = createServerFn({ method: 'GET' })
  .validator(coverageInput)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        try {
          await requirePortalResourceScope({
            actor: ctx,
            action: 'portal.read',
            capability: 'portal.read',
            notFound: portalError('portal_not_found', 'portal not found'),
            lookup: () =>
              getContainer().portalPublicApi.management.resolvePortalManagementScope(
                portalId(data.portalId),
              ),
          })
          return await getContainer().portalPublicApi.management.getPortalLanguageCoverage(
            data,
            ctx,
          )
        } catch (error) {
          if (isPortalError(error)) {
            throwContextError('PortalError', error, portalErrorStatus(error.code))
          }
          throw catchUntagged(error)
        }
      },
      'GET',
      'portal.getPortalLanguageCoverage',
    ),
  )
