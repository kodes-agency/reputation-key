// Integration build — provider override proof (BQC-6.1).
//
// The composition-level characterization test can only observe the storage
// override at the container boundary; the googleOAuth/gbpApi slots thread
// into THIS build seam, so the honored-override proof lives here.
// Construction is query-free: the DB is a Proxy that throws on any access.

import { describe, it, expect } from 'vitest'
import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type {
  PropertyGoogleBindingPublicApi,
  PropertyPublicApi,
} from '#/contexts/property/application/public-api'
import type { SourceContentPurge } from '#/contexts/review/application/public-api'
import type { ProviderEndpoints } from '#/shared/routing/processing-router'
import { createInMemoryQueue } from '#/shared/testing/in-memory-queue'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createInMemoryGbpApiPort } from '#/shared/testing/in-memory-gbp-api-port'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { buildIntegrationContext } from './build'
import type { GoogleAuthorizedProviderExecutor } from './application/ports/google-authorized-provider-executor.port'
import type { GoogleImportReferenceStore } from './application/ports/google-import-reference-store.port'
import type { GoogleImportContentAuthorizer } from './application/google-import-command-authorizer'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { PerformanceContentAuthorizer } from './application/google-performance-authorizer'
import type { ProviderAuthorizationLeaseService } from '#/shared/provider-ephemeral/authorization-lease'
import type { OAuthStateHandleService } from './application/oauth-state-handle'

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
  gbpAccountManagementBaseUrl: 'https://accounts.example.test/v1',
  gbpPerformanceBaseUrl: 'https://performance.example.test/v1',
  reviewsApiBaseUrl: 'https://reviews.example.test/v4',
  notificationsApiBaseUrl: 'https://notifications.example.test/v1',
  oauthTokenUrl: 'https://oauth.example.test/token',
  oauthJwksUrl: 'https://oauth.example.test/jwks',
  oauthRevokeUrl: 'https://oauth.example.test/revoke',
}

function buildDeps(overrides: {
  googleOAuth?: ReturnType<typeof createInMemoryGoogleOAuthPort>
  gbpApi?: ReturnType<typeof createInMemoryGbpApiPort>
  googleAuthorizedProviderExecutor?: GoogleAuthorizedProviderExecutor
  googleImportReferences?: GoogleImportReferenceStore
  authorizeGoogleImportContent?: GoogleImportContentAuthorizer
  propertyBindingApi?: PropertyGoogleBindingPublicApi
  googleImportReplayKeys?: ReturnType<typeof createVersionedHmacKeyring>
  authorizeGooglePerformanceContent?: PerformanceContentAuthorizer
  googlePerformancePrincipalKeys?: ReturnType<typeof createVersionedHmacKeyring>
  providerAuthorizationLeases?: ProviderAuthorizationLeaseService
  oauthStateHandles?: OAuthStateHandleService
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
    oauthStateHandles: {} as unknown as OAuthStateHandleService,
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

  it('constructs bounded import discovery only with every protected dependency', () => {
    const complete = buildIntegrationContext(
      buildDeps({
        googleAuthorizedProviderExecutor:
          {} as unknown as GoogleAuthorizedProviderExecutor,
        googleImportReferences: {} as unknown as GoogleImportReferenceStore,
        authorizeGoogleImportContent: async () => ({
          ok: false,
          code: 'runtime_unavailable',
        }),
        propertyBindingApi: {} as unknown as PropertyGoogleBindingPublicApi,
        googleImportReplayKeys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
      }),
    )
    const transportless = buildIntegrationContext(
      buildDeps({
        propertyBindingApi: {} as unknown as PropertyGoogleBindingPublicApi,
      }),
    )

    expect(complete.internal.useCases.googleImportDiscovery).not.toBeNull()
    expect(transportless.internal.useCases.googleImportDiscovery).toBeNull()
    expect(complete.internal.useCases.googleImportTransaction).not.toBeNull()
    expect(transportless.internal.useCases.googleImportTransaction).toBeNull()
    expect(complete.internal.useCases.processGoogleImportV2Item).not.toBeNull()
    expect(transportless.internal.useCases.processGoogleImportV2Item).not.toBeNull()
  })

  it('constructs live Performance only with every protected dependency', () => {
    const complete = buildIntegrationContext(
      buildDeps({
        propertyBindingApi: {} as unknown as PropertyGoogleBindingPublicApi,
        googleAuthorizedProviderExecutor:
          {} as unknown as GoogleAuthorizedProviderExecutor,
        authorizeGooglePerformanceContent: async () => ({
          ok: false,
          code: 'runtime_unavailable',
        }),
        googlePerformancePrincipalKeys: createVersionedHmacKeyring(
          `v1:${'22'.repeat(32)}`,
        ),
        providerAuthorizationLeases: {} as unknown as ProviderAuthorizationLeaseService,
      }),
    )
    const missingLease = buildIntegrationContext(
      buildDeps({
        propertyBindingApi: {} as unknown as PropertyGoogleBindingPublicApi,
        googleAuthorizedProviderExecutor:
          {} as unknown as GoogleAuthorizedProviderExecutor,
        authorizeGooglePerformanceContent: async () => ({
          ok: false,
          code: 'runtime_unavailable',
        }),
        googlePerformancePrincipalKeys: createVersionedHmacKeyring(
          `v1:${'22'.repeat(32)}`,
        ),
      }),
    )

    expect(complete.internal.useCases.getPropertyGooglePerformance).not.toBeNull()
    expect(complete.internal.useCases.renewGooglePerformanceLease).not.toBeNull()
    expect(missingLease.internal.useCases.getPropertyGooglePerformance).toBeNull()
    expect(missingLease.internal.useCases.renewGooglePerformanceLease).toBeNull()
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
