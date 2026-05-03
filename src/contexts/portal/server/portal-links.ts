// Portal context — link tree server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import {
  createLinkCategoryInputSchema,
  updateLinkCategoryInputSchema,
  reorderCategoriesInputSchema,
} from '../application/dto/portal-link-category.dto'
import {
  createLinkInputSchema,
  updateLinkInputSchema,
  reorderLinksInputSchema,
} from '../application/dto/portal-link.dto'
import { isPortalError } from '../domain/errors'
import { portalId as toPortalId } from '#/shared/domain/ids'
import { portalErrorStatus } from './portals'

// ── Category CRUD ──────────────────────────────────────────────────

export const createLinkCategory = createServerFn({ method: 'POST' })
  .inputValidator(createLinkCategoryInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const { useCases } = getContainer()
          const category = await useCases.createLinkCategory(data, ctx)
          return { category }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw e
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
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const { useCases } = getContainer()
          const category = await useCases.updateLinkCategory(data, ctx)
          return { category }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw e
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
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const { useCases } = getContainer()
          await useCases.deleteLinkCategory(data, ctx)
          return { deleted: true }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw e
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
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const { useCases } = getContainer()
          await useCases.reorderCategories(data, ctx)
          return { success: true }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'portalLink.reorderCategories',
    ),
  )

// ── Link CRUD ──────────────────────────────────────────────────────

export const createLink = createServerFn({ method: 'POST' })
  .inputValidator(createLinkInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const { useCases } = getContainer()
          const link = await useCases.createLink(data, ctx)
          return { link }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw e
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
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const { useCases } = getContainer()
          const link = await useCases.updateLink(data, ctx)
          return { link }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw e
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
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const { useCases } = getContainer()
          await useCases.deleteLink(data, ctx)
          return { deleted: true }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw e
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
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        try {
          const { useCases } = getContainer()
          await useCases.reorderLinks(data, ctx)
          return { success: true }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw e
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
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { portalLinkRepo } = getContainer()

        const [categories, links] = await Promise.all([
          portalLinkRepo.listCategories(ctx.organizationId, toPortalId(data.portalId)),
          portalLinkRepo.listAllLinks(ctx.organizationId, toPortalId(data.portalId)),
        ])

        return { categories, links }
      },
      'GET',
      'portalLink.listPortalLinks',
    ),
  )
