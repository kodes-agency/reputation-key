// Activity context — server functions
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { can } from '#/shared/domain/permissions'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { propertyId } from '#/shared/domain/ids'
import { z } from 'zod'

// ── getActivityTimelineFn ───────────────────────────────────────────

const getActivityTimelineDto = z.object({
  resourceType: z.string(),
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
        if (!can(ctx.role, 'inbox.read')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No inbox read permission' },
            403,
          )
        }
        try {
          const { activityPublicApi } = getContainer()
          return activityPublicApi.getActivityTimeline({
            resourceType: data.resourceType,
            resourceId: data.resourceId,
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            role: ctx.role,
            limit: data.limit,
          })
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
        if (!can(ctx.role, 'inbox.read')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No inbox read permission' },
            403,
          )
        }
        try {
          const { activityPublicApi } = getContainer()
          return activityPublicApi.getOrgActivity({
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            role: ctx.role,
            propertyId: data.propertyId ? propertyId(data.propertyId) : undefined,
            limit: data.limit,
            offset: data.offset,
          })
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'GET',
      'activity.getOrgActivity',
    ),
  )
