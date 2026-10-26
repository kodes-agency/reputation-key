// Portal context — a Portal's own look (server functions, ADR 0070).
// Thin: resolve auth, ask the Property's execution policy and the write
// capability, call the use case, translate errors. Reading the Portal's look is
// `getPropertyPortalExperience` with a portalId; the images arrive through the
// upload endpoint, as the Property look's do.

import { createServerFn } from '@tanstack/react-start'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import type { AuthContext } from '#/shared/domain/auth-context'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import {
  portalLookColoursInputSchema,
  portalLookIdentityInputSchema,
  portalLookPhotoInputSchema,
} from '../application/dto/portal-look.dto'
import { isPortalError } from '../domain/errors'
import { portalErrorStatus } from './portals'

type Management = ReturnType<typeof getContainer>['portalPublicApi']['management']

/**
 * The Property's policy for a Portals write, then the use case as the resolved
 * actor, with a Portal error carried out tagged and with its status.
 */
async function runPortalLookCommand<T>(
  propertyId: string,
  command: (management: Management, ctx: AuthContext) => Promise<T>,
): Promise<T> {
  const ctx = await resolveTenantContext(await headersFromContext())
  await requireExecutionAllowed({
    actor: ctx,
    action: 'portal.update',
    capability: 'portal.write',
    propertyId,
  })
  try {
    return await command(getContainer().portalPublicApi.management, ctx)
  } catch (error) {
    if (isPortalError(error)) {
      throwContextError('PortalError', error, portalErrorStatus(error.code))
    }
    throw catchUntagged(error)
  }
}

/** Give one Portal its own accent and background, or put them back to the Property's. */
export const savePortalLookColours = createServerFn({ method: 'POST' })
  .validator(portalLookColoursInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        runPortalLookCommand(data.propertyId, (management, ctx) =>
          management.savePortalLookColours(data, ctx),
        ),
      'POST',
      'portal.savePortalLookColours',
    ),
  )

/** Give one Portal its own wordmark and logo, or put them back to the Property's. */
export const savePortalLookIdentity = createServerFn({ method: 'POST' })
  .validator(portalLookIdentityInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        runPortalLookCommand(data.propertyId, (management, ctx) =>
          management.savePortalLookIdentity(data, ctx),
        ),
      'POST',
      'portal.savePortalLookIdentity',
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
    tracedHandler(
      async ({ data }) =>
        runPortalLookCommand(data.propertyId, (management, ctx) =>
          management.savePortalLookPhoto(data, ctx),
        ),
      'POST',
      'portal.savePortalLookPhoto',
    ),
  )
