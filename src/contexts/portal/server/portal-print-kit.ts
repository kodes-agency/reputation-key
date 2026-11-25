// The print preview read carries no address and does not spend the disclosure limit.

import { createServerFn } from '@tanstack/react-start'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { portalPrintKitInputSchema } from '../printing/portal-print-kit.contracts'
import { isPortalError } from '../domain/errors'
import { portalErrorStatus } from './portals'
import { requirePortalScope } from './portal-scope.server'

export const getPortalPrintKit = createServerFn({ method: 'GET' })
  .validator(portalPrintKitInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        try {
          await requirePortalScope(ctx, data.portalId, 'portal.read')
          return await getContainer().portalPublicApi.management.getPortalPrintKit(
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
      'portal.getPortalPrintKit',
    ),
  )
