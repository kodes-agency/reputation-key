// Integration context — Google OAuth callback route
// TanStack Start API route that Google redirects to after user consent.
// Exchanges the authorization code server-side so it never appears in
// browser history or client logs. Creates/updates the Google connection,
// then redirects to the import page with only a connection reference.
//
// BQC-7.6 hardening (state/PKCE/user-binding):
//   - The session is resolved FIRST: the HMAC-signed state carries the
//     initiating user's id (`sub`) and is rejected when the callback session
//     belongs to anyone else (login-CSRF / account-confusion fails closed to
//     the same 'invalid_state' redirect as a forged signature).
//   - The state codec (sign/verify) lives in the application layer
//     (contexts/integration/application/oauth-state.ts) — single source for
//     issuer (use case) and redeemer (this route).
//   - PKCE: the use case redeems the verifier stored under the state nonce
//     (one-time use) and forwards it on the token exchange; a missing/
//     expired/replayed verifier throws 'oauth_state_invalid', mapped here to
//     the same fail-closed 'invalid_state' redirect.
//   - Redirect allowlist: the only outbound redirects are the FIXED app paths
//     below (built from BETTER_AUTH_URL) — no request-derived redirect target
//     is ever honored.

import { createFileRoute } from '@tanstack/react-router'
import { getEnv } from '#/shared/config/env'
import { getContainer } from '#/composition'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import {
  verifyOAuthState,
  type OAuthStateRejection,
} from '#/contexts/integration/application/oauth-state'
import { isOAuthStateInvalidError } from '#/contexts/integration/server/error-helpers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a 302 redirect to the import page with an error query param. */
const redirectWithError = (env: ReturnType<typeof getEnv>, errorParam: string) =>
  new Response(null, {
    status: 302,
    headers: { Location: `${env.BETTER_AUTH_URL}/import?error=${errorParam}` },
  })

/** Log a state rejection (content-free) and map it to the redirect. */
const rejectState = (
  env: ReturnType<typeof getEnv>,
  reason: OAuthStateRejection | 'missing' | 'pkce_redeem_failed',
): Response => {
  getLogger().warn({ security: true, reason }, 'OAuth state rejected')
  return redirectWithError(env, 'invalid_state')
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
            return rejectState(env, 'missing')
          }

          // Resolve the session FIRST — the signed state is bound to the
          // initiating user, so the verifier needs the session user id.
          const headers = new Headers()
          const cookie = request.headers.get('cookie')
          if (cookie) headers.set('cookie', cookie)

          let ctx: Awaited<ReturnType<typeof resolveTenantContext>>
          try {
            ctx = await resolveTenantContext(headers)
          } catch (e) {
            getLogger().error(
              { err: e },
              'Google OAuth callback session resolution failed',
            )
            return redirectWithError(env, classifyError(e))
          }

          // Validate state signature, freshness, and the user binding.
          const stateResult = verifyOAuthState(state, {
            secret: env.OAUTH_STATE_SECRET,
            expectedUserId: ctx.userId,
            nowMs: Date.now(),
          })
          if (stateResult.isErr()) return rejectState(env, stateResult.error)

          const { visibility, nonce } = stateResult.value

          // Exchange code → connection via use case (redeems the PKCE
          // verifier under the state nonce — one-time use, fail closed).
          try {
            const { useCases } = getContainer()
            const connection = await useCases.connectGoogleAccount(
              { code, visibility, stateNonce: nonce },
              ctx,
            )

            const importUrl = new URL('/import', env.BETTER_AUTH_URL)
            importUrl.searchParams.set('connectionId', connection.id)
            return new Response(null, {
              status: 302,
              headers: { Location: importUrl.toString() },
            })
          } catch (e) {
            // PKCE/state redeem failures are the same fail-closed path as a
            // bad state signature — no distinction leaks to the client.
            if (isOAuthStateInvalidError(e)) {
              return rejectState(env, 'pkce_redeem_failed')
            }
            getLogger().error({ err: e }, 'Google OAuth connection failed')
            return redirectWithError(env, classifyError(e))
          }
        }),
    },
  },
})
