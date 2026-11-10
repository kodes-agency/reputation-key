// Portal context — publish changes while live (server functions).
// Thin: resolve auth, check each Portal's scope and the write capability, call
// the use case, translate errors. A Portal that is not live goes live through
// `publishPortal`; these are for a Portal that already is.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { commandHandler } from '#/shared/commands/command.server'
import { getContainer } from '#/composition'
import { portalId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  publishPortalChangesInputSchema,
  publishPortalsChangesInputSchema,
} from '../application/dto/publish-portal-changes.dto'
import { isPortalError, portalError } from '../domain/errors'
import { portalCommandErrors } from './portal-command-errors'
import { requirePortalResourceScope } from './property-scope'

/**
 * Every Portal the request names must be one this actor may change, checked
 * before anything is written.
 * One Portal outside the actor's scope (`forbidden`) refuses the whole request.
 * With `missingIsPerPortal`, a Portal that no longer exists (deleted or
 * archived since a screen listed it) is not refused here: the use case reports
 * it as that Portal's own `failed` outcome and publishes the others.
 */
async function writeWithScope<T>(
  ctx: AuthContext,
  ids: ReadonlyArray<string>,
  write: () => Promise<T>,
  options: Readonly<{ missingIsPerPortal?: boolean }> = {},
): Promise<T> {
  for (const id of ids) {
    try {
      await requirePortalResourceScope({
        actor: ctx,
        action: 'portal.update',
        capability: 'portal.write',
        notFound: portalError('portal_not_found', 'portal not found'),
        lookup: () =>
          getContainer().portalPublicApi.management.resolvePortalManagementScope(
            portalId(id),
          ),
      })
    } catch (error) {
      const isMissing = isPortalError(error) && error.code === 'portal_not_found'
      if (!(options.missingIsPerPortal && isMissing)) throw error
    }
  }
  return await write()
}

/** Replace the live version of one Portal with its current draft, or do nothing if nothing is pending. */
export const publishPortalChanges = createServerFn({ method: 'POST' })
  .validator(publishPortalChangesInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.publishPortalChanges',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        return writeWithScope(ctx, [data.portalId], () =>
          getContainer().portalPublicApi.management.publishPortalChanges(data, ctx),
        )
      },
    ),
  )

/** The same for several Portals in turn (a Property-look change), with the outcome of each. */
export const publishPortalsChanges = createServerFn({ method: 'POST' })
  .validator(publishPortalsChangesInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.publishPortalsChanges',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        return writeWithScope(
          ctx,
          [...new Set(data.portals.map((portal) => portal.portalId))],
          () =>
            getContainer().portalPublicApi.management.publishPortalsChanges(data, ctx),
          { missingIsPerPortal: true },
        )
      },
    ),
  )

/** A person's guest page takes over a Portal's wording, links and look, and goes live. */
export const updatePersonalGuestPage = createServerFn({ method: 'POST' })
  .validator(z.object({ portalId: z.uuid(), sourcePortalId: z.uuid() }).strict())
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.updatePersonalGuestPage',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        return writeWithScope(ctx, [data.portalId], () =>
          getContainer().portalPublicApi.management.updatePersonalGuestPage(data, ctx),
        )
      },
    ),
  )
