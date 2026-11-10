// Portal context — server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return

import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { commandHandler } from '#/shared/commands/command.server'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { createPortalInputSchema } from '../application/dto/create-portal.dto'
import {
  changePortalLanguagesInputSchema,
  changePortalSlugInputSchema,
  portalIdInputSchema,
  publishPortalInputSchema,
  updatePortalSettingsInputSchema,
} from '../application/dto/portal-intents.dto'
import { completeContentReviewInputSchema } from '../application/dto/complete-content-review.dto'
import {
  portalApprovedDestinationDecisionInputSchema,
  portalApprovedDestinationDisableInputSchema,
  portalApprovedDestinationListInputSchema,
  portalApprovedDestinationRequestInputSchema,
  portalLocalizedOverrideInputSchema,
  propertyPortalBrandContentInputSchema,
  propertyPortalBrandProfileInputSchema,
  propertyPortalExperienceInputSchema,
  propertyPublicDisplayNameInputSchema,
} from '../application/dto/portal-experience.dto'
import {
  issuePortalTokenInputSchema,
  revealPortalAddressInputSchema,
  revokePortalTokensInputSchema,
  rotatePortalTokenInputSchema,
} from '../application/dto/portal-token-lifecycle.dto'
import { isPortalError, portalError } from '../domain/errors'
import { PORTAL_HISTORY_CATEGORIES } from '../domain/portal-history'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Capability } from '#/shared/auth/beta-capabilities'
import type { Permission } from '#/shared/domain/permissions'
import { portalId as toPortalId } from '#/shared/domain/ids'
import { requirePortalResourceScope } from './property-scope'
import { checkPortalAddressRateLimit } from './portal-address-rate-limit.server'
import { listAuthorizedPortalPropertyIds } from './authorized-portal-properties.server'
import { portalCommandErrors, portalErrorStatus } from './portal-command-errors'

// ── Error → HTTP status mapping ───────────────────────────────────

export { portalErrorStatus } from './portal-command-errors'

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

const portalHistorySchema = portalIdSchema.extend({
  // Opaque: the use case decodes it and starts over on anything it did not issue.
  cursor: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  filter: z.enum(['all', ...PORTAL_HISTORY_CATEGORIES]).optional(),
})

const listPortalsSchema = z.object({
  propertyId: z.string().optional(),
})

const listPortalOverviewSchema = z.object({
  propertyId: z.string().min(1).optional(),
})

export const getPropertyPortalExperience = createServerFn({ method: 'GET' })
  .validator(propertyPortalExperienceInputSchema)
  .handler(
    commandHandler(
      {
        method: 'GET',
        name: 'portal.getPropertyPortalExperience',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.read',
          capability: 'portal.read',
          propertyId: data.propertyId,
        })
        return getContainer().portalPublicApi.management.getPropertyPortalExperience(
          data,
          ctx,
        )
      },
    ),
  )

// The e2e seed path: no screen saves a brand profile; the e2e fixtures do.
export const savePropertyPortalBrandProfile = createServerFn({ method: 'POST' })
  .validator(propertyPortalBrandProfileInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.savePropertyPortalBrandProfile',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.update',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })
        return getContainer().portalPublicApi.management.savePropertyPortalBrandProfile(
          data,
          ctx,
        )
      },
    ),
  )

export const savePropertyPublicDisplayName = createServerFn({ method: 'POST' })
  .validator(propertyPublicDisplayNameInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.savePropertyPublicDisplayName',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.update',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })
        return getContainer().portalPublicApi.management.savePropertyPublicDisplayName(
          data,
          ctx,
        )
      },
    ),
  )

export const savePropertyPortalBrandContent = createServerFn({ method: 'POST' })
  .validator(propertyPortalBrandContentInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.savePropertyPortalBrandContent',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.update',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })
        return getContainer().portalPublicApi.management.savePropertyPortalBrandContent(
          data,
          ctx,
        )
      },
    ),
  )

export const savePortalLocalizedOverride = createServerFn({ method: 'POST' })
  .validator(portalLocalizedOverrideInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.savePortalLocalizedOverride',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        return getContainer().portalPublicApi.management.savePortalLocalizedOverride(
          data,
          ctx,
        )
      },
    ),
  )

export const listPortalApprovedDestinations = createServerFn({ method: 'GET' })
  .validator(portalApprovedDestinationListInputSchema)
  .handler(
    commandHandler(
      {
        method: 'GET',
        name: 'portal.listPortalApprovedDestinations',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.read', 'portal.read')
        return getContainer().portalPublicApi.management.listPortalApprovedDestinations(
          data,
          ctx,
        )
      },
    ),
  )

export const requestPortalApprovedDestination = createServerFn({ method: 'POST' })
  .validator(portalApprovedDestinationRequestInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.requestPortalApprovedDestination',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        return getContainer().portalPublicApi.management.requestPortalApprovedDestination(
          data,
          ctx,
        )
      },
    ),
  )

export const approvePortalApprovedDestination = createServerFn({ method: 'POST' })
  .validator(portalApprovedDestinationDecisionInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.approvePortalApprovedDestination',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        return getContainer().portalPublicApi.management.approvePortalApprovedDestination(
          data,
          ctx,
        )
      },
    ),
  )

export const disablePortalApprovedDestination = createServerFn({ method: 'POST' })
  .validator(portalApprovedDestinationDisableInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.disablePortalApprovedDestination',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        return getContainer().portalPublicApi.management.disablePortalApprovedDestination(
          data,
          ctx,
        )
      },
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

// ── createPortal ───────────────────────────────────────────────────

export const createPortal = createServerFn({ method: 'POST' })
  .validator(createPortalInputSchema)
  .handler(
    commandHandler(
      { method: 'POST', name: 'portal.createPortal', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.create',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })

        const { management: useCases } = getContainer().portalPublicApi
        const portal = await useCases.createPortal(data, ctx)
        return { portal }
      },
    ),
  )

// ── getPortalCreationOptions ───────────────────────────────────────
// What the New portal dialog needs beyond the Portals page's own reads: the
// Property's default languages and who may be made responsible.

const portalCreationOptionsSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
})

export const getPortalCreationOptions = createServerFn({ method: 'GET' })
  .validator(portalCreationOptionsSchema)
  .handler(
    commandHandler(
      {
        method: 'GET',
        name: 'portal.getPortalCreationOptions',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'portal.create',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })
        return getContainer().portalPublicApi.management.getPortalCreationOptions(
          data,
          ctx,
        )
      },
    ),
  )

// ── Portal state intents ───────────────────────────────────────────

export const updatePortalSettings = createServerFn({ method: 'POST' })
  .validator(updatePortalSettingsInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.updatePortalSettings',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')

        const portal =
          await getContainer().portalPublicApi.management.updatePortalSettings(data, ctx)
        return { portal }
      },
    ),
  )

export const changePortalSlug = createServerFn({ method: 'POST' })
  .validator(changePortalSlugInputSchema)
  .handler(
    commandHandler(
      { method: 'POST', name: 'portal.changePortalSlug', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')

        const portal = await getContainer().portalPublicApi.management.changePortalSlug(
          data,
          ctx,
        )
        return { portal }
      },
    ),
  )

export const changePortalLanguages = createServerFn({ method: 'POST' })
  .validator(changePortalLanguagesInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.changePortalLanguages',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')

        const portal =
          await getContainer().portalPublicApi.management.changePortalLanguages(data, ctx)
        return { portal }
      },
    ),
  )

export const publishPortal = createServerFn({ method: 'POST' })
  .validator(publishPortalInputSchema)
  .handler(
    commandHandler(
      { method: 'POST', name: 'portal.publishPortal', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')

        const portal = await getContainer().portalPublicApi.management.publishPortal(
          data,
          ctx,
        )
        return { portal }
      },
    ),
  )

export const disablePortal = createServerFn({ method: 'POST' })
  .validator(portalIdInputSchema)
  .handler(
    commandHandler(
      { method: 'POST', name: 'portal.disablePortal', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')

        const portal = await getContainer().portalPublicApi.management.disablePortal(
          data,
          ctx,
        )
        return { portal }
      },
    ),
  )

export const archivePortal = createServerFn({ method: 'POST' })
  .validator(portalIdInputSchema)
  .handler(
    commandHandler(
      { method: 'POST', name: 'portal.archivePortal', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.delete', 'portal.write')

        const portal = await getContainer().portalPublicApi.management.archivePortal(
          data,
          ctx,
        )
        return { portal }
      },
    ),
  )

export const restorePortal = createServerFn({ method: 'POST' })
  .validator(portalIdInputSchema)
  .handler(
    commandHandler(
      { method: 'POST', name: 'portal.restorePortal', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')

        const portal = await getContainer().portalPublicApi.management.restorePortal(
          data,
          ctx,
        )
        return { portal }
      },
    ),
  )

export const rollbackPortalPublication = createServerFn({ method: 'POST' })
  .validator(rollbackPortalPublicationSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.rollbackPortalPublication',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')

        return await getContainer().portalPublicApi.management.rollbackPortalPublication(
          data,
          ctx,
        )
      },
    ),
  )

// ── listPortals ────────────────────────────────────────────────────

export const listPortals = createServerFn({ method: 'GET' })
  .validator(listPortalsSchema)
  .handler(
    commandHandler(
      { method: 'GET', name: 'portal.listPortals', errors: portalCommandErrors },
      async ({ data, headers }) => {
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

        const portals_list = (
          await Promise.all(
            propertyIds.map((propertyId) => useCases.listPortals({ propertyId }, ctx)),
          )
        ).flat()
        return { portals: portals_list }
      },
    ),
  )

// ── listPortalOverview ─────────────────────────────────────────────
// The Portals overview in one batched read. The organisation read is narrowed
// to the Properties whose execution policy allows `portal.read`, as listPortals
// enumerates them, but answered once for all of them rather than once each.

export const listPortalOverview = createServerFn({ method: 'GET' })
  .validator(listPortalOverviewSchema)
  .handler(
    commandHandler(
      { method: 'GET', name: 'portal.listPortalOverview', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        const { management: useCases } = getContainer().portalPublicApi
        if (data.propertyId) {
          await requireExecutionAllowed({
            actor: ctx,
            action: 'portal.read',
            capability: 'portal.read',
            propertyId: data.propertyId,
          })
        }
        const input = data.propertyId
          ? ({ scope: 'property', propertyId: data.propertyId } as const)
          : ({
              scope: 'organization',
              propertyIds: await listAuthorizedPortalPropertyIds(ctx),
            } as const)

        return { portals: await useCases.listPortalOverview(input, ctx) }
      },
    ),
  )

// ── getPortal ──────────────────────────────────────────────────────

export const getPortal = createServerFn({ method: 'GET' })
  .validator(portalIdSchema)
  .handler(
    commandHandler(
      { method: 'GET', name: 'portal.getPortal', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.read', 'portal.read')

        const { management: useCases } = getContainer().portalPublicApi
        const { portal, tokenStatus } = await useCases.getPortal(data, ctx)
        return { portal, tokenStatus }
      },
    ),
  )

export const getPortalPublicationHistory = createServerFn({ method: 'GET' })
  .validator(portalPublicationHistorySchema)
  .handler(
    commandHandler(
      {
        method: 'GET',
        name: 'portal.getPortalPublicationHistory',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.read', 'portal.read')

        return await getContainer().portalPublicApi.management.getPortalPublicationHistory(
          data,
          ctx,
        )
      },
    ),
  )

/** The merged History timeline: publishing, codes and health, with actors. */
export const getPortalHistory = createServerFn({ method: 'GET' })
  .validator(portalHistorySchema)
  .handler(
    commandHandler(
      { method: 'GET', name: 'portal.getPortalHistory', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.read', 'portal.read')

        return await getContainer().portalPublicApi.management.getPortalHistory(data, ctx)
      },
    ),
  )

/**
 * The address is a secret: nothing in the path may keep a copy of this response.
 * Issue, replace and "download again" all hand it back (ADR 0069), the QR and NFC
 * addresses included, so each sets this before anything else can fail.
 */
function disableAddressCaching(): void {
  setResponseHeader('Cache-Control', 'private, no-store, max-age=0')
  setResponseHeader('Pragma', 'no-cache')
  setResponseHeader('Expires', '0')
}

export const issuePortalToken = createServerFn({ method: 'POST' })
  .validator(issuePortalTokenInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        disableAddressCaching()
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
        disableAddressCaching()
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

// "Download again" (ADR 0064). A POST, so the address never travels in a URL,
// with no-store set before anything else can fail: an error response must not
// be cached either. Order inside: authorise, rate limit, then the use case,
// which records the disclosure before it decrypts.
export const revealPortalAddress = createServerFn({ method: 'POST' })
  .validator(revealPortalAddressInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        disableAddressCaching()
        const ctx = await resolveTenantContext(await headersFromContext())
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        try {
          const container = getContainer()
          const limited = await checkPortalAddressRateLimit({
            rateLimiter: container.rateLimiter,
            actorId: ctx.userId,
            organizationId: ctx.organizationId,
          })
          if (limited) throw limited
          return await container.portalPublicApi.management.revealPortalAddress(data, ctx)
        } catch (error) {
          if (isPortalError(error)) {
            throwContextError('PortalError', error, portalErrorStatus(error.code))
          }
          throw catchUntagged(error)
        }
      },
      'POST',
      'portal.revealPortalAddress',
    ),
  )

export const revokePortalTokens = createServerFn({ method: 'POST' })
  .validator(revokePortalTokensInputSchema)
  .handler(
    commandHandler(
      { method: 'POST', name: 'portal.revokePortalTokens', errors: portalCommandErrors },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        return await getContainer().portalPublicApi.management.revokePortalTokens(
          data,
          ctx,
        )
      },
    ),
  )

export const completeContentReview = createServerFn({ method: 'POST' })
  .validator(completeContentReviewInputSchema)
  .handler(
    commandHandler(
      {
        method: 'POST',
        name: 'portal.completeContentReview',
        errors: portalCommandErrors,
      },
      async ({ data, headers }) => {
        const ctx = await resolveTenantContext(headers)
        await authorizePortalResource(ctx, data.portalId, 'portal.update', 'portal.write')
        return await getContainer().portalPublicApi.management.completeContentReview(
          data,
          ctx,
        )
      },
    ),
  )
