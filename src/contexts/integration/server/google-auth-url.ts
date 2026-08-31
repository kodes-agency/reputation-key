// Integration context — Google OAuth URL generation (split from google-connections.ts)
// Business logic (state-signing + URL construction) extracted into the
// getGoogleAuthUrl use case (D8-006). This server fn resolves auth + delegates.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { getSessionFromHeaders, resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { googleAuthUrlInputSchema } from '../application/dto/google-auth-url.dto'

// ── getGoogleAuthUrl ────────────────────────────────────────────────

export const getGoogleAuthUrl = createServerFn({ method: 'GET' })
  .validator(googleAuthUrlInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          // Require authentication — only logged-in users can generate OAuth URLs
          const headers = await headersFromContext()
          const ctx = await resolveTenantContext(headers)
          const session = await getSessionFromHeaders(headers)
          if (!session?.session.id)
            throw new Error('Authenticated session ID is unavailable')

          await requireExecutionAllowed({ actor: ctx, action: 'integration.manage' })

          const { integrationPublicApi } = getContainer()
          // BQC-7.6: the state is bound to the initiating user (sub) — the
          // callback rejects a state redeemed by any other session.
          return await integrationPublicApi.oauth.getAuthorizationUrl({
            visibility: data.visibility,
            userId: ctx.userId,
            organizationId: ctx.organizationId,
            sessionId: session.session.id,
            purpose: 'reviews',
            connectionMode: data.connectionMode,
            targetConnectionId: data.targetConnectionId,
          })
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'GET',
      'integration.getGoogleAuthUrl',
    ),
  )
