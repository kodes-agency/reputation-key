// ARC-03-T10 — the Google provider trust boundary as one named module.
//
// Construction must be query-free (repositories are lazy factories), so the DB
// is a Proxy that throws on any access — the same guard the composition
// characterization suite uses. The fail-closed cases matter more than the happy
// path: an absent runtime binding, authority or keyring must produce the
// unavailable outcome, never a permissive default.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Database } from '#/shared/db'
import type { Env } from '#/shared/config/env'
import { GOOGLE_PROVIDER_ENDPOINTS } from './provider-runtime'
import {
  buildGoogleProviderAuthority,
  GOOGLE_PROVIDER_AUTHORITY_KEYS,
  OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE,
  type GoogleProviderAuthorityInput,
} from './google-provider-authority'

const dbStub = new Proxy(
  {},
  {
    get: () => {
      throw new Error('the Google provider authority must not query the DB at build time')
    },
  },
) as unknown as Database

const FIXED_DATE = new Date('2026-02-01T00:00:00.000Z')

/** Minimal env stand-in: only the keys this trust boundary reads matter. */
const envWith = (overrides: Partial<Record<string, string>>): Env =>
  ({
    NODE_ENV: 'test',
    OAUTH_STATE_SECRET: 'test-oauth-state-secret',
    ...overrides,
  }) as unknown as Env

function buildInput(
  overrides: Partial<GoogleProviderAuthorityInput> = {},
): GoogleProviderAuthorityInput {
  return {
    db: dbStub,
    clock: () => FIXED_DATE,
    logger: { warn: () => {}, info: () => {} },
    env: envWith({}),
    redis: undefined,
    providerEndpoints: GOOGLE_PROVIDER_ENDPOINTS,
    identity: {
      hasActivePropertyGrant: async () => false,
    },
    ...overrides,
  }
}

describe('buildGoogleProviderAuthority', () => {

  it('constructs without touching the database', () => {
    expect(() => buildGoogleProviderAuthority(buildInput())).not.toThrow()
  })

  it('returns a frozen record with exactly the pinned capability set', () => {
    const authority = buildGoogleProviderAuthority(buildInput())

    expect(Object.isFrozen(authority)).toBe(true)
    expect(Object.keys(authority).sort()).toEqual([...GOOGLE_PROVIDER_AUTHORITY_KEYS])
  })

  it('opens no provider-ephemeral Redis connection when none is configured', () => {
    const authority = buildGoogleProviderAuthority(buildInput())

    expect(authority.providerEphemeralRedis).toBeUndefined()
    expect(authority.providerEphemeralReadiness).toBeUndefined()
    // A non-production process still gets an in-memory store rather than a
    // silently absent one — opaque OAuth state is never optional.
    expect(authority.providerEphemeralStore).toBeDefined()
  })

  it('constructs a substrate-free operator authority that refuses every call', async () => {
    const warnings: Array<{
      fields: Readonly<Record<string, unknown>>
      message: string
    }> = []
    const authority = buildGoogleProviderAuthority(
      buildInput({
        mode: 'refusing',
        env: envWith({ NODE_ENV: 'production' }),
        logger: {
          warn: (fields: unknown, message: unknown) => {
            warnings.push({
              fields: fields as Readonly<Record<string, unknown>>,
              message: String(message),
            })
          },
          info: () => {},
        } as unknown as GoogleProviderAuthorityInput['logger'],
      }),
    )

    expect(Object.isFrozen(authority)).toBe(true)
    expect(Object.keys(authority).sort()).toEqual([...GOOGLE_PROVIDER_AUTHORITY_KEYS])
    for (const key of [
      'providerEphemeralRedis',
      'providerEphemeralStore',
      'providerEphemeralReadiness',
      'googleImportReplayKeys',
      'googleOpaqueReferenceKeys',
      'googleRefreshCoordination',
      'providerAuthorizationLeases',
      'googleImportReferences',
      'googlePerformancePrincipalKeys',
      'googleDisconnectRevokeStore',
      'googleAuthorizedProviderExecutor',
    ] as const) {
      expect(authority[key], key).toBeUndefined()
    }

    const contentCalls = [
      () => authority.authorizeGoogleImportContent({} as never),
      () => authority.authorizeGooglePerformanceContent({} as never),
      () => authority.authorizeGoogleReviewSyncContent({} as never),
      () => authority.authorizeGoogleReplyPublicationContent({} as never),
    ]
    for (const call of contentCalls) {
      await expect(call()).resolves.toEqual({
        ok: false,
        code: 'runtime_unavailable',
      })
    }
    await expect(
      authority.authorizeGoogleOAuthProviderCall({
        organizationId: 'org-1',
        connectionId: 'conn-1',
        initiatorUserId: 'user-1',
        operation: 'oauth.token.refresh',
      } as Parameters<typeof authority.authorizeGoogleOAuthProviderCall>[0]),
    ).rejects.toThrow(OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE)
    await expect(
      authority.oauthStateHandles.issue({
        organizationId: 'org-1',
        userId: 'user-1',
        sessionId: 'session-1',
        visibility: 'private',
        purpose: 'reviews',
        connectionMode: 'new',
        targetConnectionId: null,
        nowMs: FIXED_DATE.getTime(),
        codeVerifier: 'v'.repeat(43),
        oidcNonce: 'n'.repeat(43),
      }),
    ).rejects.toThrow(OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE)
    await expect(
      authority.oauthStateHandles.redeem({
        handle: 'operator-refusal',
        organizationId: 'org-1',
        userId: 'user-1',
        sessionId: 'session-1',
        nowMs: FIXED_DATE.getTime(),
      }),
    ).rejects.toThrow(OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE)

    expect(warnings).toHaveLength(7)
    expect(warnings).toEqual(
      warnings.map(() => ({
        fields: {
          stage: 'google-provider-authority',
          code: 'operator_container_refusal',
        },
        message: OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE,
      })),
    )
  })

  it('keeps required production authority construction fail-fast', () => {
    expect(() =>
      buildGoogleProviderAuthority(
        buildInput({ env: envWith({ NODE_ENV: 'production' }) }),
      ),
    ).toThrow('Opaque OAuth state requires provider-ephemeral Redis')
  })

  it('builds no egress executor without gateway transport configuration', () => {
    expect(
      buildGoogleProviderAuthority(buildInput()).googleAuthorizedProviderExecutor,
    ).toBeUndefined()
  })

  it('shares the general Redis connection for local egress coordination', () => {
    const authority = buildGoogleProviderAuthority(
      buildInput({
        db: { $client: {} } as unknown as Database,
        redis: {} as NonNullable<GoogleProviderAuthorityInput['redis']>,
        env: envWith({
          GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS: `local:${'11'.repeat(32)}`,
          GOOGLE_ADMISSION_GRANT_HMAC_KEYS: `local:${'22'.repeat(32)}`,
          GOOGLE_EGRESS_GATEWAY_IDENTITY: 'local-google-provider-runtime-v1',
        }),
      }),
    )

    expect(authority.providerEphemeralRedis).toBeUndefined()
    expect(authority.googleAuthorizedProviderExecutor).toBeDefined()
  })

  it('refuses a partially configured egress runtime instead of degrading', () => {
    // The runtime signs grants with one secret, binds credentials with another
    // and stamps permits with an identity. Any one of the three alone is a
    // half-built egress path, and silently treating it as "Google is off"
    // is how a misconfiguration reaches users as a 503 nobody ordered.
    expect(() =>
      buildGoogleProviderAuthority(
        buildInput({
          env: envWith({ GOOGLE_EGRESS_GATEWAY_IDENTITY: 'google-egress-runtime-1' }),
        }),
      ),
    ).toThrow('Google egress runtime configuration is incomplete')
  })

  it('takes configuration only as an argument — never from the ambient process', () => {
    const source = readFileSync(
      resolve('src/composition/google-provider-authority.ts'),
      'utf8',
    )

    expect(source).not.toContain('process.env')
    expect(source).not.toContain('getEnv(')
  })
})
