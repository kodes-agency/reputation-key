// Feed activity surface — server functions
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.
//
// Every `return` inside a `try` is `return await`. The public API is async, so
// an un-awaited rejection settles after the `try` has exited: the local catch
// never maps it, and a refused history read surfaces as an untagged 500.

import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { propertyId } from '#/shared/domain/ids'
import { z } from 'zod/v4'
import {
  activityTimelineReadDto,
  recentActivityListDto,
} from '../application/dto/recent-activity-read.dto'
import { isActivityError } from '../domain/activity-errors'
import {
  isOperationalAction,
  isOperationalActionResourceType,
  type OperationalAction,
  type OperationalActionResourceType,
} from '../domain/operational-action-history'

/**
 * The Operational Action History refusals a caller can act on: no longer a
 * current AccountAdmin, or the authority that says so cannot be read. Every
 * other Feed activity failure stays masked as an internal error.
 */
const ACTIVITY_REFUSAL_STATUS: Readonly<Record<string, number>> = {
  operational_history_access_denied: 403,
  operational_history_unavailable: 503,
}

function throwActivityFailure(error: unknown): never {
  if (isActivityError(error)) {
    const status = ACTIVITY_REFUSAL_STATUS[error.code]
    if (status !== undefined) throwContextError('ActivityError', error, status)
  }
  throw catchUntagged(error)
}

// ── getActivityTimelineFn ───────────────────────────────────────────

export const getActivityTimelineFn = createServerFn({ method: 'GET' })
  .validator(activityTimelineReadDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.read' })
        try {
          const { feedPublicApi } = getContainer()
          return await feedPublicApi.getActivityTimeline(
            {
              resourceType: data.resourceType,
              resourceId: data.resourceId,
              limit: data.limit,
            },
            ctx,
          )
        } catch (e) {
          throwActivityFailure(e)
        }
      },
      'GET',
      'activity.getActivityTimeline',
    ),
  )

// ── listRecentActivityFn ───────────────────────────────────────────────

export const listRecentActivityFn = createServerFn({ method: 'GET' })
  .validator(recentActivityListDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'inbox.read',
          propertyId: data.propertyId,
        })
        try {
          const { feedPublicApi } = getContainer()
          return await feedPublicApi.listRecentActivity(
            {
              propertyId: data.propertyId ? propertyId(data.propertyId) : undefined,
              limit: data.limit,
              offset: data.offset,
            },
            ctx,
          )
        } catch (e) {
          throwActivityFailure(e)
        }
      },
      'GET',
      'activity.listRecentActivity',
    ),
  )

const operationalActionSchema = z.custom<OperationalAction>(
  (value) => typeof value === 'string' && isOperationalAction(value),
  'Unsupported Operational Action History action',
)
const operationalResourceTypeSchema = z.custom<OperationalActionResourceType>(
  (value) => typeof value === 'string' && isOperationalActionResourceType(value),
  'Unsupported Operational Action History resource type',
)
const operationalHistoryCursorDto = z.object({
  occurredAt: z.iso.datetime().transform((value) => new Date(value)),
  sequence: z.coerce.number().int().min(1),
})
const operationalHistoryListDto = z.object({
  propertyId: z.string().optional(),
  action: operationalActionSchema.optional(),
  resourceType: operationalResourceTypeSchema.optional(),
  cursor: operationalHistoryCursorDto.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
const operationalHistoryExportDto = operationalHistoryListDto.extend({
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

const setOperationalHistoryResponsePrivacy = (): void => {
  setResponseHeader('Cache-Control', 'private, no-store, max-age=0')
  setResponseHeader('Vary', 'Cookie')
  setResponseHeader('Referrer-Policy', 'no-referrer')
  setResponseHeader('Pragma', 'no-cache')
  setResponseHeader('Expires', '0')
}

const operationalHistoryInput = (data: z.infer<typeof operationalHistoryListDto>) => ({
  ...(data.propertyId ? { propertyId: propertyId(data.propertyId) } : {}),
  ...(data.action ? { action: data.action } : {}),
  ...(data.resourceType ? { resourceType: data.resourceType } : {}),
  ...(data.cursor ? { cursor: data.cursor } : {}),
  ...(data.limit ? { limit: data.limit } : {}),
})

export const listOperationalActionHistoryFn = createServerFn({ method: 'GET' })
  .validator(operationalHistoryListDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        setOperationalHistoryResponsePrivacy()
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'policy.admin' })
        try {
          return await getContainer().feedPublicApi.listOperationalActionHistory(
            operationalHistoryInput(data),
            ctx,
          )
        } catch (error) {
          throwActivityFailure(error)
        }
      },
      'GET',
      'activity.listOperationalActionHistory',
    ),
  )

export const exportOperationalActionHistoryFn = createServerFn({ method: 'GET' })
  .validator(operationalHistoryExportDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        setOperationalHistoryResponsePrivacy()
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'policy.admin' })
        try {
          return await getContainer().feedPublicApi.exportOperationalActionHistory(
            operationalHistoryInput(data),
            ctx,
          )
        } catch (error) {
          throwActivityFailure(error)
        }
      },
      'GET',
      'activity.exportOperationalActionHistory',
    ),
  )
