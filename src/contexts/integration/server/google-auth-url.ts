// Integration context — Google OAuth URL generation (split from google-connections.ts)

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { createHmac } from 'crypto'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { can } from '#/shared/domain/permissions'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getEnv } from '#/shared/config/env'

/** OAuth scopes required for Google Business Profile API + user identity. */
const GBP_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

/** HMAC key for OAuth state signing — dedicated, separate from token encryption. */
function stateHmacKey(): string {
  return getEnv().OAUTH_STATE_SECRET
}

/** HMAC-sign OAuth state to prevent forgery. */
function signState(payload: { visibility: string; nonce: string; ts: number }): string {
  return createHmac('sha256', stateHmacKey())
    .update(JSON.stringify(payload))
    .digest('hex')
}

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

          const { visibility } = data
          const callbackUrl = `${getEnv().BETTER_AUTH_URL}/api/auth/google/callback`

          // Build state with visibility preference, CSRF nonce, and HMAC signature
          const nonce = crypto.randomUUID()
          const payload = { visibility, nonce, ts: Date.now() }
          const signature = signState(payload)
          const state = Buffer.from(JSON.stringify({ ...payload, signature })).toString(
            'base64',
          )

          // Build OAuth URL
          const params = new URLSearchParams({
            client_id: getEnv().GOOGLE_CLIENT_ID,
            redirect_uri: callbackUrl,
            scope: GBP_OAUTH_SCOPES.join(' '),
            response_type: 'code',
            state,
            access_type: 'offline',
            prompt: 'consent',
          })

          const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

          return { url }
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'GET',
      'integration.getGoogleAuthUrl',
    ),
  )
