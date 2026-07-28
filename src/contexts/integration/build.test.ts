// Integration build — provider override proof (BQC-6.1).
//
// The composition-level characterization test can only observe the storage
// override at the container boundary; the googleOAuth/gbpApi slots thread
// into THIS build seam, so the honored-override proof lives here.
// Construction is query-free: the DB is a Proxy that throws on any access.

import { describe, it, expect } from 'vitest'
import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { SourceContentPurge } from '#/contexts/review/application/public-api'
import type { ProviderEndpoints } from '#/shared/routing/processing-router'
import { createInMemoryQueue } from '#/shared/testing/in-memory-queue'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createInMemoryGbpApiPort } from '#/shared/testing/in-memory-gbp-api-port'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { buildIntegrationContext } from './build'

/** Query-free guard: any DB access during construction throws. */
const dbStub = new Proxy(
  {},
  {
    get: () => {
      throw new Error('integration build must not query the DB during construction')
    },
  },
) as unknown as Database

const silentEvents: EventBus = { on: () => {}, emit: async () => {}, clear: () => {} }

const ENDPOINTS: ProviderEndpoints = {
  gbpApiBaseUrl: 'https://gbp.example.test/v1',
  reviewsApiBaseUrl: 'https://reviews.example.test/v4',
  notificationsApiBaseUrl: 'https://notifications.example.test/v1',
  oauthTokenUrl: 'https://oauth.example.test/token',
  oauthUserInfoUrl: 'https://oauth.example.test/userinfo',
  oauthRevokeUrl: 'https://oauth.example.test/revoke',
}

function buildDeps(overrides: {
  googleOAuth?: ReturnType<typeof createInMemoryGoogleOAuthPort>
  gbpApi?: ReturnType<typeof createInMemoryGbpApiPort>
}) {
  return {
    db: dbStub,
    events: silentEvents,
    clock: () => new Date('2026-01-15T12:00:00.000Z'),
    jobQueue: createInMemoryQueue(),
    propertyApi: {} as unknown as PropertyPublicApi,
    logger: createMockLogger(),
    sourceContentPurge: {} as unknown as SourceContentPurge,
    providerEndpoints: ENDPOINTS,
    ...overrides,
  }
}

describe('buildIntegrationContext provider slots (BQC-6.1)', () => {
  it('honors injected googleOAuth and gbpApi overrides', () => {
    const googleOAuth = createInMemoryGoogleOAuthPort()
    const gbpApi = createInMemoryGbpApiPort()
    const ctx = buildIntegrationContext(buildDeps({ googleOAuth, gbpApi }))
    expect(ctx.internal.repos.oauthPort).toBe(googleOAuth)
    expect(ctx.internal.repos.gbpApiPort).toBe(gbpApi)
  })

  it('builds the real env-driven adapters when no overrides are injected', () => {
    const ctx = buildIntegrationContext(buildDeps({}))
    const oauth = ctx.internal.repos.oauthPort
    const gbp = ctx.internal.repos.gbpApiPort
    expect(typeof oauth.exchangeCode).toBe('function')
    expect(typeof oauth.refreshAccessToken).toBe('function')
    expect(typeof gbp.listAccounts).toBe('function')
    // The default adapters are constructed, not the in-memory fakes' extras.
    expect('setExchangeResult' in oauth).toBe(false)
    expect('setAccounts' in gbp).toBe(false)
  })
})
