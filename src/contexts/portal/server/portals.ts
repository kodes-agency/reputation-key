// Portal context — server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { match } from 'ts-pattern'
import {
  getExecutionPolicy,
  requireExecutionAllowed,
} from '#/shared/auth/execution-policy'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { createPortalInputSchema } from '../application/dto/create-portal.dto'
import { updatePortalInputSchema } from '../application/dto/update-portal.dto'
import { isPortalError, portalError } from '../domain/errors'
import type { PortalErrorCode } from '../domain/errors'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Capability } from '#/shared/auth/beta-capabilities'
import type { Permission } from '#/shared/domain/permissions'
import { portalId as toPortalId } from '#/shared/domain/ids'
import { requirePortalResourceScope } from './property-scope'

// ── Error → HTTP status mapping ───────────────────────────────────

export const portalErrorStatus = (code: PortalErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with(
      'portal_not_found',
      'property_not_found',
      'category_not_found',
      'link_not_found',
      () => 404,
    )
    .with('slug_taken', 'revision_conflict', () => 409)
    .with(
      'upload_failed',
      'token_unavailable',
      'responsible_manager_ineligible',
      () => 422,
    )
    .with('group_not_found', 'portal_not_in_group', () => 404)
    .with('group_name_taken', 'portal_already_grouped', () => 409)
    .with('portal_inactive', () => 410)
    .with(
      'invalid_publication_transition',
      'google_review_destination_unavailable',
      () => 409,
    )
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

// ── Shared Zod validators ──────────────────────────────────────────

const portalIdSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
})

const listPortalsSchema = z.object({
  propertyId: z.string().optional(),
})
async function authorizePortalResource(
  ctx: AuthContext,
  rawPortalId: string,
  action: Permission,
  capability: Capability,
): Promise<void> {
  try {
    await requirePortalResourceScope({
      actor: ctx,
      action,
      capability,
      notFound: portalError('portal_not_found', 'portal not found'),
      lookup: () =>
        getContainer().useCases.resolvePortalManagementScope(toPortalId(rawPortalId)),
    })
  } catch (error) {
    if (isPortalError(error))
      throwContextError('PortalError', error, portalErrorStatus(error.code))
    throw error
  }
}

async function listAuthorizedPortalPropertyIds(
  ctx: AuthContext,
): Promise<readonly string[]> {
  const propertyIds = await getContainer().useCases.listPortalManagementPropertyIds(
    ctx.organizationId,
  )
  const decisions = await Promise.all(
    propertyIds.map(async (propertyId) => ({
      propertyId,
      decision: await getExecutionPolicy().decide({
        principal: { kind: 'user', ctx },
        action: 'portal.read',
        capability: 'portal.read',
        organizationId: ctx.organizationId,
        propertyId,
        executionKind: 'interactive',
        now: new Date(),
      }),
    })),
  )
  return decisions
    .filter(({ decision }) => decision.allowed)
    .map(({ propertyId }) => propertyId)
}

const completeContentReviewSchema = z.object({
  portalId: z.string().min(1),
  reviewId: z.string().trim().min(1),
  revision: z.number().int().min(1),
  supersedes: z
    .object({
      contentReviewSourceEventId: z.string().min(1),
      configurationSourceEventId: z.string().min(1),
      destinationRatioSourceEventId: z.string().min(1),
    })
    .nullable()
    .optional(),
})

// ── createPortal ───────────────────────────────────────────────────

export const createPortal = createServerFn({ method: 'POST' })
  .validator(createPortalInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.create',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })

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
  .validator(updatePortalInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')

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

// ── listPortals ────────────────────────────────────────────────────

export const listPortals = createServerFn({ method: 'GET' })
  .validator(listPortalsSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { useCases } = getContainer()
        const propertyIds = data.propertyId
          ? [data.propertyId]
          : await listAuthorizedPortalPropertyIds(ctx)
        if (data.propertyId) {
          await requireExecutionAllowed({
            actor: ctx,
            action: 'portal.read',
            capability: 'portal.read',
            propertyId: data.propertyId,
          })
        }

        try {
          const portals_list = (
            await Promise.all(
              propertyIds.map((propertyId) => useCases.listPortals({ propertyId }, ctx)),
            )
          ).flat()
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
  .validator(portalIdSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.read', 'portal.read')

        try {
          const { useCases } = getContainer()
          // C2: `tokenStatus` sibling — existence/metadata only, never the raw
          // token, so the Share tab can offer rotate/revoke after a reload.
          const { portal, tokenStatus } = await useCases.getPortal(data, ctx)
          return { portal, tokenStatus }
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
  .validator(portalIdSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.delete', 'portal.write')

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

// ── Upload schemas ─────────────────────────────────────────────────

const requestUploadSchema = z.object({
  portalId: z.string().min(1),
  contentType: z.string().min(1),
  fileSize: z.number().min(1),
})

const finalizeUploadSchema = z.object({
  portalId: z.string().min(1),
  uploadId: z.uuid(),
})

// ── requestUploadUrl ───────────────────────────────────────────────

export const requestUploadUrl = createServerFn({ method: 'POST' })
  .validator(requestUploadSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        // Both upload steps mutate an EXISTING portal's hero image, so they
        // authorize like every sibling mutation on an existing portal
        // (updatePortal / issuePortalToken / completeContentReview).
        await authorizePortalResource(
          ctx,
          data.portalId,
          'portal.update',
          'portal.upload',
        )

        try {
          const { useCases } = getContainer()
          const result = await useCases.requestUploadUrl(data, ctx)
          return result
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          const { getLogger } = await import('#/shared/observability/logger')
          getLogger().error({ err: e }, 'Upload request failed')
          throwContextError(
            'PortalError',
            { code: 'upload_failed', message: 'Upload request failed' },
            422,
          )
        }
      },
      'POST',
      'portal.requestUploadUrl',
    ),
  )

// ── finalizeUpload ─────────────────────────────────────────────────

export const finalizeUpload = createServerFn({ method: 'POST' })
  .validator(finalizeUploadSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(
          ctx,
          data.portalId,
          'portal.update',
          'portal.upload',
        )

        try {
          const { useCases } = getContainer()
          const result = await useCases.finalizeUpload(data, ctx)
          return result
        } catch (e) {
          if (isPortalError(e))
            throwContextError('PortalError', e, portalErrorStatus(e.code))
          const { getLogger } = await import('#/shared/observability/logger')
          getLogger().error({ err: e }, 'Upload finalization failed')
          throwContextError(
            'PortalError',
            { code: 'upload_failed', message: 'Upload finalization failed' },
            422,
          )
        }
      },
      'POST',
      'portal.finalizeUpload',
    ),
  )

const issuePortalTokenSchema = z.object({
  portalId: z.string().min(1),
  printBatch: z.string().trim().min(1).max(100).optional(),
})

const revokePortalTokensSchema = z.object({
  portalId: z.string().min(1),
  reason: z.string().trim().min(1).max(500),
})

export const issuePortalToken = createServerFn({ method: 'POST' })
  .validator(issuePortalTokenSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        try {
          return await getContainer().useCases.issuePortalToken(data, ctx)
        } catch (error) {
          if (isPortalError(error)) {
            throwContextError('PortalError', error, portalErrorStatus(error.code))
          }
          throw catchUntagged(error)
        }
      },
      'POST',
      'portal.issuePortalToken',
    ),
  )

export const rotatePortalToken = createServerFn({ method: 'POST' })
  .validator(portalIdSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        try {
          return await getContainer().useCases.rotatePortalToken(data, ctx)
        } catch (error) {
          if (isPortalError(error)) {
            throwContextError('PortalError', error, portalErrorStatus(error.code))
          }
          throw catchUntagged(error)
        }
      },
      'POST',
      'portal.rotatePortalToken',
    ),
  )

export const revokePortalTokens = createServerFn({ method: 'POST' })
  .validator(revokePortalTokensSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        try {
          return await getContainer().useCases.revokePortalTokens(data, ctx)
        } catch (error) {
          if (isPortalError(error)) {
            throwContextError('PortalError', error, portalErrorStatus(error.code))
          }
          throw catchUntagged(error)
        }
      },
      'POST',
      'portal.revokePortalTokens',
    ),
  )

export const completeContentReview = createServerFn({ method: 'POST' })
  .validator(completeContentReviewSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        try {
          return await getContainer().useCases.completeContentReview(data, ctx)
        } catch (error) {
          if (isPortalError(error))
            throwContextError('PortalError', error, portalErrorStatus(error.code))
          throw catchUntagged(error)
        }
      },
      'POST',
      'portal.completeContentReview',
    ),
  )
