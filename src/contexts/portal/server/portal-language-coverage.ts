// Portal context — the Languages section's coverage read (server function).
// Thin: resolve auth, check the Portal's scope, call the use case, translate errors.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { commandHandler } from '#/shared/commands/command.server'
import { getContainer } from '#/composition'
import { portalCommandErrors } from './portal-command-errors'
import { requirePortalScope } from './portal-scope.server'

const coverageInput = z.object({ portalId: z.string().min(1, 'Portal ID is required') })

export const getPortalLanguageCoverage = createServerFn({ method: 'GET' })
  .validator(coverageInput)
  .handler(
    commandHandler(
      {
        method: 'GET',
        name: 'portal.getPortalLanguageCoverage',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requirePortalScope(ctx, data.portalId, 'portal.read')
        return await getContainer().portalPublicApi.management.getPortalLanguageCoverage(
          data,
          ctx,
        )
      },
    ),
  )
