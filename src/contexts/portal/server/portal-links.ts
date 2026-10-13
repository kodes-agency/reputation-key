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
import {
  saveLinktreeSettingsInputSchema,
  savePortalLinkTextsInputSchema,
} from '../application/dto/portal-linktree.dto'
import { isPortalError, portalError } from '../domain/errors'
import { portalErrorStatus } from './portals'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  portalId as toPortalId,
  portalLinkCategoryId as toCategoryId,
  portalLinkId as toLinkId,
} from '#/shared/domain/ids'
import {
  requireMatchingPortalResourceScopes,
  requireResourcesInPortalScope,
  type PortalResourceScope,
} from './property-scope'

const linkResourceNotFound = () =>
  portalError('link_not_found', 'portal link resource not found')

/** A scope refusal is answered the way a use-case refusal is. */
function throwScopeRefusal(error: unknown): never {
  if (isPortalError(error))
    throwContextError('PortalError', error, portalErrorStatus(error.code))
  throw error
}

// Re-export domain rules for route-layer consumption (boundary compliance)
async function authorizePortalLinkScopes(
  ctx: AuthContext,
  action: 'portal.create' | 'portal.read' | 'portal.update' | 'portal.delete',
  lookups: readonly (() => Promise<PortalResourceScope | null>)[],
): Promise<PortalResourceScope> {
  try {
    return await requireMatchingPortalResourceScopes({
      actor: ctx,
      action,
      capability: action === 'portal.read' ? 'portal.read' : 'portal.write',
      notFound: linkResourceNotFound(),
      lookups,
    })
  } catch (error) {
    throwScopeRefusal(error)
  }
}

/**
 * The links a request names beside a Portal the policy has admitted the caller
 * to. Each is still looked up: a link of another Portal, or an id that names no
 * row (a malformed one included), is "not found" before the use case runs.
 */
async function requireLinksInScope(
  scope: PortalResourceScope,
  linkIds: readonly string[],
): Promise<void> {
  try {
    await requireResourcesInPortalScope({
      scope,
      notFound: linkResourceNotFound(),
      lookups: linkIds.map(
        (linkId) => () =>
          getContainer().portalPublicApi.management.resolvePortalLinkManagementScope(
            toLinkId(linkId),
          ),
      ),
    })
  } catch (error) {
    throwScopeRefusal(error)
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
        const { categoryId } = data
        await authorizePortalLinkScopes(ctx, 'portal.create', [
          () =>
            getContainer().portalPublicApi.management.resolvePortalManagementScope(
              toPortalId(data.portalId),
            ),
          // The editor leaves the category out; the use case then picks it.
          ...(categoryId === undefined
            ? []
            : [
                () =>
                  getContainer().portalPublicApi.management.resolvePortalCategoryManagementScope(
                    toCategoryId(categoryId),
                  ),
              ]),
        ])
        try {
          const { management: useCases } = getContainer().portalPublicApi
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
            getContainer().portalPublicApi.management.resolvePortalLinkManagementScope(
              toLinkId(data.linkId),
            ),
        ])
        try {
          const { management: useCases } = getContainer().portalPublicApi
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
            getContainer().portalPublicApi.management.resolvePortalLinkManagementScope(
              toLinkId(data.linkId),
            ),
        ])
        try {
          const { management: useCases } = getContainer().portalPublicApi
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
        // The Portal and the category decide the Property, so the policy is
        // asked on those two alone. The links the caller named are read only
        // once it has admitted the caller: a refused request costs two lookups,
        // however many links it names.
        const scope = await authorizePortalLinkScopes(ctx, 'portal.update', [
          () =>
            getContainer().portalPublicApi.management.resolvePortalManagementScope(
              toPortalId(data.portalId),
            ),
          () =>
            getContainer().portalPublicApi.management.resolvePortalCategoryManagementScope(
              toCategoryId(data.categoryId),
            ),
        ])
        await requireLinksInScope(
          scope,
          data.items.map((item) => item.id),
        )
        try {
          const { management: useCases } = getContainer().portalPublicApi
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
            getContainer().portalPublicApi.management.resolvePortalManagementScope(
              toPortalId(data.portalId),
            ),
        ])
        const { management: useCases } = getContainer().portalPublicApi

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

// ── Linktree working model ─────────────────────────────────────────

export const getPortalLinktree = createServerFn({ method: 'GET' })
  .validator(z.object({ portalId: z.string().min(1) }))
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalLinkScopes(ctx, 'portal.read', [
          () =>
            getContainer().portalPublicApi.management.resolvePortalManagementScope(
              toPortalId(data.portalId),
            ),
        ])
        try {
          const { management: useCases } = getContainer().portalPublicApi
          return await useCases.getPortalLinktree(data, ctx)
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'portalLink.getPortalLinktree',
    ),
  )

export const savePortalLinkTexts = createServerFn({ method: 'POST' })
  .validator(savePortalLinkTextsInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalLinkScopes(ctx, 'portal.update', [
          () =>
            getContainer().portalPublicApi.management.resolvePortalLinkManagementScope(
              toLinkId(data.linkId),
            ),
        ])
        try {
          const { management: useCases } = getContainer().portalPublicApi
          await useCases.savePortalLinkTexts(data, ctx)
          return { saved: true }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portalLink.savePortalLinkTexts',
    ),
  )

export const saveLinktreeSettings = createServerFn({ method: 'POST' })
  .validator(saveLinktreeSettingsInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalLinkScopes(ctx, 'portal.update', [
          () =>
            getContainer().portalPublicApi.management.resolvePortalManagementScope(
              toPortalId(data.portalId),
            ),
        ])
        try {
          const { management: useCases } = getContainer().portalPublicApi
          await useCases.saveLinktreeSettings(data, ctx)
          return { saved: true }
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'portalLink.saveLinktreeSettings',
    ),
  )
