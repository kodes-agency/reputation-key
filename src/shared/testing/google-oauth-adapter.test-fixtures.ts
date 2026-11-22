import { afterEach, beforeEach, vi } from 'vitest'
import { createGoogleEgressGateway } from '#/shared/google-provider-control/egress-gateway'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createGoogleOAuthAdapter } from '#/contexts/integration/connections/google-oauth.adapter.server'
import type { GoogleAuthorizedProviderExecutor } from '#/contexts/integration/provider/google-client.port.server'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'

export const BUSINESS_MANAGE_SCOPE = 'https://www.googleapis.com/auth/business.manage'
export const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email'

export const CONFIG = {
  clientId: 'rep-key-client',
  clientSecret: 'client-secret',
  tokenUrl: 'https://oauth.example.test/token',
  jwksUrl: 'https://oauth.example.test/jwks',
  revokeUrl: 'https://oauth.example.test/revoke',
  clock: () => new Date(),
  executor: {
    execute: async (descriptor, options) => {
      const gateway = createGoogleEgressGateway({
        nowMs: () => options.deadlineMs - 10_000,
        bindCredential: () => '1'.repeat(64),
        routeTarget: {
          kind: 'local_sandbox',
          simulatorOrigin: 'https://oauth.example.test',
        },
        admission: {
          start: async () => ({
            ok: true,
            handle: {
              expiresAtMs: options.deadlineMs,
              permitCompletion: new Promise<void>(() => undefined),
              complete: async () => true,
            },
          }),
        },
        fetch: (...args) => fetch(...args),
      })
      return gateway.execute({
        permitId: 'test-oauth-permit',
        descriptor,
        deadlineMs: options.deadlineMs,
      })
    },
  } satisfies GoogleAuthorizedProviderExecutor,
}

export const jsonResponse = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })

export const authorization = {
  capability: 'property.import_gbp_v2' as const,
  organizationId: organizationId('org-oauth-gateway'),
  propertyId: null,
  connectionId: googleConnectionId('00000000-0000-4000-8000-000000000101'),
  initiatorUserId: 'user-oauth-gateway',
  expectedCredentialGeneration: 1,
  authorizationVector: { credentialGeneration: 1 },
}

type ExchangeFields = Readonly<{
  code: string
  redirectUri: string
  codeVerifier: string
  oidcNonce: string
}>

export const exchangeInput = (overrides: Partial<ExchangeFields> = {}) => ({
  contractVersion: 'v2' as const,
  authorization,
  code: 'authorization-code',
  redirectUri: 'https://app.example.test/api/auth/google/callback',
  codeVerifier: 'pkce-verifier',
  oidcNonce: 'oidc-nonce',
  ...overrides,
})

/** A successful token endpoint answer; pass snake_case fields to change it. */
export const tokenEndpointResponse = (overrides: Record<string, unknown> = {}) =>
  jsonResponse({
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
    scope: `openid ${BUSINESS_MANAGE_SCOPE}`,
    ...overrides,
  })

export const executorResult = (
  status: number,
  body: string,
  contentType: string | null = 'application/json',
) => ({
  ok: true as const,
  status,
  headers: { contentType, cacheControl: null, retryAfter: null },
  body: new TextEncoder().encode(body),
})

/** An executor that always answers with the same bytes, kept to check zeroization. */
export function executorAnswering(
  status: number,
  body: string,
  contentType: string | null = 'application/json',
) {
  const answer = executorResult(status, body, contentType)
  const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(async () => answer)
  return { execute, responseBody: answer.body }
}

export const executorFailing = (code: 'transport_error' | 'deadline_exceeded') =>
  vi.fn<GoogleAuthorizedProviderExecutor['execute']>(async () => ({
    ok: false,
    code,
    dispatch: 'unknown',
    retryAfterMs: 0,
  }))

export const executorAdapter = (
  execute: ReturnType<typeof vi.fn<GoogleAuthorizedProviderExecutor['execute']>>,
) =>
  createGoogleOAuthAdapter({
    ...CONFIG,
    executor: { execute },
    nowMs: () => Date.now(),
  })

/** Replaces global fetch for each test of the surrounding describe. */
export function stubFetch() {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  return fetchMock
}

type IdTokenClaims = Readonly<{
  nonce?: string
  azp?: string
  includeIssuedAt?: boolean
  issuedAtSeconds?: number
  audience?: string | string[]
  email?: string
  emailVerified?: boolean | string
}>

const ID_TOKEN_LIFETIME_SECONDS = 15 * 60

export async function signingKey() {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = await exportJWK(publicKey)
  const sign = (claims: IdTokenClaims = {}) => {
    const issuedAt = claims.issuedAtSeconds ?? Math.floor(Date.now() / 1_000)
    let builder = new SignJWT({
      nonce: claims.nonce ?? 'oidc-nonce',
      ...(claims.azp === undefined ? {} : { azp: claims.azp }),
      ...(claims.email === undefined ? {} : { email: claims.email }),
      ...(claims.emailVerified === undefined
        ? {}
        : { email_verified: claims.emailVerified }),
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://accounts.google.com')
      .setAudience(claims.audience ?? CONFIG.clientId)
      .setSubject('signed-google-subject')
    if (claims.includeIssuedAt !== false) builder = builder.setIssuedAt(issuedAt)
    return builder
      .setExpirationTime(issuedAt + ID_TOKEN_LIFETIME_SECONDS)
      .sign(privateKey)
  }
  return { sign, jwks: { keys: [{ ...jwk, kid: 'test-key', alg: 'RS256' }] } }
}

export async function signedIdToken(nonce: string, claims: IdTokenClaims = {}) {
  const { sign, jwks } = await signingKey()
  return { token: await sign({ ...claims, nonce }), jwks }
}
