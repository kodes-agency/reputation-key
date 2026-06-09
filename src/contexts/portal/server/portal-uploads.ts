// Portal context — upload & QR server functions (split from portals.ts)

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { isPortalError } from '../domain/errors'
import { portalErrorStatus } from './portals'

// ── Upload schemas ─────────────────────────────────────────────────

const requestUploadSchema = z.object({
  portalId: z.string().min(1),
  contentType: z.string().min(1),
  fileSize: z.number().min(1),
})

const finalizeUploadSchema = z.object({
  portalId: z.string().min(1),
  key: z.string().min(1),
})

// ── requestUploadUrl ───────────────────────────────────────────────

export const requestUploadUrl = createServerFn({ method: 'POST' })
  .inputValidator(requestUploadSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const result = await useCases.requestUploadUrl(data, ctx)
          return result
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portal.requestUploadUrl',
    ),
  )

// ── finalizeUpload ─────────────────────────────────────────────────

export const finalizeUpload = createServerFn({ method: 'POST' })
  .inputValidator(finalizeUploadSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const result = await useCases.finalizeUpload(data, ctx)
          return result
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portal.finalizeUpload',
    ),
  )

// ── getPortalForQR ────────────────────────────────────────────────
// Returns the public-facing URL for a portal (used to generate QR codes).
// Requires authentication — only org members can generate QR codes for their portals.

const portalIdSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
})

export const getPortalForQR = createServerFn({ method: 'GET' })
  .inputValidator(portalIdSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          return await useCases.getPortalQrUrl({ portalId: data.portalId }, ctx)
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'portal.getPortalForQR',
    ),
  )
