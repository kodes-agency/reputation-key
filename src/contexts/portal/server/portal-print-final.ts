// Portal context — the final print kit's download (final design spec §11,
// slice 7), behind PRINT_KIT_FINAL_ENABLED. A module of its own, beside today's
// print kit functions, so its client stub lands in the portal page's chunk and
// not in the first paint's. Thin: the shared guards, then the use case.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { downloadPortalPrintFinalInputSchema } from '../application/dto/portal-print-final.dto'
import { savePortalPrintWordingInputSchema } from '../application/dto/portal-print-wording.dto'
import {
  downloadPortalPrintFile,
  guardedPortalPrintAction,
  portalPrintScope,
} from './portal-print-file.server'
import { requirePortalResourceScope } from './property-scope'

/** The final kit's download (PRINT_KIT_FINAL_ENABLED): the same guards as today's. */
export const downloadPortalPrintFinal = createServerFn({ method: 'POST' })
  .validator(downloadPortalPrintFinalInputSchema)
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
            getContainer().portalPublicApi.management.createPortalPrintFinal(data, ctx),
        ),
      'POST',
      'portal.downloadPortalPrintFinal',
    ),
  )

/**
 * Saves the final kit's wording for Share to open on: the same scope, right and
 * rate limit as the download beside it, and the same words rules. It makes no file.
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
        ),
      'POST',
      'portal.savePortalPrintWording',
    ),
  )
