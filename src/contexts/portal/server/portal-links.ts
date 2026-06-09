// Portal context — link tree server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import {
  createLinkInputSchema,
  updateLinkInputSchema,
  reorderLinksInputSchema,
} from '../application/dto/portal-link.dto'
import { isPortalError } from '../domain/errors'
import { portalErrorStatus } from './portals'

// Re-export domain rules for route-layer consumption (boundary compliance)
export { isValidExternalUrl } from '../domain/rules'

// ── Link CRUD ──────────────────────────────────────────────────────

export const createLink = createServerFn({ method: 'POST' })
  .inputValidator(createLinkInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const { useCases } = getContainer()
          const link = await useCases.createLink(data, ctx)
          return { link }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portalLink.createLink',
    ),
  )

export const updateLink = createServerFn({ method: 'POST' })
  .inputValidator(updateLinkInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const { useCases } = getContainer()
          const link = await useCases.updateLink(data, ctx)
          return { link }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portalLink.updateLink',
    ),
  )

export const deleteLink = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ linkId: z.string().min(1) }))
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const { useCases } = getContainer()
          await useCases.deleteLink(data, ctx)
          return { deleted: true }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portalLink.deleteLink',
    ),
  )

export const reorderLinks = createServerFn({ method: 'POST' })
  .inputValidator(reorderLinksInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const { useCases } = getContainer()
          await useCases.reorderLinks(data, ctx)
          return { success: true }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portalLink.reorderLinks',
    ),
  )

// ── List (read) ────────────────────────────────────────────────────

export const listPortalLinks = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ portalId: z.string().min(1) }))
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { useCases } = getContainer()

        try {
          return await useCases.listPortalLinks(data, ctx)
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'portalLink.listPortalLinks',
    ),
  )

// ── Re-exports from split files ────────────────────────────────────

export {
  createLinkCategory,
  updateLinkCategory,
  deleteLinkCategory,
  reorderCategories,
} from './portal-link-categories'
