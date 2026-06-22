// Integration context — Google OAuth URL generation (split from google-connections.ts)
// Business logic (state-signing + URL construction) extracted into the
// getGoogleAuthUrl use case (D8-006). This server fn resolves auth + delegates.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { can } from '#/shared/domain/permissions'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'

// ── Shared Zod validators ──────────────────────────────────────────

const getAuthUrlInputSchema = z.object({
  visibility: z.enum(['private', 'organization']).default('private'),
})

// ── getGoogleAuthUrl ────────────────────────────────────────────────

export const getGoogleAuthUrl = createServerFn({ method: 'GET' })
  .inputValidator(getAuthUrlInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          // Require authentication — only logged-in users can generate OAuth URLs
          const headers = await headersFromContext()
          const ctx = await resolveTenantContext(headers)

          if (!can(ctx.role, 'integration.manage')) {
            throwContextError(
              'Forbidden',
              { code: 'FORBIDDEN', message: 'Insufficient permissions' },
              403,
            )
          }

          const { useCases } = getContainer()
          return await useCases.getGoogleAuthUrl({ visibility: data.visibility })
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'GET',
      'integration.getGoogleAuthUrl',
    ),
  )
