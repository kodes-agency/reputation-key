// Portal context — the History tab's version reads (server functions).
// Thin: resolve auth, check the Portal's scope, call the use case, translate
// errors. Making a version live again is `rollbackPortalPublication`.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { commandHandler } from '#/shared/commands/command.server'
import { getContainer } from '#/composition'
import { portalId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../domain/errors'
import { portalCommandErrors } from './portal-command-errors'
import { requirePortalResourceScope } from './property-scope'

const portalInput = z.object({ portalId: z.string().min(1, 'Portal ID is required') })
const versionInput = portalInput.extend({ version: z.number().int().min(1) })

/** Every History read requires the same Portal scope before reading a version. */
async function readWithScope<T>(
  ctx: AuthContext,
  id: string,
  read: () => Promise<T>,
): Promise<T> {
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
}

/** Every published version of the Portal, newest first, with what each added. */
export const getPortalVersions = createServerFn({ method: 'GET' })
  .validator(portalInput)
  .handler(
    commandHandler(
      { method: 'GET', name: 'portal.getPortalVersions', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        return readWithScope(ctx, data.portalId, () =>
          getContainer().portalPublicApi.management.getPortalVersions(data, ctx),
        )
      },
    ),
  )

/** One version: what it shows guests and what making it live would change. */
export const getPortalVersion = createServerFn({ method: 'GET' })
  .validator(versionInput)
  .handler(
    commandHandler(
      { method: 'GET', name: 'portal.getPortalVersion', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        return readWithScope(ctx, data.portalId, () =>
          getContainer().portalPublicApi.management.getPortalVersion(data, ctx),
        )
      },
    ),
  )

/** The guest page of one published version, drawn the way the live preview draws it. */
export const getPortalVersionPreview = createServerFn({ method: 'GET' })
  .validator(versionInput)
  .handler(
    commandHandler(
      {
        method: 'GET',
        name: 'portal.getPortalVersionPreview',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        return readWithScope(ctx, data.portalId, () =>
          getContainer().portalPublicApi.management.getPortalVersionPreview(data, ctx),
        )
      },
    ),
  )
