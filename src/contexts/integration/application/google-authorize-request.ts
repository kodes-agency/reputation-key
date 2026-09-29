// Integration context — the one Google authorize request, shared by the connect
// flow and the deploy preflight that asks Google whether it would accept it.

import { GOOGLE_BUSINESS_MANAGE_SCOPE } from './google-provider-contract'

/**
 * The route Google redirects back to. The OAuth client in Google Cloud must
 * list `${BETTER_AUTH_URL}${GOOGLE_OAUTH_CALLBACK_PATH}` exactly, or Google
 * stops the user on its own `redirect_uri_mismatch` page.
 */
export const GOOGLE_OAUTH_CALLBACK_PATH = '/api/auth/google/callback'

const GOOGLE_AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'

/**
 * Exact v2 OAuth contract: signed OIDC identity, the account's verified email
 * as its display label, and GBP management (ADR 0050, amended 2026-09-15).
 */
const GBP_OAUTH_SCOPES = ['openid', 'email', GOOGLE_BUSINESS_MANAGE_SCOPE]

export function googleOAuthCallbackUrl(baseUrl: string): string {
  return `${baseUrl}${GOOGLE_OAUTH_CALLBACK_PATH}`
}

export function buildGoogleAuthorizeUrl(
  input: Readonly<{
    clientId: string
    callbackUrl: string
    state: string
    nonce: string
    codeChallenge: string
  }>,
): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.callbackUrl,
    scope: GBP_OAUTH_SCOPES.join(' '),
    response_type: 'code',
    state: input.state,
    access_type: 'offline',
    prompt: 'consent',
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${GOOGLE_AUTHORIZE_ENDPOINT}?${params.toString()}`
}
