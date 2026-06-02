// Activity context — server functions
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { can } from '#/shared/domain/permissions'
import { throwContextError } from '#/shared/auth/server-errors'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { z } from 'zod'

// ── getActivityTimelineFn ───────────────────────────────────────────

const getActivityTimelineDto = z.object({
  resourceType: z.string(),
  resourceId: z.string(),
  limit: z.number().min(1).max(100).optional().default(50),
})

export const getActivityTimelineFn = createServerFn({ method: 'GET' })
  .inputValidator(getActivityTimelineDto)
  .handler(
    tracedHandler(async ({ data }) => {
      const headers = headersFromContext()
      const ctx = await resolveTenantContext(headers)
      if (!can(ctx.role, 'inbox.read')) {
        throwContextError(
          'AuthError',
          { code: 'forbidden', message: 'No inbox read permission' },
          403,
        )
      }
      const { activityPublicApi } = getContainer()
      return activityPublicApi.getActivityTimeline({
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        role: ctx.role,
        limit: data.limit,
      })
    }),
  )
