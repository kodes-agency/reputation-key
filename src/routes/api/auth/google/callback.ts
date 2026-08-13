// Google OAuth callback. The browser carries only an opaque, one-time state
// handle; tenant, user, session, PKCE verifier, and OIDC nonce stay server-side.

import { createFileRoute } from '@tanstack/react-router'
import { getEnv } from '#/shared/config/env'
import { getContainer } from '#/composition'
import { getSessionFromHeaders, resolveTenantContext } from '#/shared/auth/middleware'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import type { OAuthStateHandleRejection } from '#/contexts/integration/application/oauth-state-handle'
import type { ConnectGoogleInput } from '#/contexts/integration/application/dto/connect-google.dto'
import { buildOpaqueOAuthConnectInput } from '#/contexts/integration/application/oauth-callback-input'
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
  reason: OAuthStateHandleRejection | 'missing' | 'pkce_redeem_failed' | 'abuse_denied',
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

          // Pre-state abuse admission is deliberately tenant-blind. It uses
          // only a server session (or one shared sessionless bucket) before
          // any opaque handle is read.
          const headers = new Headers()
          const cookie = request.headers.get('cookie')
          if (cookie) headers.set('cookie', cookie)
          const session = await getSessionFromHeaders(headers)
          const { useCases } = getContainer()
          const preStateAdmission = await useCases.admitGoogleOAuthCallbackPreState({
            sessionId: session?.session.id ?? null,
            trustedSourceId: null,
            nowMs: Date.now(),
          })
          if (!preStateAdmission.ok) return rejectState(env, 'abuse_denied')

          let ctx: Awaited<ReturnType<typeof resolveTenantContext>>
          try {
            ctx = await resolveTenantContext(headers)
          } catch {
            return rejectState(env, 'abuse_denied')
          }
          if (!state.startsWith('v2.')) {
            return rejectState(env, 'malformed')
          }
          if (!session?.session.id || !useCases.redeemGoogleOAuthState) {
            return rejectState(env, 'not_found')
          }
          const redeemed = await useCases.redeemGoogleOAuthState({
            handle: state,
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            sessionId: session.session.id,
            nowMs: Date.now(),
          })
          if (!redeemed.ok) return rejectState(env, redeemed.code)
          const returnRoute = redeemed.returnRoute
          const connectInput: ConnectGoogleInput = buildOpaqueOAuthConnectInput(
            code,
            redeemed,
          )

          // Tenant quota is selected only after opaque state consumption.
          const tenantAdmission = await useCases.admitGoogleOAuthCallbackTenant({
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            nowMs: Date.now(),
          })
          if (!tenantAdmission.ok) return rejectState(env, 'abuse_denied')

          // Exchange code → connection after the opaque state was consumed.
          try {
            const connection = await useCases.connectGoogleAccount(connectInput, ctx)

            const importUrl = new URL(returnRoute, env.BETTER_AUTH_URL)
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
