// Integration context — Google connection server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return
// Never returns { success: false } — always throws on error.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { match } from 'ts-pattern'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { connectGoogleInputSchema } from '../application/dto/connect-google.dto'
import { disconnectGoogleInputSchema } from '../application/dto/disconnect-google.dto'
import { updateConnectionVisibilityInputSchema } from '../application/dto/update-connection-visibility.dto'
import { isIntegrationError } from '../domain/errors'
import type { IntegrationErrorCode } from '../domain/errors'

// ── Error → HTTP status mapping ───────────────────────────────────

export const integrationErrorStatus = (code: IntegrationErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with('connection_not_found', 'import_not_found', () => 404)
    .with('oauth_failed', 'oauth_denied', 'token_refresh_failed', 'gbp_api_error', 'invalid_visibility', 'encryption_error', () => 400)
    .with('gbp_api_rate_limited', () => 429)
    .with('connection_disconnected', () => 409)
    .exhaustive()

// ── Shared Zod validators ──────────────────────────────────────────

const getAuthUrlInputSchema = z.object({
  redirectUri: z.string().url('Redirect URI must be a valid URL'),
  visibility: z.enum(['private', 'organization']).default('private'),
})

// ── getGoogleAuthUrl ────────────────────────────────────────────────

export const getGoogleAuthUrl = createServerFn({ method: 'GET' })
  .inputValidator(getAuthUrlInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const { redirectUri, visibility } = data

        // Build state with visibility preference
        const state = Buffer.from(JSON.stringify({ visibility })).toString('base64')

        // Google OAuth scopes for Business Profile API
        const scopes = ['https://www.googleapis.com/auth/business.manage']

        // Build OAuth URL
        const params = new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          redirect_uri: redirectUri,
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
        const connections = await useCases.listGoogleConnections(undefined, ctx)
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
