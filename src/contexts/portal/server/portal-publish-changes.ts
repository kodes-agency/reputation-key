// Portal context — publish changes while live (server functions).
// Thin: resolve auth, check each Portal's scope and the write capability, call
// the use case, translate errors. A Portal that is not live goes live through
// `updatePortal`; these are for a Portal that already is.

import { createServerFn } from '@tanstack/react-start'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { portalId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  publishPortalChangesInputSchema,
  publishPortalsChangesInputSchema,
} from '../application/dto/publish-portal-changes.dto'
import { isPortalError, portalError } from '../domain/errors'
import { portalErrorStatus } from './portals'
import { requirePortalResourceScope } from './property-scope'

/**
 * Every Portal the request names must be one this actor may change, checked
 * before anything is written; then the work itself, with errors translated.
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
  try {
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
  } catch (error) {
    if (isPortalError(error)) {
      throwContextError('PortalError', error, portalErrorStatus(error.code))
    }
    throw catchUntagged(error)
  }
}

/** Replace the live version of one Portal with its current draft, or do nothing if nothing is pending. */
export const publishPortalChanges = createServerFn({ method: 'POST' })
  .validator(publishPortalChangesInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        return writeWithScope(ctx, [data.portalId], () =>
          getContainer().portalPublicApi.management.publishPortalChanges(data, ctx),
        )
      },
      'POST',
      'portal.publishPortalChanges',
    ),
  )

/** The same for several Portals in turn (a Property-look change), with the outcome of each. */
export const publishPortalsChanges = createServerFn({ method: 'POST' })
  .validator(publishPortalsChangesInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        return writeWithScope(
          ctx,
          [...new Set(data.portalIds)],
          () =>
            getContainer().portalPublicApi.management.publishPortalsChanges(data, ctx),
          { missingIsPerPortal: true },
        )
      },
      'POST',
      'portal.publishPortalsChanges',
    ),
  )
