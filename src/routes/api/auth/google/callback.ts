// Integration context — Google OAuth callback route
// TanStack Start API route that Google redirects to after user consent.
// Exchanges the authorization code server-side so it never appears in
// browser history or client logs. Creates/updates the Google connection,
// then redirects to the import page with only a connection reference.

import { createHmac, timingSafeEqual } from 'crypto'
import { createFileRoute } from '@tanstack/react-router'
import { err, ok, type Result } from '#/shared/domain'
import { getEnv } from '#/shared/config/env'
import { getContainer } from '#/composition'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a 302 redirect to the import page with an error query param. */
const redirectWithError = (env: ReturnType<typeof getEnv>, errorParam: string) =>
  new Response(null, {
    status: 302,
    headers: { Location: `${env.BETTER_AUTH_URL}/import?error=${errorParam}` },
  })

type ValidatedState = {
  visibility: 'private' | 'organization'
  nonce: string
  ts: number
}

/** Parse base64-encoded JSON state, verify HMAC signature & freshness. */
const parseAndValidateState = (
  rawState: string,
  env: ReturnType<typeof getEnv>,
): Result<ValidatedState, Response> => {
  const logger = getLogger()
  const reject = (reason: string) => {
    logger.warn({ security: true }, reason)
    return err(redirectWithError(env, 'invalid_state'))
  }

  // Decode base64 → JSON
  let parsed: { visibility?: string; nonce?: string; ts?: number; signature?: string }
  try {
    parsed = JSON.parse(Buffer.from(rawState, 'base64').toString())
  } catch {
    logger.warn(
      { security: true, rawState: rawState.substring(0, 100) },
      'OAuth state is not valid base64+JSON',
    )
    return err(redirectWithError(env, 'invalid_state'))
  }

  // Required fields present?
  if (!parsed.signature || !parsed.nonce || !parsed.ts) {
    return reject('OAuth state missing signature, nonce, or timestamp')
  }

  // Timestamp freshness — 10-minute window
  const STATE_MAX_AGE_MS = 10 * 60 * 1000
  if (Date.now() - parsed.ts > STATE_MAX_AGE_MS) {
    return reject('OAuth state expired')
  }

  // Visibility enum
  if (parsed.visibility !== 'private' && parsed.visibility !== 'organization') {
    return reject('OAuth state missing or invalid visibility')
  }

  // HMAC verification
  const payload = { visibility: parsed.visibility, nonce: parsed.nonce, ts: parsed.ts }
  const expectedSig = createHmac('sha256', env.OAUTH_STATE_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex')

  if (
    parsed.signature.length !== expectedSig.length ||
    !timingSafeEqual(Buffer.from(parsed.signature), Buffer.from(expectedSig))
  ) {
    return reject('OAuth state HMAC verification failed — possible CSRF')
  }

  return ok({
    visibility: parsed.visibility === 'organization' ? 'organization' : 'private',
    nonce: parsed.nonce,
    ts: parsed.ts,
  })
}

/** Classify a caught error as session-related or generic connection failure. */
const classifyError = (e: unknown): string => {
  const isSessionError =
    e instanceof Error &&
    '_tag' in e &&
    (e as { _tag: string })._tag === 'AuthError' &&
    'code' in e &&
    ((e as { code: string }).code === 'session_expired' ||
      (e as { code: string }).code === 'unauthorized')

  return isSessionError ? 'session_expired' : 'connection_failed'
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/api/auth/google/callback')({
  server: {
    handlers: {
      GET: async ({ request }) =>
        trace('auth.googleCallback', async () => {
          const url = new URL(request.url)
          const code = url.searchParams.get('code')
          const state = url.searchParams.get('state')
          const error = url.searchParams.get('error')
          const env = getEnv()

          // User denied consent or no code returned
          if (error === 'access_denied' || !code) {
            return redirectWithError(env, 'denied')
          }

          // State parameter is required for CSRF protection
          if (!state) {
            getLogger().warn({ security: true }, 'OAuth callback missing state parameter')
            return redirectWithError(env, 'invalid_state')
          }

          // Validate state signature & contents
          const stateResult = parseAndValidateState(state, env)
          if (stateResult.isErr()) return stateResult.error

          const { visibility } = stateResult.value

          // Exchange code → connection via use case
          try {
            const headers = new Headers()
            const cookie = request.headers.get('cookie')
            if (cookie) headers.set('cookie', cookie)

            const ctx = await resolveTenantContext(headers)
            const { useCases } = getContainer()
            const connection = await useCases.connectGoogleAccount(
              { code, visibility },
              ctx,
            )

            const importUrl = new URL('/import', env.BETTER_AUTH_URL)
            importUrl.searchParams.set('connectionId', connection.id)
            return new Response(null, {
              status: 302,
              headers: { Location: importUrl.toString() },
            })
          } catch (e) {
            getLogger().error({ err: e }, 'Google OAuth connection failed')
            return redirectWithError(env, classifyError(e))
          }
        }),
    },
  },
})
