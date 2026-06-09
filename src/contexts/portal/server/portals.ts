// Portal context — server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { createPortalInputSchema } from '../application/dto/create-portal.dto'
import { updatePortalInputSchema } from '../application/dto/update-portal.dto'
import { isPortalError } from '../domain/errors'
import type { PortalErrorCode } from '../domain/errors'

// ── Error → HTTP status mapping ───────────────────────────────────

export const portalErrorStatus = (code: PortalErrorCode): number =>
  match(code)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with(
      'portal_not_found',
      'property_not_found',
      'category_not_found',
      'link_not_found',
      'group_not_found',
      () => 404,
    )
    .with('slug_taken', 'group_name_taken', () => HTTP_STATUS.CONFLICT)
    .with('upload_failed', () => HTTP_STATUS.UNPROCESSABLE)
    .with(
      'invalid_slug',
      'invalid_name',
      'invalid_description',
      'invalid_theme',
      'invalid_threshold',
      'invalid_url',
      'invalid_label',
      'invalid_title',
      () => 400,
    )
    .exhaustive()

// ── createPortal ───────────────────────────────────────────────────

export const createPortal = createServerFn({ method: 'POST' })
  .inputValidator(createPortalInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const portal = await useCases.createPortal(data, ctx)
          return { portal }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portal.createPortal',
    ),
  )

// ── updatePortal ───────────────────────────────────────────────────

export const updatePortal = createServerFn({ method: 'POST' })
  .inputValidator(updatePortalInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const portal = await useCases.updatePortal(data, ctx)
          return { portal }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portal.updatePortal',
    ),
  )

// ── Re-exports from split files ────────────────────────────────────

export { listPortals, getPortal, deletePortal } from './portal-read'
export { requestUploadUrl, finalizeUpload, getPortalForQR } from './portal-uploads'
