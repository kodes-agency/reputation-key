// Portal context — the Review & publish read (server function).
// Thin: resolve auth, check the Portal's scope, call the use case, translate
// errors. Publishing is `publishPortalChanges`, which asks the same questions
// again on the server.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { portalId } from '#/shared/domain/ids'
import { isPortalError, portalError } from '../domain/errors'
import { portalErrorStatus } from './portals'
import { requirePortalResourceScope } from './property-scope'

const reviewInput = z.object({ portalId: z.string().min(1, 'Portal ID is required') })

/** The changes guests will see, what stops publishing, and how each language stands. */
export const getPortalReview = createServerFn({ method: 'GET' })
  .validator(reviewInput)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        try {
          const scope = await requirePortalResourceScope({
            actor: ctx,
            action: 'portal.read',
            capability: 'portal.read',
            notFound: portalError('portal_not_found', 'portal not found'),
            lookup: () =>
              getContainer().portalPublicApi.management.resolvePortalManagementScope(
                portalId(data.portalId),
              ),
          })
          // Publishing is gated on `portal.update` and the `portal.write`
          // capability; reading is not. The read itself checks the role, and
          // this adds the capability, so the page never offers a closed button.
          const mayPublish = await requireExecutionAllowed({
            actor: ctx,
            action: 'portal.update',
            capability: 'portal.write',
            propertyId: scope.propertyId,
          }).then(
            () => true,
            () => false,
          )
          return await getContainer().portalPublicApi.management.getPortalReview(
            { ...data, mayPublish },
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
      'portal.getPortalReview',
    ),
  )
