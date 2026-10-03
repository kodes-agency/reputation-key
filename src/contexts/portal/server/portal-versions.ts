// Portal context — the History tab's version reads (server functions).
// Thin: resolve auth, check the Portal's scope, call the use case, translate
// errors. Making a version live again is `rollbackPortalPublication`.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { portalId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { isPortalError, portalError } from '../domain/errors'
import { portalErrorStatus } from './portals'
import { requirePortalResourceScope } from './property-scope'

const portalInput = z.object({ portalId: z.string().min(1, 'Portal ID is required') })
const versionInput = portalInput.extend({ version: z.number().int().min(1) })

/** The read scope every History read asks for, then the read itself, with errors translated. */
async function readWithScope<T>(
  ctx: AuthContext,
  id: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    await requirePortalResourceScope({
      actor: ctx,
      action: 'portal.read',
      capability: 'portal.read',
      notFound: portalError('portal_not_found', 'portal not found'),
      lookup: () =>
        getContainer().portalPublicApi.management.resolvePortalManagementScope(
          portalId(id),
        ),
    })
    return await read()
  } catch (error) {
    if (isPortalError(error)) {
      throwContextError('PortalError', error, portalErrorStatus(error.code))
    }
    throw catchUntagged(error)
  }
}

/** Every published version of the Portal, newest first, with what each added. */
export const getPortalVersions = createServerFn({ method: 'GET' })
  .validator(portalInput)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        return readWithScope(ctx, data.portalId, () =>
          getContainer().portalPublicApi.management.getPortalVersions(data, ctx),
        )
      },
      'GET',
      'portal.getPortalVersions',
    ),
  )

/** One version: what it shows guests and what making it live would change. */
export const getPortalVersion = createServerFn({ method: 'GET' })
  .validator(versionInput)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        return readWithScope(ctx, data.portalId, () =>
          getContainer().portalPublicApi.management.getPortalVersion(data, ctx),
        )
      },
      'GET',
      'portal.getPortalVersion',
    ),
  )

/** The guest page of one published version, drawn the way the live preview draws it. */
export const getPortalVersionPreview = createServerFn({ method: 'GET' })
  .validator(versionInput)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        return readWithScope(ctx, data.portalId, () =>
          getContainer().portalPublicApi.management.getPortalVersionPreview(data, ctx),
        )
      },
      'GET',
      'portal.getPortalVersionPreview',
    ),
  )
