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
import { isPortalError, portalError } from '../domain/errors'
import { portalErrorStatus } from './portals'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  portalId as toPortalId,
  portalLinkCategoryId as toCategoryId,
  portalLinkId as toLinkId,
} from '#/shared/domain/ids'
import { requireMatchingPortalResourceScopes } from './property-scope'

// Re-export domain rules for route-layer consumption (boundary compliance)
async function authorizePortalLinkScopes(
  ctx: AuthContext,
  action: 'portal.create' | 'portal.read' | 'portal.update' | 'portal.delete',
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
      capability: action === 'portal.read' ? 'portal.read' : 'portal.write',
      notFound: portalError('link_not_found', 'portal link resource not found'),
      lookups,
    })
  } catch (error) {
    if (isPortalError(error))
      throwContextError('PortalError', error, portalErrorStatus(error.code))
    throw error
  }
}

// ── Link CRUD ──────────────────────────────────────────────────────

export const createLink = createServerFn({ method: 'POST' })
  .validator(createLinkInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalLinkScopes(ctx, 'portal.create', [
          () =>
            getContainer().useCases.resolvePortalManagementScope(
              toPortalId(data.portalId),
            ),
          () =>
            getContainer().useCases.resolvePortalCategoryManagementScope(
              toCategoryId(data.categoryId),
            ),
        ])
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
  .validator(updateLinkInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalLinkScopes(ctx, 'portal.update', [
          () =>
            getContainer().useCases.resolvePortalLinkManagementScope(
              toLinkId(data.linkId),
            ),
        ])
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
  .validator(z.object({ linkId: z.string().min(1) }))
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalLinkScopes(ctx, 'portal.delete', [
          () =>
            getContainer().useCases.resolvePortalLinkManagementScope(
              toLinkId(data.linkId),
            ),
        ])
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
  .validator(reorderLinksInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalLinkScopes(ctx, 'portal.update', [
          () =>
            getContainer().useCases.resolvePortalManagementScope(
              toPortalId(data.portalId),
            ),
          () =>
            getContainer().useCases.resolvePortalCategoryManagementScope(
              toCategoryId(data.categoryId),
            ),
          ...data.items.map(
            (item) => () =>
              getContainer().useCases.resolvePortalLinkManagementScope(toLinkId(item.id)),
          ),
        ])
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
  .validator(z.object({ portalId: z.string().min(1) }))
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalLinkScopes(ctx, 'portal.read', [
          () =>
            getContainer().useCases.resolvePortalManagementScope(
              toPortalId(data.portalId),
            ),
        ])
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
