// Portal context — the Property look (server functions).
// Thin: resolve auth, ask the Property's execution policy and the write
// capability, call the use case, translate errors. Reading the look is
// `getPropertyPortalExperience`; the public display name stays with
// `savePropertyPublicDisplayName`.

import { createServerFn } from '@tanstack/react-start'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import {
  propertyDefaultLocalesInputSchema,
  propertyHeroInputSchema,
  propertyLogoInputSchema,
  propertyLookInputSchema,
} from '../application/dto/property-look.dto'
import { isPortalError } from '../domain/errors'
import { portalErrorStatus } from './portals'

async function runLookCommand<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (isPortalError(error)) {
      throwContextError('PortalError', error, portalErrorStatus(error.code))
    }
    throw catchUntagged(error)
  }
}

/** Save the accent, background and wordmark guests see on every page of the Property. */
export const savePropertyLook = createServerFn({ method: 'POST' })
  .validator(propertyLookInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.update',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })
        return runLookCommand(() =>
          getContainer().portalPublicApi.management.savePropertyLook(data, ctx),
        )
      },
      'POST',
      'portal.savePropertyLook',
    ),
  )

/**
 * Put an uploaded photograph on the look, move where it is anchored, or take it
 * off. Attaching an image already stored is a Portals write: the upload endpoint
 * asked for `portal.upload` when the bytes arrived, and taking an image off must
 * keep working if uploads are ever switched off.
 */
export const savePropertyHero = createServerFn({ method: 'POST' })
  .validator(propertyHeroInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.update',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })
        return runLookCommand(() =>
          getContainer().portalPublicApi.management.savePropertyHero(data, ctx),
        )
      },
      'POST',
      'portal.savePropertyHero',
    ),
  )

/** Put an uploaded logo on the look, or take it off. */
export const savePropertyLogo = createServerFn({ method: 'POST' })
  .validator(propertyLogoInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.update',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })
        return runLookCommand(() =>
          getContainer().portalPublicApi.management.savePropertyLogo(data, ctx),
        )
      },
      'POST',
      'portal.savePropertyLogo',
    ),
  )

/** Choose the languages a new Portal of the Property starts with. */
export const savePropertyDefaultGuestLocales = createServerFn({ method: 'POST' })
  .validator(propertyDefaultLocalesInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.update',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })
        return runLookCommand(() =>
          getContainer().portalPublicApi.management.savePropertyDefaultGuestLocales(
            data,
            ctx,
          ),
        )
      },
      'POST',
      'portal.savePropertyDefaultGuestLocales',
    ),
  )
