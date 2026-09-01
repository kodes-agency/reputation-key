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
import type { EventBus } from '#/shared/events/event-bus'
import { providerConfigFor } from './provider-runtime'
import {
  buildGoogleProviderAuthority,
  GOOGLE_PROVIDER_AUTHORITY_KEYS,
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

const eventBusStub = {
  emit: async () => {},
  on: () => {},
} as unknown as EventBus

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
    eventBus: eventBusStub,
    clock: () => FIXED_DATE,
    logger: { warn: () => {}, info: () => {} },
    env: envWith({}),
    redis: undefined,
    providerEndpoints: providerConfigFor('gbp-default'),
    dataCellExecutionFence: {
      localCell: 'us',
      decideProperty: async () => ({ allowed: true }),
      decideImportItem: async () => ({ allowed: true }),
    } as unknown as GoogleProviderAuthorityInput['dataCellExecutionFence'],
    identity: {
      refreshPolicyStoreRequired: async () => {
        throw new Error('policy refresh must not run during construction')
      },
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

  it.each([
    ['import', 'authorizeGoogleImportContent'],
    ['performance', 'authorizeGooglePerformanceContent'],
    ['review sync', 'authorizeGoogleReviewSyncContent'],
    ['reply publication', 'authorizeGoogleReplyPublicationContent'],
  ] as const)(
    'fails closed for %s when no Google Content runtime binding exists',
    async (_label, key) => {
      const authority = buildGoogleProviderAuthority(buildInput())
      const authorize = authority[key] as (input: unknown) => Promise<unknown>

      await expect(
        authorize({
          actor: { organizationId: 'org-1', userId: 'user-1' },
          organizationId: 'org-1',
          propertyId: 'prop-1',
          connectionId: 'conn-1',
          phase: 'start',
          operationKey: 'test',
        }),
      ).resolves.toEqual({ ok: false, code: 'runtime_unavailable' })
    },
  )

  it('refuses an OAuth provider call outright when the authority is unavailable', async () => {
    const authority = buildGoogleProviderAuthority(buildInput())

    await expect(
      authority.authorizeGoogleOAuthProviderCall({
        organizationId: 'org-1',
        connectionId: 'conn-1',
        initiatorUserId: 'user-1',
        operation: 'oauth.token.refresh',
      } as Parameters<typeof authority.authorizeGoogleOAuthProviderCall>[0]),
    ).rejects.toThrow('Google OAuth provider authorization is unavailable')
  })

  it('builds no egress executor without gateway transport configuration', () => {
    expect(
      buildGoogleProviderAuthority(buildInput()).googleAuthorizedProviderExecutor,
    ).toBeUndefined()
  })

  it('refuses a partially configured egress gateway instead of degrading', () => {
    expect(() =>
      buildGoogleProviderAuthority(
        buildInput({
          env: envWith({ GOOGLE_EGRESS_GATEWAY_ORIGIN: 'https://gateway.internal' }),
        }),
      ),
    ).toThrow('Google egress gateway transport configuration is incomplete')
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
