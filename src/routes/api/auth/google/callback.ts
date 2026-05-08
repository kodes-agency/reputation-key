// Integration context — Google OAuth callback route
// TanStack Start API route that Google redirects to after user consent.
// Exchanges the authorization code server-side so it never appears in
// browser history or client logs. Creates/updates the Google connection,
// then redirects to the import page with only a connection reference.

import { createHmac, timingSafeEqual } from 'crypto'
import { createFileRoute } from '@tanstack/react-router'
import { getEnv } from '#/shared/config/env'
import { getContainer } from '#/composition'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { getLogger } from '#/shared/observability/logger'

export const Route = createFileRoute('/api/auth/google/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const error = url.searchParams.get('error')
        const env = getEnv()

        // Handle user denial
        if (error === 'access_denied' || !code) {
          return new Response(null, {
            status: 302,
            headers: {
              Location: `${env.BETTER_AUTH_URL}/properties/import?error=denied`,
            },
          })
        }

        // Verify HMAC signature, timestamp, and extract visibility from state
        if (!state) {
          const logger = getLogger()
          logger.warn({ security: true }, 'OAuth callback missing state parameter')
          return new Response(null, {
            status: 302,
            headers: {
              Location: `${env.BETTER_AUTH_URL}/properties/import?error=invalid_state`,
            },
          })
        }

        let visibility: 'private' | 'organization'
        {
          let parsed: {
            visibility?: string
            nonce?: string
            ts?: number
            signature?: string
          }
          try {
            parsed = JSON.parse(Buffer.from(state, 'base64').toString())
          } catch {
            const logger = getLogger()
            logger.warn(
              { security: true, rawState: state.substring(0, 100) },
              'OAuth state is not valid base64+JSON',
            )
            return new Response(null, {
              status: 302,
              headers: {
                Location: `${env.BETTER_AUTH_URL}/properties/import?error=invalid_state`,
              },
            })
          }

          if (!parsed.signature || !parsed.nonce || !parsed.ts) {
            const logger = getLogger()
            logger.warn(
              { security: true },
              'OAuth state missing signature, nonce, or timestamp',
            )
            return new Response(null, {
              status: 302,
              headers: {
                Location: `${env.BETTER_AUTH_URL}/properties/import?error=invalid_state`,
              },
            })
          }

          // Reject replayed state — 10-minute window
          const STATE_MAX_AGE_MS = 10 * 60 * 1000
          if (Date.now() - parsed.ts > STATE_MAX_AGE_MS) {
            const logger = getLogger()
            logger.warn(
              { security: true, ageMs: Date.now() - parsed.ts },
              'OAuth state expired',
            )
            return new Response(null, {
              status: 302,
              headers: {
                Location: `${env.BETTER_AUTH_URL}/properties/import?error=invalid_state`,
              },
            })
          }

          const payload = {
            visibility: parsed.visibility ?? 'private',
            nonce: parsed.nonce,
            ts: parsed.ts,
          }
          const hmacKey = getEnv().OAUTH_STATE_SECRET ?? getEnv().ENCRYPTION_KEY
          const expectedSig = createHmac('sha256', hmacKey)
            .update(JSON.stringify(payload))
            .digest('hex')

          if (
            parsed.signature.length !== expectedSig.length ||
            !timingSafeEqual(Buffer.from(parsed.signature), Buffer.from(expectedSig))
          ) {
            const logger = getLogger()
            logger.warn(
              { security: true },
              'OAuth state HMAC verification failed — possible CSRF',
            )
            return new Response(null, {
              status: 302,
              headers: {
                Location: `${env.BETTER_AUTH_URL}/properties/import?error=invalid_state`,
              },
            })
          }

          visibility = parsed.visibility === 'organization' ? 'organization' : 'private'
        }

        try {
          // Resolve auth context from the request cookies
          const headers = new Headers()
          const cookie = request.headers.get('cookie')
          if (cookie) headers.set('cookie', cookie)

          // Temporarily set headers so resolveTenantContext can read them
          // This is safe because we're in a request-scoped handler
          const ctx = await resolveTenantContext(headers)

          const { useCases } = getContainer()
          const connection = await useCases.connectGoogleAccount(
            {
              code,
              visibility,
            },
            ctx,
          )

          // Redirect with only the connection ID — no auth code or tokens exposed
          const importUrl = new URL('/properties/import', env.BETTER_AUTH_URL)
          importUrl.searchParams.set('connectionId', connection.id)

          return new Response(null, {
            status: 302,
            headers: { Location: importUrl.toString() },
          })
        } catch (e) {
          const logger = getLogger()
          logger.error({ err: e }, 'Google OAuth connection failed')

          const isSessionError =
            e instanceof Error &&
            '_tag' in e &&
            (e as { _tag: string })._tag === 'AuthError' &&
            'code' in e &&
            ((e as { code: string }).code === 'session_expired' ||
              (e as { code: string }).code === 'unauthorized')

          const errorParam = isSessionError ? 'session_expired' : 'connection_failed'

          return new Response(null, {
            status: 302,
            headers: {
              Location: `${env.BETTER_AUTH_URL}/properties/import?error=${errorParam}`,
            },
          })
        }
      },
    },
  },
})
