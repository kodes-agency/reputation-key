// Integration context — Google OAuth 2.0 / OIDC adapter.
// Handles code exchange, signed ID-token validation, token refresh, and revoke.

import { z } from 'zod/v4'
import { createLocalJWKSet, jwtVerify } from 'jose'
import type { GoogleOAuthPort } from '../../application/ports/google-oauth.port'
import type { GoogleAuthorizedProviderExecutor } from '../../application/ports/google-authorized-provider-executor.port'
import type { GoogleProviderRouteDescriptor } from '#/shared/google-provider-control/route-catalogue'
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

const ambiguousExchangeError = () =>
  integrationError(
    'oauth_failed',
    'Google OAuth code exchange outcome is ambiguous; the one-use code must not be exchanged again',
  )

function isJsonMediaType(value: string): boolean {
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType === 'application/json') return true
  if (!mediaType?.startsWith('application/') || !mediaType.endsWith('+json')) {
    return false
  }

  const subtype = mediaType.slice('application/'.length, -'+json'.length)
  return (
    subtype.length > 0 &&
    [...subtype].every((character) =>
      'abcdefghijklmnopqrstuvwxyz0123456789.+-'.includes(character),
    )
  )
}

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
  } finally {
    bytes.fill(0)
    for (const chunk of chunks) chunk.fill(0)
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
  clock: () => Date
  /** Governed production transport. JWKS remains the sole fixed trust read. */
  executor?: GoogleAuthorizedProviderExecutor
  nowMs?: () => number
  /**
   * Production guard supplied by the composition root. Credential-bearing
   * routes call it immediately before any direct socket; production always
   * refuses while local/test adapters remain deterministic.
   */
  assertDirectCredentialEgressAllowed?: (operation: string) => void
}): GoogleOAuthPort => {
  const clock = config.clock
  const nowMs = config.nowMs ?? (() => clock().getTime())
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

  const executeCredentialJson = async (
    descriptor: GoogleProviderRouteDescriptor,
    authorization: Parameters<
      GoogleAuthorizedProviderExecutor['execute']
    >[1]['authorization'],
    errorCode: 'oauth_failed' | 'token_refresh_failed',
  ): Promise<unknown> => {
    const executor = config.executor
    if (!executor) throw new Error('Google credential executor is unavailable')
    const result = await executor.execute(descriptor, {
      authorization,
      deadlineMs: nowMs() + GOOGLE_PROVIDER_TIMEOUT_MS,
    })
    if (!result.ok) {
      if (
        descriptor.routeKey === 'oauth.token.exchange' &&
        ['transport_error', 'deadline_exceeded', 'response_too_large'].includes(
          result.code,
        )
      ) {
        throw ambiguousExchangeError()
      }
      throw integrationError(errorCode, 'Google credential provider is unavailable')
    }
    if (result.status < 200 || result.status >= 300) {
      result.body.fill(0)
      if (descriptor.routeKey === 'oauth.token.exchange' && result.status >= 500) {
        throw ambiguousExchangeError()
      }
      throw integrationError(
        errorCode,
        `Google credential provider rejected the request with status ${result.status}`,
      )
    }
    if (
      result.headers.contentType !== null &&
      !isJsonMediaType(result.headers.contentType)
    ) {
      result.body.fill(0)
      if (descriptor.routeKey === 'oauth.token.exchange') {
        throw ambiguousExchangeError()
      }
      throw integrationError(errorCode, 'Google credential response was malformed')
    }
    try {
      return JSON.parse(new TextDecoder().decode(result.body))
    } catch {
      if (descriptor.routeKey === 'oauth.token.exchange') {
        throw ambiguousExchangeError()
      }
      throw integrationError(errorCode, 'Google credential response was malformed')
    } finally {
      result.body.fill(0)
    }
  }

  /**
   * The three sources of a token response: an already-preserved result being
   * revalidated, the governed executor, or the direct-egress fallback.
   */
  const fetchTokenResponse = async (
    input: Parameters<GoogleOAuthPort['exchangeCode']>[0],
  ): Promise<unknown> => {
    if (input.preservedResult) {
      return {
        access_token: input.preservedResult.accessToken,
        refresh_token: input.preservedResult.refreshToken,
        expires_in: input.preservedResult.expiresIn,
        scope: input.preservedResult.scopes.join(' '),
        id_token: input.preservedResult.idToken,
      }
    }
    if (config.executor) {
      if (!input.authorization) {
        throw integrationError(
          'oauth_failed',
          'Google OAuth exchange authorization is unavailable',
        )
      }
      return executeCredentialJson(
        {
          routeKey: 'oauth.token.exchange',
          code: input.code,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          redirectUri: input.redirectUri,
          codeVerifier: input.codeVerifier,
        },
        input.authorization,
        'oauth_failed',
      )
    }
    config.assertDirectCredentialEgressAllowed?.('oauth.token.exchange')
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
    return readBoundedJson(response, TOKEN_RESPONSE_MAX_BYTES)
  }

  /**
   * Signature, issuer, audience, nonce, lifetime and freshness of the ID token.
   * Every failure collapses to the same opaque validation error.
   */
  const verifiedGoogleSubject = async (
    idToken: string,
    oidcNonce: string,
  ): Promise<string> => {
    try {
      const jwks = await loadJwks()
      const now = clock()
      const nowSeconds = Math.floor(now.getTime() / 1_000)
      const verified = await jwtVerify(idToken, createLocalJWKSet(jwks), {
        algorithms: ['RS256'],
        audience: config.clientId,
        issuer: [...GOOGLE_OIDC_ISSUERS],
        currentDate: now,
        clockTolerance: ID_TOKEN_CLOCK_SKEW_SECONDS,
      })
      const { aud, azp, exp, iat, nonce, sub } = verified.payload
      if (
        nonce !== oidcNonce ||
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
      return sub
    } catch {
      throw integrationError('oauth_failed', 'Google ID token validation failed')
    }
  }

  const exchangeCode: GoogleOAuthPort['exchangeCode'] = async (input) => {
    const raw = await fetchTokenResponse(input)

    const parsed = googleTokenResponseSchema.safeParse(raw)
    if (!parsed.success) {
      if (config.executor) throw ambiguousExchangeError()
      throw parsed.error
    }
    const data = parsed.data
    if (!data.refresh_token) {
      throw integrationError(
        'oauth_failed',
        'Google OAuth refresh credential was missing; the one-use code must not be exchanged again',
      )
    }
    const scopes = parseGrantedScopes(data.scope, true)

    if (!data.id_token) {
      throw integrationError('oauth_failed', 'Google OAuth ID token was missing')
    }
    if (!input.preservedResult && input.preserveSuccessfulResult) {
      await input.preserveSuccessfulResult({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        scopes,
        idToken: data.id_token,
      })
    }
    const googleSubject = await verifiedGoogleSubject(data.id_token, input.oidcNonce)
    return {
      identity: { kind: 'oidc', googleSubject },
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scopes,
    }
  }

  const refreshAccessToken: GoogleOAuthPort['refreshAccessToken'] = async (
    refreshToken,
    authorization,
  ) => {
    if (config.executor) {
      if (!authorization) {
        throw integrationError(
          'token_refresh_failed',
          'Google token refresh authorization is unavailable',
        )
      }
      const data = googleTokenRefreshSchema.parse(
        await executeCredentialJson(
          {
            routeKey: 'oauth.token.refresh',
            refreshToken,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
          },
          authorization,
          'token_refresh_failed',
        ),
      )
      return { accessToken: data.access_token, expiresIn: data.expires_in }
    }
    config.assertDirectCredentialEgressAllowed?.('oauth.token.refresh')
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

  const revokeTokenWithOutcome: NonNullable<
    GoogleOAuthPort['revokeTokenWithOutcome']
  > = async (token, authorization) => {
    if (config.executor) {
      if (!authorization) {
        return 'confirmed_not_sent'
      }
      const result = await config.executor.execute(
        { routeKey: 'oauth.revoke', token },
        { authorization, deadlineMs: nowMs() + GOOGLE_PROVIDER_TIMEOUT_MS },
      )
      if (!result.ok) {
        return result.code === 'malformed_request' ||
          result.code === 'admission_denied' ||
          result.code === 'admission_mismatch'
          ? 'confirmed_not_sent'
          : 'cleanup_ambiguous'
      }
      result.body.fill(0)
      if (result.status < 200 || result.status >= 300) {
        return 'cleanup_ambiguous'
      }
      return 'confirmed_revoked'
    }
    config.assertDirectCredentialEgressAllowed?.('oauth.revoke')
    try {
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
      await response.body?.cancel()
      return response.ok ? 'confirmed_revoked' : 'cleanup_ambiguous'
    } catch {
      return 'cleanup_ambiguous'
    }
  }

  const revokeToken: GoogleOAuthPort['revokeToken'] = async (token, authorization) => {
    const outcome = await revokeTokenWithOutcome(token, authorization)
    if (outcome !== 'confirmed_revoked') {
      throw integrationError('oauth_failed', 'Google credential revoke is ambiguous')
    }
  }

  return { exchangeCode, refreshAccessToken, revokeToken, revokeTokenWithOutcome }
}
