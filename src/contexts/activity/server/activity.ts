// Activity context — server functions
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged } from '#/shared/auth/server-errors'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { propertyId } from '#/shared/domain/ids'
import { z } from 'zod'
import type { ResourceType } from '../domain/types'

// ── getActivityTimelineFn ───────────────────────────────────────────

// Derive accepted resourceType values from the domain ResourceType union so the
// DTO cannot drift from the domain (ctx-small §6): team / staff_assignment /
// integration activity was previously rejected with a 400 because the enum
// lagged the ResourceTypes that handlers write ('organization' added in
// BQC-3.9 for the identity.organization.created audit consumer).
const RESOURCE_TYPES = [
  'inbox_item',
  'review',
  'reply',
  'note',
  'property',
  'member',
  'team',
  'staff_assignment',
  'integration',
  'organization',
] as const satisfies readonly ResourceType[]

const getActivityTimelineDto = z.object({
  resourceType: z.enum(RESOURCE_TYPES),
  resourceId: z.string(),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
})

export const getActivityTimelineFn = createServerFn({ method: 'GET' })
  .inputValidator(getActivityTimelineDto)
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

// ── getOrgActivityFn ───────────────────────────────────────────────

const getOrgActivityDto = z.object({
  propertyId: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
})

export const getOrgActivityFn = createServerFn({ method: 'GET' })
  .inputValidator(getOrgActivityDto)
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
          return activityPublicApi.getOrgActivity(
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
      'activity.getOrgActivity',
    ),
  )
