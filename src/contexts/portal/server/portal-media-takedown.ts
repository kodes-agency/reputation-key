// Portal context — take an uploaded image down (server function).
// Thin: resolve auth, check the capability, call the use case, translate errors.
//
// Gated on `portal.write`, not `portal.upload`: removing an image must keep
// working when uploads are switched off, which is exactly when it matters most.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { commandHandler } from '#/shared/commands/command.server'
import { getContainer } from '#/composition'
import { portalCommandErrors } from './portal-command-errors'

const takeDownInput = z.object({ assetId: z.uuid() })

export const takeDownPortalMedia = createServerFn({ method: 'POST' })
  .validator(takeDownInput)
  .handler(
    commandHandler(
      { method: 'POST', name: 'portal.takeDownPortalMedia', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.admin',
          capability: 'portal.write',
        })
        return await getContainer().portalPublicApi.management.takeDownPortalMedia(
          data,
          ctx,
        )
      },
    ),
  )
