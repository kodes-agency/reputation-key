// Portal context — link category server functions (split from portal-links.ts)

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import {
  createLinkCategoryInputSchema,
  updateLinkCategoryInputSchema,
  reorderCategoriesInputSchema,
} from '../application/dto/portal-link-category.dto'
import { isPortalError, portalError } from '../domain/errors'
import { portalErrorStatus } from './portals'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  portalId as toPortalId,
  portalLinkCategoryId as toCategoryId,
} from '#/shared/domain/ids'
import { requireMatchingPortalResourceScopes } from './property-scope'

async function authorizePortalCategoryScopes(
  ctx: AuthContext,
  action: 'portal.create' | 'portal.update' | 'portal.delete',
  lookups: readonly (() => Promise<{
    organizationId: string
    propertyId: string
    portalId?: string
  } | null>)[],
): Promise<void> {
  try {
    await requireMatchingPortalResourceScopes({
      actor: ctx,
      action,
      capability: 'portal.write',
      notFound: portalError('category_not_found', 'portal category resource not found'),
      lookups,
    })
  } catch (error) {
    if (isPortalError(error))
      throwContextError('PortalError', error, portalErrorStatus(error.code))
    throw error
  }
}

// ── Category CRUD ──────────────────────────────────────────────────

export const createLinkCategory = createServerFn({ method: 'POST' })
  .inputValidator(createLinkCategoryInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalCategoryScopes(ctx, 'portal.create', [
          () =>
            getContainer().useCases.resolvePortalManagementScope(
              toPortalId(data.portalId),
            ),
        ])
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
        await authorizePortalCategoryScopes(ctx, 'portal.update', [
          () =>
            getContainer().useCases.resolvePortalCategoryManagementScope(
              toCategoryId(data.categoryId),
            ),
        ])
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
        await authorizePortalCategoryScopes(ctx, 'portal.delete', [
          () =>
            getContainer().useCases.resolvePortalCategoryManagementScope(
              toCategoryId(data.categoryId),
            ),
        ])
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
        await authorizePortalCategoryScopes(ctx, 'portal.update', [
          () =>
            getContainer().useCases.resolvePortalManagementScope(
              toPortalId(data.portalId),
            ),
          ...data.items.map(
            (item) => () =>
              getContainer().useCases.resolvePortalCategoryManagementScope(
                toCategoryId(item.id),
              ),
          ),
        ])
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
