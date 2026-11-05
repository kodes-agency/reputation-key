// Portal context — the editor's live preview read (server function).
// Thin: resolve auth, check the Portal's scope, call the use case, translate errors.

import { createServerFn } from '@tanstack/react-start'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { commandHandler } from '#/shared/commands/command.server'
import { getContainer } from '#/composition'
import { portalId } from '#/shared/domain/ids'
import { portalError } from '../domain/errors'
import { portalPreviewInputSchema } from '../application/dto/portal-preview.dto'
import { portalCommandErrors } from './portal-command-errors'
import { requirePortalResourceScope } from './property-scope'

export const getPortalPreview = createServerFn({ method: 'GET' })
  .validator(portalPreviewInputSchema)
  .handler(
    commandHandler(
      { method: 'GET', name: 'portal.getPortalPreview', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
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
        return await getContainer().portalPublicApi.management.getPortalPreview(data, ctx)
      },
    ),
  )
