// Portal context — link category server functions (split from portal-links.ts)

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { assertBetaCapability } from '#/shared/auth/beta-capabilities'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import {
  createLinkCategoryInputSchema,
  updateLinkCategoryInputSchema,
  reorderCategoriesInputSchema,
} from '../application/dto/portal-link-category.dto'
import { isPortalError } from '../domain/errors'
import { portalErrorStatus } from './portals'

// ── Category CRUD ──────────────────────────────────────────────────

export const createLinkCategory = createServerFn({ method: 'POST' })
  .inputValidator(createLinkCategoryInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        assertBetaCapability(ctx, 'portal.read')
        try {
          const { useCases } = getContainer()
          const category = await useCases.createLinkCategory(data, ctx)
          return { category }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portalLink.createLinkCategory',
    ),
  )

export const updateLinkCategory = createServerFn({ method: 'POST' })
  .inputValidator(updateLinkCategoryInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        assertBetaCapability(ctx, 'portal.read')
        try {
          const { useCases } = getContainer()
          const category = await useCases.updateLinkCategory(data, ctx)
          return { category }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portalLink.updateLinkCategory',
    ),
  )

export const deleteLinkCategory = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ categoryId: z.string().min(1) }))
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        assertBetaCapability(ctx, 'portal.read')
        try {
          const { useCases } = getContainer()
          await useCases.deleteLinkCategory(data, ctx)
          return { deleted: true }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portalLink.deleteLinkCategory',
    ),
  )

export const reorderCategories = createServerFn({ method: 'POST' })
  .inputValidator(reorderCategoriesInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        assertBetaCapability(ctx, 'portal.read')
        try {
          const { useCases } = getContainer()
          await useCases.reorderCategories(data, ctx)
          return { success: true }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portalLink.reorderCategories',
    ),
  )
