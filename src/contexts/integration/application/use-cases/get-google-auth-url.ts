// Integration context — get Google auth URL use case
// Extracted from the server fn (D8-006): OAuth state-signing (HMAC + nonce +
// base64) and URL construction now live in a use case, testable independently.
// Per ADR 0017: clock + idGen are injected for deterministic testing.

import { createHmac } from 'crypto'

export type GetGoogleAuthUrlDeps = Readonly<{
  clientId: string
  callbackUrl: string
  stateSecret: string
  clock: () => Date
  idGen: () => string
}>

export type GetGoogleAuthUrlInput = Readonly<{
  visibility: 'private' | 'organization'
}>

export type GetGoogleAuthUrlResult = Readonly<{
  url: string
}>

/** OAuth scopes required for Google Business Profile API + user identity. */
const GBP_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

/** HMAC-sign OAuth state to prevent forgery. */
function signState(
  secret: string,
  payload: { visibility: string; nonce: string; ts: number },
): string {
  return createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')
}

/** Concrete use case instance type — named, not derived via ReturnType. */
export type GetGoogleAuthUrl = (
  input: GetGoogleAuthUrlInput,
) => Promise<GetGoogleAuthUrlResult>

/**
 * Build a signed Google OAuth authorization URL.
 *
 * The caller resolves auth + permission (integration.manage). This use case
 * owns state construction (visibility preference + CSRF nonce + HMAC signature)
 * and URL assembly — all pure, injectable-clock/idGen logic.
 */
export const getGoogleAuthUrl =
  (deps: GetGoogleAuthUrlDeps): GetGoogleAuthUrl =>
  async (input) => {
    // Build state with visibility preference, CSRF nonce, and HMAC signature
    const nonce = deps.idGen()
    const payload = { visibility: input.visibility, nonce, ts: deps.clock().getTime() }
    const signature = signState(deps.stateSecret, payload)
    const state = Buffer.from(JSON.stringify({ ...payload, signature })).toString(
      'base64',
    )

    // Build OAuth URL
    const params = new URLSearchParams({
      client_id: deps.clientId,
      redirect_uri: deps.callbackUrl,
      scope: GBP_OAUTH_SCOPES.join(' '),
      response_type: 'code',
      state,
      access_type: 'offline',
      prompt: 'consent',
    })

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

    return { url }
  }
