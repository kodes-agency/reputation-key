// Integration context — Google OAuth 2.0 / OIDC adapter.
// Handles code exchange, signed ID-token validation, token refresh, and revoke.

import { z } from 'zod'
import { createLocalJWKSet, jwtVerify } from 'jose'
import type { GoogleOAuthPort } from '../../application/ports/google-oauth.port'
import { integrationError } from '../../domain/errors'
import { trace } from '#/shared/observability/trace'
import {
  GOOGLE_BUSINESS_MANAGE_SCOPE,
  GOOGLE_OIDC_ISSUERS,
} from '../../application/google-provider-contract'

const googleTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
  id_token: z.string().min(1).optional(),
})
const googleTokenRefreshSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
})
const googleJwkSchema = z
  .object({
    kid: z.string().min(1).max(255),
    kty: z.literal('RSA'),
    alg: z.literal('RS256').optional(),
    use: z.literal('sig').optional(),
    n: z.string().min(1),
    e: z.string().min(1),
  })
  .passthrough()
const googleJwksSchema = z.object({
  keys: z.array(googleJwkSchema).min(1).max(20),
})

const TOKEN_RESPONSE_MAX_BYTES = 64 * 1024
const JWKS_RESPONSE_MAX_BYTES = 1024 * 1024
const GOOGLE_PROVIDER_TIMEOUT_MS = 10_000
const JWKS_DEFAULT_TTL_MS = 5 * 60_000
const JWKS_MAX_TTL_MS = 60 * 60_000
const JWKS_STALE_ON_ERROR_MS = 10 * 60_000
const ID_TOKEN_MAX_LIFETIME_SECONDS = 60 * 60
const ID_TOKEN_MAX_AGE_SECONDS = 10 * 60
const ID_TOKEN_CLOCK_SKEW_SECONDS = 60

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength && Number(declaredLength) > maxBytes) {
    throw integrationError(
      'oauth_failed',
      'Google OAuth response exceeded the size limit',
    )
  }
  if (!response.body) {
    throw integrationError('oauth_failed', 'Google OAuth response body was missing')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw integrationError(
          'oauth_failed',
          'Google OAuth response exceeded the size limit',
        )
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw integrationError('oauth_failed', 'Google OAuth response was malformed')
  }
}

function parseGrantedScopes(
  raw: string | undefined,
  exactV2: boolean,
): readonly string[] {
  if (!raw) {
    throw integrationError('oauth_failed', 'Google OAuth granted scopes were missing')
  }
  const scopes = raw.trim().split(/\s+/).filter(Boolean)
  const unique = new Set(scopes)
  if (unique.size !== scopes.length) {
    throw integrationError('oauth_failed', 'Google OAuth granted scopes were duplicated')
  }
  if (
    exactV2 &&
    (unique.size !== 2 ||
      !unique.has('openid') ||
      !unique.has(GOOGLE_BUSINESS_MANAGE_SCOPE))
  ) {
    throw integrationError('oauth_failed', 'Google OAuth granted scopes did not match')
  }
  return Object.freeze([...unique].sort())
}

// BQC-4.3: endpoint URLs arrive via construction config from the composition
// root's providerConfigFor mapping — no hardcoded or fallback endpoints
// (ADR 0031/0048).
export const createGoogleOAuthAdapter = (config: {
  clientId: string
  clientSecret: string
  tokenUrl: string
  jwksUrl: string
  revokeUrl: string
  clock?: () => Date
}): GoogleOAuthPort => {
  const clock = config.clock ?? (() => new Date())
  let jwksCache:
    | Readonly<{
        jwks: z.infer<typeof googleJwksSchema>
        expiresAtMs: number
        staleUntilMs: number
      }>
    | undefined
  let jwksFlight: Promise<z.infer<typeof googleJwksSchema>> | undefined

  const parseJwksTtlMs = (response: Response): number => {
    const cacheControl = response.headers.get('cache-control') ?? ''
    const match = /(?:^|,)\s*max-age=(\d+)(?:\s*,|$)/i.exec(cacheControl)
    if (!match) return JWKS_DEFAULT_TTL_MS
    const seconds = Number(match[1])
    if (!Number.isSafeInteger(seconds) || seconds < 1) {
      return JWKS_DEFAULT_TTL_MS
    }
    return Math.min(seconds * 1_000, JWKS_MAX_TTL_MS)
  }

  const loadJwks = async (): Promise<z.infer<typeof googleJwksSchema>> => {
    const nowMs = clock().getTime()
    if (jwksCache && jwksCache.expiresAtMs > nowMs) return jwksCache.jwks
    if (jwksFlight) return jwksFlight
    jwksFlight = (async () => {
      let response: Response
      try {
        response = await trace('googleOAuth.fetchJwks', () =>
          fetch(config.jwksUrl, {
            redirect: 'error',
            signal: AbortSignal.timeout(GOOGLE_PROVIDER_TIMEOUT_MS),
          }),
        )
      } catch (error) {
        if (jwksCache && jwksCache.staleUntilMs > clock().getTime()) {
          return jwksCache.jwks
        }
        throw error
      }
      if (!response.ok) {
        await response.body?.cancel()
        if (jwksCache && jwksCache.staleUntilMs > clock().getTime()) {
          return jwksCache.jwks
        }
        throw new Error('jwks_unavailable')
      }
      const parsed = googleJwksSchema.parse(
        await readBoundedJson(response, JWKS_RESPONSE_MAX_BYTES),
      )
      if (new Set(parsed.keys.map((key) => key.kid)).size !== parsed.keys.length) {
        throw new Error('jwks_duplicate_kid')
      }
      const fetchedAtMs = clock().getTime()
      const expiresAtMs = fetchedAtMs + parseJwksTtlMs(response)
      jwksCache = Object.freeze({
        jwks: parsed,
        expiresAtMs,
        staleUntilMs: expiresAtMs + JWKS_STALE_ON_ERROR_MS,
      })
      return parsed
    })()
    try {
      return await jwksFlight
    } finally {
      jwksFlight = undefined
    }
  }

  const exchangeCode: GoogleOAuthPort['exchangeCode'] = async (input) => {
    const response = await trace('googleOAuth.exchangeCode', () =>
      fetch(config.tokenUrl, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(GOOGLE_PROVIDER_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code: input.code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: input.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: input.codeVerifier,
        }),
      }),
    )
    if (!response.ok) {
      await response.body?.cancel()
      throw integrationError(
        'oauth_failed',
        `Google OAuth code exchange failed with status ${response.status}`,
      )
    }

    const data = googleTokenResponseSchema.parse(
      await readBoundedJson(response, TOKEN_RESPONSE_MAX_BYTES),
    )
    if (!data.refresh_token) {
      throw integrationError(
        'oauth_failed',
        'Google OAuth refresh credential was missing',
      )
    }
    const scopes = parseGrantedScopes(data.scope, true)

    if (!data.id_token) {
      throw integrationError('oauth_failed', 'Google OAuth ID token was missing')
    }
    try {
      const jwks = await loadJwks()
      const now = clock()
      const nowSeconds = Math.floor(now.getTime() / 1_000)
      const verified = await jwtVerify(data.id_token, createLocalJWKSet(jwks), {
        algorithms: ['RS256'],
        audience: config.clientId,
        issuer: [...GOOGLE_OIDC_ISSUERS],
        currentDate: now,
        clockTolerance: ID_TOKEN_CLOCK_SKEW_SECONDS,
      })
      const { aud, azp, exp, iat, nonce, sub } = verified.payload
      if (
        nonce !== input.oidcNonce ||
        typeof sub !== 'string' ||
        sub.length === 0 ||
        sub.length > 255 ||
        aud !== config.clientId ||
        (azp !== undefined && azp !== config.clientId) ||
        typeof exp !== 'number' ||
        typeof iat !== 'number' ||
        !Number.isSafeInteger(exp) ||
        !Number.isSafeInteger(iat) ||
        exp <= iat ||
        exp - iat > ID_TOKEN_MAX_LIFETIME_SECONDS ||
        iat > nowSeconds + ID_TOKEN_CLOCK_SKEW_SECONDS ||
        iat < nowSeconds - ID_TOKEN_MAX_AGE_SECONDS
      ) {
        throw new Error('oidc_claim_mismatch')
      }
      return {
        identity: { kind: 'oidc', googleSubject: sub },
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        scopes,
      }
    } catch {
      throw integrationError('oauth_failed', 'Google ID token validation failed')
    }
  }

  const refreshAccessToken: GoogleOAuthPort['refreshAccessToken'] = async (
    refreshToken,
  ) => {
    const response = await trace('googleOAuth.refreshToken', () =>
      fetch(config.tokenUrl, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(GOOGLE_PROVIDER_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'refresh_token',
        }),
      }),
    )
    if (!response.ok) {
      await response.body?.cancel()
      throw integrationError(
        'token_refresh_failed',
        `Google OAuth token refresh failed with status ${response.status}`,
      )
    }
    const data = googleTokenRefreshSchema.parse(
      await readBoundedJson(response, TOKEN_RESPONSE_MAX_BYTES),
    )
    return { accessToken: data.access_token, expiresIn: data.expires_in }
  }

  const revokeToken: GoogleOAuthPort['revokeToken'] = async (token) => {
    const response = await trace('googleOAuth.revokeToken', () =>
      fetch(config.revokeUrl, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(GOOGLE_PROVIDER_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ token }),
      }),
    )
    if (!response.ok) {
      await response.body?.cancel()
      throw integrationError(
        'oauth_failed',
        `Google OAuth credential revocation failed with status ${response.status}`,
      )
    }
    await response.body?.cancel()
  }

  return { exchangeCode, refreshAccessToken, revokeToken }
}
