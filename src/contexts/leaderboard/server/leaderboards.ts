// Leaderboard context — server functions

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { canForContext } from '#/shared/domain/permissions'
import { getLeaderboardSchema } from '../application/dto/leaderboard.dto'
import { propertyId } from '#/shared/domain/ids'

export const getLeaderboard = createServerFn({ method: 'GET' })
  .inputValidator(getLeaderboardSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const headers = await headersFromContext()
          const ctx = await resolveTenantContext(headers)
          if (!canForContext(ctx, 'leaderboard.read')) {
            throwContextError(
              'AuthError',
              { code: 'forbidden', message: 'No leaderboard read permission' },
              403,
            )
          }
          return await getContainer().leaderboardPublicApi.getLeaderboard({
            organizationId: ctx.organizationId,
            propertyId: propertyId(data.propertyId),
            period: data.period,
            scope: data.scope,
            metricKey: data.metricKey,
          })
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'GET',
      'leaderboard.getLeaderboard',
    ),
  )
