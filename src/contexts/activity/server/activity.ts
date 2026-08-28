// Activity context — server functions
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged } from '#/shared/auth/server-errors'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { propertyId } from '#/shared/domain/ids'
import { z } from 'zod/v4'
import { ACTIVITY_RESOURCE_TYPES } from '../domain/types'
import {
  isOperationalAction,
  isOperationalActionResourceType,
  type OperationalAction,
  type OperationalActionResourceType,
} from '../domain/operational-action-history'

// ── getActivityTimelineFn ───────────────────────────────────────────

// Derive accepted resourceType values from the domain ResourceType union so the
// DTO cannot drift from the domain (ctx-small §6): team / staff_assignment /
// integration activity was previously rejected with a 400 because the enum
// lagged the ResourceTypes that handlers write ('organization' added in
// BQC-3.9 for the identity.organization.created Recent Activity consumer).
const RESOURCE_TYPES = ACTIVITY_RESOURCE_TYPES

const getActivityTimelineDto = z.object({
  resourceType: z.enum(RESOURCE_TYPES),
  resourceId: z.string(),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
})

export const getActivityTimelineFn = createServerFn({ method: 'GET' })
  .validator(getActivityTimelineDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.read' })
        try {
          const { activityPublicApi } = getContainer()
          return activityPublicApi.getActivityTimeline(
            {
              resourceType: data.resourceType,
              resourceId: data.resourceId,
              limit: data.limit,
            },
            ctx,
          )
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'GET',
      'activity.getActivityTimeline',
    ),
  )

// ── listRecentActivityFn ───────────────────────────────────────────────

const listRecentActivityDto = z.object({
  propertyId: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
})

export const listRecentActivityFn = createServerFn({ method: 'GET' })
  .validator(listRecentActivityDto)
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
          const { activityPublicApi } = getContainer()
          return activityPublicApi.listRecentActivity(
            {
              propertyId: data.propertyId ? propertyId(data.propertyId) : undefined,
              limit: data.limit,
              offset: data.offset,
            },
            ctx,
          )
        } catch (e) {
          throw catchUntagged(e)
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
          return getContainer().activityPublicApi.listOperationalActionHistory(
            operationalHistoryInput(data),
            ctx,
          )
        } catch (error) {
          throw catchUntagged(error)
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
          return getContainer().activityPublicApi.exportOperationalActionHistory(
            operationalHistoryInput(data),
            ctx,
          )
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'GET',
      'activity.exportOperationalActionHistory',
    ),
  )
