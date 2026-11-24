import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { commandHandler } from '#/shared/commands/command.server'
import { getContainer } from '#/composition'
import { portalCommandErrors } from './portal-command-errors'
import { requirePortalScope } from './portal-scope.server'

const listInput = z.object({ portalId: z.string().min(1) })
const updateInput = z.object({
  portalId: z.string().min(1),
  managerUserIds: z.array(z.string().min(1).max(255)).max(500),
  expectedRevision: z.number().int().positive(),
})

export const listPortalResponsibleManagers = createServerFn({ method: 'GET' })
  .validator(listInput)
  .handler(
    commandHandler(
      {
        method: 'GET',
        name: 'portal.listPortalResponsibleManagers',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requirePortalScope(ctx, data.portalId, 'portal.read')
        return await getContainer().portalPublicApi.management.listPortalResponsibleManagers(
          data,
          ctx,
        )
      },
    ),
  )

export const updatePortalResponsibleManagers = createServerFn({ method: 'POST' })
  .validator(updateInput)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.updatePortalResponsibleManagers',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requirePortalScope(ctx, data.portalId, 'portal.update')
        return await getContainer().portalPublicApi.management.updatePortalResponsibleManagers(
          data,
          ctx,
        )
      },
    ),
  )
