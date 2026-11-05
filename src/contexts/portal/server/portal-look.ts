// Portal context — a Portal's own look (server functions, ADR 0070).
// Thin: resolve auth, ask the Property's execution policy and the write
// capability, call the use case, translate errors. Reading the Portal's look is
// `getPropertyPortalExperience` with a portalId; the images arrive through the
// upload endpoint, as the Property look's do.

import { createServerFn } from '@tanstack/react-start'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { resolveTenantContext } from '#/shared/auth/middleware'
import type { AuthContext } from '#/shared/domain/auth-context'
import { commandHandler } from '#/shared/commands/command.server'
import { getContainer } from '#/composition'
import {
  portalLookColoursInputSchema,
  portalLookIdentityInputSchema,
  portalLookPhotoInputSchema,
} from '../application/dto/portal-look.dto'
import { portalCommandErrors } from './portal-command-errors'

async function runPortalLookCommand<T>(
  propertyId: string,
  headers: Headers,
  command: (ctx: AuthContext) => Promise<T>,
): Promise<T> {
  const ctx = await resolveTenantContext(headers)
  await requireExecutionAllowed({
    actor: ctx,
    action: 'portal.update',
    capability: 'portal.write',
    propertyId,
  })
  return await command(ctx)
}

/** Give one Portal its own accent and background, or put them back to the Property's. */
export const savePortalLookColours = createServerFn({ method: 'POST' })
  .validator(portalLookColoursInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.savePortalLookColours',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) =>
        runPortalLookCommand(data.propertyId, headers, (ctx) =>
          getContainer().portalPublicApi.management.savePortalLookColours(data, ctx),
        ),
    ),
  )

/** Give one Portal its own wordmark and logo, or put them back to the Property's. */
export const savePortalLookIdentity = createServerFn({ method: 'POST' })
  .validator(portalLookIdentityInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.savePortalLookIdentity',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) =>
        runPortalLookCommand(data.propertyId, headers, (ctx) =>
          getContainer().portalPublicApi.management.savePortalLookIdentity(data, ctx),
        ),
    ),
  )

/**
 * Give one Portal its own photo, move where it is anchored or describe it, show
 * no photo on it, or put it back to the Property's. Pointing at an image already
 * stored is a Portals write: the upload endpoint asked for `portal.upload` when
 * the bytes arrived.
 */
export const savePortalLookPhoto = createServerFn({ method: 'POST' })
  .validator(portalLookPhotoInputSchema)
  .handler(
    commandHandler(
      { method: 'POST', name: 'portal.savePortalLookPhoto', errors: portalCommandErrors },
      async ({ data, headers }) =>
        runPortalLookCommand(data.propertyId, headers, (ctx) =>
          getContainer().portalPublicApi.management.savePortalLookPhoto(data, ctx),
        ),
    ),
  )
