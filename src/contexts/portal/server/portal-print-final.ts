// Print downloads and wording saves share scope and policy, with separate rate limits.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { downloadPortalPrintInputSchema } from '../application/dto/portal-print.dto'
import { savePortalPrintWordingInputSchema } from '../application/dto/portal-print-wording.dto'
import {
  downloadPortalPrintFile,
  guardedPortalPrintAction,
  portalPrintScope,
} from './portal-print-file.server'
import { requirePortalResourceScope } from './property-scope'

/** Makes the PDF behind the shared print guards. */
export const downloadPortalPrintFinal = createServerFn({ method: 'POST' })
  .validator(downloadPortalPrintInputSchema)
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
          (ctx) => getContainer().portalPublicApi.management.createPortalPrint(data, ctx),
        ),
      'POST',
      'portal.downloadPortalPrintFinal',
    ),
  )

/**
 * Saves wording with the download's scope, right and words rules, and its own
 * write budget. It makes no file and discloses no address.
 */
export const savePortalPrintWording = createServerFn({ method: 'POST' })
  .validator(savePortalPrintWordingInputSchema)
  .handler(
    tracedHandler(
      ({ data }) =>
        guardedPortalPrintAction(
          (ctx) =>
            requirePortalResourceScope({
              actor: ctx,
              action: 'portal.update',
              capability: 'portal.write',
              ...portalPrintScope(data.portalId),
            }),
          (ctx) =>
            getContainer().portalPublicApi.management.savePortalPrintWording(data, ctx),
          'wording',
        ),
      'POST',
      'portal.savePortalPrintWording',
    ),
  )
