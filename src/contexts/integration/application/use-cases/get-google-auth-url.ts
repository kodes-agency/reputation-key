// Integration context — issue an opaque, server-bound Google OAuth URL.

import { generateCodeVerifier, generateOidcNonce, s256Challenge } from '../oauth-pkce'
import type { OAuthStateHandleService } from '../oauth-state-handle'
import { buildGoogleAuthorizeUrl } from '../google-authorize-request'

export type GetGoogleAuthUrlDeps = Readonly<{
  clientId: string
  callbackUrl: string
  clock: () => Date
  stateHandles: OAuthStateHandleService
}>

export type GetGoogleAuthUrlInput = Readonly<{
  visibility: 'private' | 'organization'
  /** The authenticated user initiating the flow (state session binding). */
  userId: string
  /** Stable tenant/session bindings required by opaque v2 state. */
  organizationId?: string
  sessionId?: string
  purpose?: 'reviews' | 'import_gbp_v2' | 'performance_reauth'
  connectionMode?: 'new' | 'reauth' | 'reconnect'
  targetConnectionId?: string | null
}>

export type GetGoogleAuthUrlResult = Readonly<{
  url: string
}>

/** Concrete use case instance type — named, not derived via ReturnType. */
export type GetGoogleAuthUrl = (
  input: GetGoogleAuthUrlInput,
) => Promise<GetGoogleAuthUrlResult>

/**
 * The caller resolves authorization. This use case creates one-time PKCE and
 * OIDC material, persists it only behind an opaque state handle, and emits no
 * tenant, user, provider, or verifier material in the browser-visible state.
 */
export const getGoogleAuthUrl =
  (deps: GetGoogleAuthUrlDeps): GetGoogleAuthUrl =>
  async (input) => {
    const codeVerifier = generateCodeVerifier()
    const oidcNonce = generateOidcNonce()
    const nowMs = deps.clock().getTime()

    if (!input.organizationId || !input.sessionId) {
      throw new Error('Opaque OAuth state dependencies are unavailable')
    }
    const state = await deps.stateHandles.issue({
      organizationId: input.organizationId,
      userId: input.userId,
      sessionId: input.sessionId,
      // Keep accepting the legacy decoder shape while every newly issued
      // OAuth ceremony records the sole Organization-owned value.
      visibility: 'organization',
      purpose: input.purpose ?? 'reviews',
      connectionMode: input.connectionMode ?? 'new',
      targetConnectionId: input.targetConnectionId ?? null,
      nowMs,
      codeVerifier,
      oidcNonce,
    })

    const url = buildGoogleAuthorizeUrl({
      clientId: deps.clientId,
      callbackUrl: deps.callbackUrl,
      state,
      nonce: oidcNonce,
      codeChallenge: s256Challenge(codeVerifier),
    })

    return { url }
  }
