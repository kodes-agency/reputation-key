// Integration context — get Google auth URL use case
// Extracted from the server fn (D8-006): OAuth state-signing (HMAC + nonce +
// base64) and URL construction now live in a use case, testable independently.
// Per ADR 0017: clock + idGen are injected for deterministic testing.
//
// BQC-7.6 hardening: the state is bound to the initiating user (`sub`) and
// the flow runs PKCE S256 — the verifier is stored server-side under the
// state nonce (TTL = state TTL, one-time use) and only the challenge leaves
// the process. Codec + primitives: ../oauth-state.

import {
  encodeOAuthState,
  generateCodeVerifier,
  s256Challenge,
  OAUTH_STATE_TTL_SECONDS,
  type PkceVerifierStore,
} from '../oauth-state'

export type GetGoogleAuthUrlDeps = Readonly<{
  clientId: string
  callbackUrl: string
  stateSecret: string
  clock: () => Date
  idGen: () => string
  /** Server-side PKCE verifier store (BQC-7.6). */
  pkceStore: PkceVerifierStore
}>

export type GetGoogleAuthUrlInput = Readonly<{
  visibility: 'private' | 'organization'
  /** The authenticated user initiating the flow (state session binding). */
  userId: string
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

/** Concrete use case instance type — named, not derived via ReturnType. */
export type GetGoogleAuthUrl = (
  input: GetGoogleAuthUrlInput,
) => Promise<GetGoogleAuthUrlResult>

/**
 * Build a signed Google OAuth authorization URL.
 *
 * The caller resolves auth + permission (integration.manage). This use case
 * owns state construction (visibility preference + CSRF nonce + initiating
 * user binding + HMAC signature), PKCE verifier storage, and URL assembly.
 * Fails closed: no URL is issued when the verifier cannot be stored.
 */
export const getGoogleAuthUrl =
  (deps: GetGoogleAuthUrlDeps): GetGoogleAuthUrl =>
  async (input) => {
    // PKCE first: no authorization URL exists without its server-side
    // verifier — a store outage must not mint unredeemable flows.
    const nonce = deps.idGen()
    const codeVerifier = generateCodeVerifier()
    await deps.pkceStore.save(nonce, codeVerifier, OAUTH_STATE_TTL_SECONDS)

    // State: visibility preference + CSRF nonce + initiating-user binding,
    // HMAC-signed (codec owns the canonical form).
    const state = encodeOAuthState(
      {
        visibility: input.visibility,
        nonce,
        ts: deps.clock().getTime(),
        sub: input.userId,
      },
      deps.stateSecret,
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
      code_challenge: s256Challenge(codeVerifier),
      code_challenge_method: 'S256',
    })

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

    return { url }
  }
