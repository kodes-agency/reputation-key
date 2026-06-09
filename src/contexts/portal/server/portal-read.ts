// Portal context — read & delete server functions (split from portals.ts)

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { isPortalError } from '../domain/errors'
import { portalErrorStatus } from './portals'

// ── Shared Zod validators ──────────────────────────────────────────

const portalIdSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
})

const listPortalsSchema = z.object({
  propertyId: z.string().optional(),
})

// ── listPortals ────────────────────────────────────────────────────

export const listPortals = createServerFn({ method: 'GET' })
  .inputValidator(listPortalsSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const portals_list = await useCases.listPortals(data, ctx)
          return { portals: portals_list }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'portal.listPortals',
    ),
  )

// ── getPortal ──────────────────────────────────────────────────────

export const getPortal = createServerFn({ method: 'GET' })
  .inputValidator(portalIdSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const portal = await useCases.getPortal(data, ctx)
          return { portal }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'portal.getPortal',
    ),
  )

// ── deletePortal (soft-delete) ─────────────────────────────────────

export const deletePortal = createServerFn({ method: 'POST' })
  .inputValidator(portalIdSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          await useCases.softDeletePortal(data, ctx)
          return { deleted: true, portalId: data.portalId }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portal.deletePortal',
    ),
  )
