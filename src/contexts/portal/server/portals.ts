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
import {
  portalApprovedDestinationDecisionInputSchema,
  portalApprovedDestinationDisableInputSchema,
  portalApprovedDestinationListInputSchema,
  portalApprovedDestinationRequestInputSchema,
  portalLocalizedOverrideInputSchema,
  propertyPortalBrandContentInputSchema,
  propertyPortalBrandProfileInputSchema,
  propertyPortalExperienceInputSchema,
} from '../application/dto/portal-experience.dto'
import {
  issuePortalTokenInputSchema,
  revokePortalTokensInputSchema,
  rotatePortalTokenInputSchema,
} from '../application/dto/portal-token-lifecycle.dto'
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
      'destination_not_found',
      () => 404,
    )
    .with('slug_taken', 'revision_conflict', 'destination_not_approved', () => 409)
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
      'publication_snapshot_unavailable',
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

const rollbackPortalPublicationSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
  version: z.number().int().min(1),
})

const portalPublicationHistorySchema = portalIdSchema.extend({
  cursor: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(50).optional(),
})

const listPortalsSchema = z.object({
  propertyId: z.string().optional(),
})

async function runPortalExperienceCommand<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (isPortalError(error)) {
      throwContextError('PortalError', error, portalErrorStatus(error.code))
    }
    throw catchUntagged(error)
  }
}

export const getPropertyPortalExperience = createServerFn({ method: 'GET' })
  .validator(propertyPortalExperienceInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.read',
          capability: 'portal.read',
          propertyId: data.propertyId,
        })
        return runPortalExperienceCommand(() =>
          getContainer().portalPublicApi.management.getPropertyPortalExperience(
            data,
            ctx,
          ),
        )
      },
      'GET',
      'portal.getPropertyPortalExperience',
    ),
  )

export const savePropertyPortalBrandProfile = createServerFn({ method: 'POST' })
  .validator(propertyPortalBrandProfileInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.update',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })
        return runPortalExperienceCommand(() =>
          getContainer().portalPublicApi.management.savePropertyPortalBrandProfile(
            data,
            ctx,
          ),
        )
      },
      'POST',
      'portal.savePropertyPortalBrandProfile',
    ),
  )

export const savePropertyPortalBrandContent = createServerFn({ method: 'POST' })
  .validator(propertyPortalBrandContentInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.update',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })
        return runPortalExperienceCommand(() =>
          getContainer().portalPublicApi.management.savePropertyPortalBrandContent(
            data,
            ctx,
          ),
        )
      },
      'POST',
      'portal.savePropertyPortalBrandContent',
    ),
  )

export const savePortalLocalizedOverride = createServerFn({ method: 'POST' })
  .validator(portalLocalizedOverrideInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        return runPortalExperienceCommand(() =>
          getContainer().portalPublicApi.management.savePortalLocalizedOverride(
            data,
            ctx,
          ),
        )
      },
      'POST',
      'portal.savePortalLocalizedOverride',
    ),
  )

export const listPortalApprovedDestinations = createServerFn({ method: 'GET' })
  .validator(portalApprovedDestinationListInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await authorizePortalResource(ctx, data.portalId, 'portal.read', 'portal.read')
        return runPortalExperienceCommand(() =>
          getContainer().portalPublicApi.management.listPortalApprovedDestinations(
            data,
            ctx,
          ),
        )
      },
      'GET',
      'portal.listPortalApprovedDestinations',
    ),
  )

export const requestPortalApprovedDestination = createServerFn({ method: 'POST' })
  .validator(portalApprovedDestinationRequestInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        return runPortalExperienceCommand(() =>
          getContainer().portalPublicApi.management.requestPortalApprovedDestination(
            data,
            ctx,
          ),
        )
      },
      'POST',
      'portal.requestPortalApprovedDestination',
    ),
  )

export const approvePortalApprovedDestination = createServerFn({ method: 'POST' })
  .validator(portalApprovedDestinationDecisionInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        return runPortalExperienceCommand(() =>
          getContainer().portalPublicApi.management.approvePortalApprovedDestination(
            data,
            ctx,
          ),
        )
      },
      'POST',
      'portal.approvePortalApprovedDestination',
    ),
  )

export const disablePortalApprovedDestination = createServerFn({ method: 'POST' })
  .validator(portalApprovedDestinationDisableInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        return runPortalExperienceCommand(() =>
          getContainer().portalPublicApi.management.disablePortalApprovedDestination(
            data,
            ctx,
          ),
        )
      },
      'POST',
      'portal.disablePortalApprovedDestination',
    ),
  )
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
        getContainer().portalPublicApi.management.resolvePortalManagementScope(
          toPortalId(rawPortalId),
        ),
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
  const container = getContainer()
  const { management: useCases } = container.portalPublicApi
  const { clock } = container
  const propertyIds = await useCases.listPortalManagementPropertyIds(ctx.organizationId)
  const observedAt = clock()
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
        now: observedAt,
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
          const { management: useCases } = getContainer().portalPublicApi
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
          const { management: useCases } = getContainer().portalPublicApi
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

export const rollbackPortalPublication = createServerFn({ method: 'POST' })
  .validator(rollbackPortalPublicationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')

        try {
          return await getContainer().portalPublicApi.management.rollbackPortalPublication(
            data,
            ctx,
          )
        } catch (error) {
          if (isPortalError(error)) {
            throwContextError('PortalError', error, portalErrorStatus(error.code))
          }
          throw catchUntagged(error)
        }
      },
      'POST',
      'portal.rollbackPortalPublication',
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
        const { management: useCases } = getContainer().portalPublicApi
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
          const { management: useCases } = getContainer().portalPublicApi
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

export const getPortalPublicationHistory = createServerFn({ method: 'GET' })
  .validator(portalPublicationHistorySchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.read', 'portal.read')

        try {
          return await getContainer().portalPublicApi.management.getPortalPublicationHistory(
            data,
            ctx,
          )
        } catch (error) {
          if (isPortalError(error)) {
            throwContextError('PortalError', error, portalErrorStatus(error.code))
          }
          throw catchUntagged(error)
        }
      },
      'GET',
      'portal.getPortalPublicationHistory',
    ),
  )

// ── deletePortal (legacy endpoint, recoverable archive semantics) ──

export const deletePortal = createServerFn({ method: 'POST' })
  .validator(portalIdSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.delete', 'portal.write')

        try {
          const { management: useCases } = getContainer().portalPublicApi
          await useCases.updatePortal(
            { portalId: data.portalId, publicationState: 'archived' },
            ctx,
          )
          return { archived: true, portalId: data.portalId }
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

export const issuePortalToken = createServerFn({ method: 'POST' })
  .validator(issuePortalTokenInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        try {
          return await getContainer().portalPublicApi.management.issuePortalToken(
            data,
            ctx,
          )
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
  .validator(rotatePortalTokenInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        try {
          return await getContainer().portalPublicApi.management.rotatePortalToken(
            data,
            ctx,
          )
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
  .validator(revokePortalTokensInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        try {
          return await getContainer().portalPublicApi.management.revokePortalTokens(
            data,
            ctx,
          )
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
          return await getContainer().portalPublicApi.management.completeContentReview(
            data,
            ctx,
          )
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
