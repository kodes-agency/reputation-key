// The print preview read carries no address and does not spend the disclosure limit.

import { createServerFn } from '@tanstack/react-start'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { portalPrintKitInputSchema } from '../application/dto/portal-print-kit.dto'
import { isPortalError } from '../domain/errors'
import { portalErrorStatus } from './portals'
import { portalPrintScope } from './portal-print-file.server'
import { requirePortalResourceScope } from './property-scope'

export const getPortalPrintKit = createServerFn({ method: 'GET' })
  .validator(portalPrintKitInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        try {
          await requirePortalResourceScope({
            actor: ctx,
            action: 'portal.read',
            capability: 'portal.read',
            ...portalPrintScope(data.portalId),
          })
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
