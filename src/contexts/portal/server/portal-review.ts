// Portal context — the Review & publish read (server function).
// Thin: resolve auth, check the Portal's scope, call the use case, translate
// errors. Publishing is `publishPortalChanges`, which asks the same questions
// again on the server.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { commandHandler } from '#/shared/commands/command.server'
import { getContainer } from '#/composition'
import { portalCommandErrors } from './portal-command-errors'
import { requirePortalScope } from './portal-scope.server'

const reviewInput = z.object({ portalId: z.string().min(1, 'Portal ID is required') })

/** The changes guests will see, what stops publishing, and how each language stands. */
export const getPortalReview = createServerFn({ method: 'GET' })
  .validator(reviewInput)
  .handler(
    commandHandler(
      { method: 'GET', name: 'portal.getPortalReview', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        const scope = await requirePortalScope(ctx, data.portalId, 'portal.read')
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
      },
    ),
  )
