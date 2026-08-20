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

/**
 * Callback failures return one fixed route and a client-safe code. `denied` is the
 * user's own choice at Google's consent screen, not a failure of the connection —
 * reporting it as one tells the operator to debug something that is working.
 */
type CallbackErrorCode = 'connection_failed' | 'account_already_connected' | 'denied'

const redirectWithError = (
  env: ReturnType<typeof getEnv>,
  code: CallbackErrorCode = 'connection_failed',
) =>
  new Response(null, {
    status: 302,
    headers: {
      Location: `${env.BETTER_AUTH_URL}/properties/import-google?error=${code}`,
    },
  })

/**
 * Content-free classification of a connect failure. `account_already_connected`
 * is terminal for the ceremony the browser just completed — retrying the same
 * consent can never succeed, so it must not be reported as a generic retry.
 */
const connectFailureCode = (error: unknown): CallbackErrorCode =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 'account_already_connected'
    ? 'account_already_connected'
    : 'connection_failed'

/** Log a state rejection without echoing the handle, tenant, or provider input. */
const rejectState = (
  env: ReturnType<typeof getEnv>,
  reason: OAuthStateHandleRejection | 'missing' | 'pkce_redeem_failed' | 'abuse_denied',
): Response => {
  getLogger().warn({ security: true, reason }, 'OAuth state rejected')
  return redirectWithError(env)
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function handleGoogleOAuthCallback(request: Request): Promise<Response> {
  return trace('auth.googleCallback', async () => {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')
    const env = getEnv()

    // Every callback first consumes the tenant-blind abuse budget. State and
    // provider outcome handling happen only after that boundary.
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
    if (!state) return rejectState(env, 'missing')
    if (!state.startsWith('v2.')) return rejectState(env, 'malformed')
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

    // Tenant quota is selected only after opaque state consumption.
    const tenantAdmission = await useCases.admitGoogleOAuthCallbackTenant({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      nowMs: Date.now(),
    })
    if (!tenantAdmission.ok) return rejectState(env, 'abuse_denied')

    // Provider denial consumes the legitimate state without a token call. Only the
    // OAuth 2.0 `access_denied` value means the user declined consent (RFC 6749
    // §4.1.2.1); any other provider error or a missing code is a real failure.
    if (error || !code) {
      const denialCode: CallbackErrorCode =
        error === 'access_denied' ? 'denied' : 'connection_failed'
      getLogger().warn(
        { security: true, reason: 'provider_callback_denied', outcome: denialCode },
        'Google OAuth callback denied',
      )
      return redirectWithError(env, denialCode)
    }
    const connectInput: ConnectGoogleInput = buildOpaqueOAuthConnectInput(code, redeemed)
    try {
      const connection = await useCases.connectGoogleAccount(connectInput, ctx)

      const importUrl = new URL(returnRoute, env.BETTER_AUTH_URL)
      importUrl.searchParams.set('connectionId', connection.id)
      return new Response(null, {
        status: 302,
        headers: { Location: importUrl.toString() },
      })
    } catch (e) {
      if (isOAuthStateInvalidError(e)) {
        return rejectState(env, 'pkce_redeem_failed')
      }
      const failureCode = connectFailureCode(e)
      getLogger().error(
        { security: true, reason: failureCode },
        'Google OAuth connection failed',
      )
      return redirectWithError(env, failureCode)
    }
  })
}

export const Route = createFileRoute('/api/auth/google/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => handleGoogleOAuthCallback(request),
    },
  },
})
