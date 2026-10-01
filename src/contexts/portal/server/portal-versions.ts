// Portal context — the History tab's version reads (server functions).
// Thin: resolve auth, check the Portal's scope, call the use case, translate
// errors. Making a version live again is `rollbackPortalPublication`.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { readWithScope } from './portal-read-scope'

const portalInput = z.object({ portalId: z.string().min(1, 'Portal ID is required') })
const versionInput = portalInput.extend({ version: z.number().int().min(1) })

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
