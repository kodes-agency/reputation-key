// Portal context — the Property look (server functions).
// Thin: resolve auth, ask the Property's execution policy and the write
// capability, call the use case, translate errors. Reading the look is
// `getPropertyPortalExperience`; the public display name stays with
// `savePropertyPublicDisplayName`.

import { createServerFn } from '@tanstack/react-start'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { commandHandler } from '#/shared/commands/command.server'
import { getContainer } from '#/composition'
import {
  propertyDefaultLocalesInputSchema,
  propertyHeroInputSchema,
  propertyLogoInputSchema,
  propertyLookInputSchema,
} from '../application/dto/property-look.dto'
import { portalCommandErrors } from './portal-command-errors'

/** Save the accent, background and wordmark guests see on every page of the Property. */
export const savePropertyLook = createServerFn({ method: 'POST' })
  .validator(propertyLookInputSchema)
  .handler(
    commandHandler(
      { method: 'POST', name: 'portal.savePropertyLook', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.update',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })
        return getContainer().portalPublicApi.management.savePropertyLook(data, ctx)
      },
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
    commandHandler(
      { method: 'POST', name: 'portal.savePropertyHero', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.update',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })
        return getContainer().portalPublicApi.management.savePropertyHero(data, ctx)
      },
    ),
  )

/** Put an uploaded logo on the look, or take it off. */
export const savePropertyLogo = createServerFn({ method: 'POST' })
  .validator(propertyLogoInputSchema)
  .handler(
    commandHandler(
      { method: 'POST', name: 'portal.savePropertyLogo', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.update',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })
        return getContainer().portalPublicApi.management.savePropertyLogo(data, ctx)
      },
    ),
  )

/** Choose the languages a new Portal of the Property starts with. */
export const savePropertyDefaultGuestLocales = createServerFn({ method: 'POST' })
  .validator(propertyDefaultLocalesInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.savePropertyDefaultGuestLocales',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.update',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })
        return getContainer().portalPublicApi.management.savePropertyDefaultGuestLocales(
          data,
          ctx,
        )
      },
    ),
  )
