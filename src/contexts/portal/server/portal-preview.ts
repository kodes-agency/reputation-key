// Portal context — the editor's live preview read (server function).
// Thin: resolve auth, check the Portal's scope, call the use case, translate errors.

import { createServerFn } from '@tanstack/react-start'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { commandHandler } from '#/shared/commands/command.server'
import { getContainer } from '#/composition'
import { portalPreviewInputSchema } from '../application/dto/portal-preview.dto'
import { portalCommandErrors } from './portal-command-errors'
import { requirePortalScope } from './portal-scope.server'

export const getPortalPreview = createServerFn({ method: 'GET' })
  .validator(portalPreviewInputSchema)
  .handler(
    commandHandler(
      { method: 'GET', name: 'portal.getPortalPreview', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requirePortalScope(ctx, data.portalId, 'portal.read')
        return await getContainer().portalPublicApi.management.getPortalPreview(data, ctx)
      },
    ),
  )
