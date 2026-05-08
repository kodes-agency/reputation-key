// Integration context — Google connection server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return
// Never returns { success: false } — always throws on error.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { createHmac } from 'crypto'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { connectGoogleInputSchema } from '../application/dto/connect-google.dto'
import { disconnectGoogleInputSchema } from '../application/dto/disconnect-google.dto'
import { updateConnectionVisibilityInputSchema } from '../application/dto/update-connection-visibility.dto'
import { isIntegrationError } from '../domain/errors'
import { integrationErrorStatus } from './shared'
import { getEnv } from '#/shared/config/env'

/** Dedicated HMAC key for OAuth state signing, separate from token encryption. */
function stateHmacKey(): string {
  return getEnv().OAUTH_STATE_SECRET ?? getEnv().ENCRYPTION_KEY
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
        // Require authentication — only logged-in users can generate OAuth URLs
        const headers = headersFromContext()
        await resolveTenantContext(headers)

        const { visibility } = data
        const callbackUrl = `${getEnv().BETTER_AUTH_URL}/api/auth/google/callback`

        // Build state with visibility preference, CSRF nonce, and HMAC signature
        const nonce = crypto.randomUUID()
        const payload = { visibility, nonce, ts: Date.now() }
        const signature = signState(payload)
        const state = Buffer.from(JSON.stringify({ ...payload, signature })).toString(
          'base64',
        )

        // Google OAuth scopes for Business Profile API
        const scopes = ['https://www.googleapis.com/auth/business.manage']

        // Build OAuth URL
        const params = new URLSearchParams({
          client_id: getEnv().GOOGLE_CLIENT_ID,
          redirect_uri: callbackUrl,
          scope: scopes.join(' '),
          response_type: 'code',
          state,
          access_type: 'offline',
          prompt: 'consent',
        })

        const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

        return { url }
      },
      'GET',
      'integration.getGoogleAuthUrl',
    ),
  )

// ── connectGoogle ───────────────────────────────────────────────────

export const connectGoogle = createServerFn({ method: 'POST' })
  .inputValidator(connectGoogleInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const connection = await useCases.connectGoogleAccount(data, ctx)
          return { connection }
        } catch (e) {
          if (isIntegrationError(e))
            throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'integration.connectGoogle',
    ),
  )

// ── listGoogleConnections ───────────────────────────────────────────

export const listGoogleConnections = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      const headers = headersFromContext()
      const ctx = await resolveTenantContext(headers)

      try {
        const { useCases } = getContainer()
        const connections = await useCases.listGoogleConnections(ctx)
        return { connections }
      } catch (e) {
        if (isIntegrationError(e))
          throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
        throw e
      }
    },
    'GET',
    'integration.listGoogleConnections',
  ),
)

// ── disconnectGoogle ────────────────────────────────────────────────

export const disconnectGoogle = createServerFn({ method: 'POST' })
  .inputValidator(disconnectGoogleInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const connection = await useCases.disconnectGoogleAccount(data, ctx)
          return { connection }
        } catch (e) {
          if (isIntegrationError(e))
            throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'integration.disconnectGoogle',
    ),
  )

// ── updateConnectionVisibility ──────────────────────────────────────

export const updateConnectionVisibility = createServerFn({ method: 'POST' })
  .inputValidator(updateConnectionVisibilityInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const connection = await useCases.updateConnectionVisibility(data, ctx)
          return { connection }
        } catch (e) {
          if (isIntegrationError(e))
            throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'integration.updateConnectionVisibility',
    ),
  )
