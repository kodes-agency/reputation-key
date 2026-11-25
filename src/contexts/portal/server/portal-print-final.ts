// Print downloads and wording saves share scope and policy, with separate rate limits.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { downloadPortalPrintInputSchema } from '../printing/portal-print.contracts'
import { savePortalPrintWordingInputSchema } from '../printing/portal-print-wording.contracts'
import {
  downloadPortalPrintFile,
  guardedPortalPrintAction,
} from './portal-print-file.server'
import { requirePortalScope } from './portal-scope.server'

/** Makes the PDF behind the shared print guards. */
export const downloadPortalPrintFinal = createServerFn({ method: 'POST' })
  .validator(downloadPortalPrintInputSchema)
  .handler(
    tracedHandler(
      ({ data }) =>
        downloadPortalPrintFile(
          (ctx) => requirePortalScope(ctx, data.portalId, 'portal.update'),
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
          (ctx) => requirePortalScope(ctx, data.portalId, 'portal.update'),
          (ctx) =>
            getContainer().portalPublicApi.management.savePortalPrintWording(data, ctx),
          'wording',
        ),
      'POST',
      'portal.savePortalPrintWording',
    ),
  )
