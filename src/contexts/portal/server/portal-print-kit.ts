// Portal context — the print kit's server functions (round 4, slice 45).
// Thin: resolve auth, check the Portal's scope, call the use case, translate errors.
//
// The read carries no address. The download does: it puts the code's address
// into a file, so it is a POST (the address never travels in a URL), marks the
// response uncacheable before anything can fail, spends the same rate limit as
// "Download again", and reaches the use case, which records the disclosure. The
// guards live in `portal-print-file.server.ts`, shared with the final kit's
// download (`portal-print-final.ts`).

import { createServerFn } from '@tanstack/react-start'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import {
  downloadPortalPrintKitInputSchema,
  portalPrintKitInputSchema,
} from '../application/dto/portal-print-kit.dto'
import { isPortalError } from '../domain/errors'
import { portalErrorStatus } from './portals'
import { downloadPortalPrintFile, portalPrintScope } from './portal-print-file.server'
import { requirePortalResourceScope } from './property-scope'

export const getPortalPrintKit = createServerFn({ method: 'GET' })
  .validator(portalPrintKitInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        try {
          await requirePortalResourceScope({
            actor: ctx,
            action: 'portal.read',
            capability: 'portal.read',
            ...portalPrintScope(data.portalId),
          })
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
      ({ data }) =>
        downloadPortalPrintFile(
          (ctx) =>
            requirePortalResourceScope({
              actor: ctx,
              action: 'portal.update',
              capability: 'portal.write',
              ...portalPrintScope(data.portalId),
            }),
          (ctx) =>
            getContainer().portalPublicApi.management.createPortalPrintKit(data, ctx),
        ),
      'POST',
      'portal.downloadPortalPrintKit',
    ),
  )
