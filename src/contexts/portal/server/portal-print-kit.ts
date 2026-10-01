// Portal context — the print kit's server functions (round 4, slice 45).
// Thin: resolve auth, check the Portal's scope, call the use case, translate errors.
//
// The read carries no address. The download does: it puts the code's address
// into a file, so it is a POST (the address never travels in a URL), marks the
// response uncacheable before anything can fail, spends the same rate limit as
// "Download again", and reaches the use case, which records the disclosure.

import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import type { AuthContext } from '#/shared/domain/auth-context'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { portalId } from '#/shared/domain/ids'
import type { Capability } from '#/shared/auth/beta-capabilities'
import type { Permission } from '#/shared/domain/permissions'
import {
  downloadPortalPrintKitInputSchema,
  portalPrintKitInputSchema,
} from '../application/dto/portal-print-kit.dto'
import { printKitDownloadOf } from '../application/use-cases/create-portal-print-kit'
import { isPortalError, portalError } from '../domain/errors'
import { portalErrorStatus } from './portals'
import { checkPortalAddressRateLimit } from './portal-address-rate-limit.server'
import { requirePortalResourceScope } from './property-scope'

async function authorize(
  ctx: AuthContext,
  rawPortalId: string,
  action: Permission,
  capability: Capability,
): Promise<void> {
  await requirePortalResourceScope({
    actor: ctx,
    action,
    capability,
    notFound: portalError('portal_not_found', 'portal not found'),
    lookup: () =>
      getContainer().portalPublicApi.management.resolvePortalManagementScope(
        portalId(rawPortalId),
      ),
  })
}

/** The file contains the live code's address: nothing in the path may keep a copy. */
function disableFileCaching(): void {
  setResponseHeader('Cache-Control', 'private, no-store, max-age=0')
  setResponseHeader('Pragma', 'no-cache')
  setResponseHeader('Expires', '0')
}

export const getPortalPrintKit = createServerFn({ method: 'GET' })
  .validator(portalPrintKitInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        try {
          await authorize(ctx, data.portalId, 'portal.read', 'portal.read')
          return await getContainer().portalPublicApi.management.getPortalPrintKit(
            data,
            ctx,
          )
        } catch (error) {
          if (isPortalError(error)) {
            throwContextError('PortalError', error, portalErrorStatus(error.code))
          }
          throw catchUntagged(error)
        }
      },
      'GET',
      'portal.getPortalPrintKit',
    ),
  )

export const downloadPortalPrintKit = createServerFn({ method: 'POST' })
  .validator(downloadPortalPrintKitInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        disableFileCaching()
        const ctx = await resolveTenantContext(await headersFromContext())
        try {
          await authorize(ctx, data.portalId, 'portal.update', 'portal.write')
          const container = getContainer()
          const limited = await checkPortalAddressRateLimit({
            rateLimiter: container.rateLimiter,
            actorId: ctx.userId,
            organizationId: ctx.organizationId,
          })
          if (limited) throw limited
          const file = await container.portalPublicApi.management.createPortalPrintKit(
            data,
            ctx,
          )
          return printKitDownloadOf(file)
        } catch (error) {
          if (isPortalError(error)) {
            throwContextError('PortalError', error, portalErrorStatus(error.code))
          }
          throw catchUntagged(error)
        }
      },
      'POST',
      'portal.downloadPortalPrintKit',
    ),
  )
