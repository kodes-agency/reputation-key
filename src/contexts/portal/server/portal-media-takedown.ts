// Portal context — take an uploaded image down (server function).
// Thin: resolve auth, check the capability, call the use case, translate errors.
//
// Gated on `portal.write`, not `portal.upload`: removing an image must keep
// working when uploads are switched off, which is exactly when it matters most.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { isPortalError } from '../domain/errors'
import { portalErrorStatus } from './portals'

const takeDownInput = z.object({ assetId: z.uuid() })

export const takeDownPortalMedia = createServerFn({ method: 'POST' })
  .validator(takeDownInput)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.admin',
          capability: 'portal.write',
        })
        try {
          return await getContainer().portalPublicApi.management.takeDownPortalMedia(
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
      'POST',
      'portal.takeDownPortalMedia',
    ),
  )
