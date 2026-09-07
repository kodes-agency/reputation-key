// Integration build — provider override proof (BQC-6.1).
//
// The composition-level characterization test can only observe the storage
// override at the container boundary; the googleOAuth/gbpApi slots thread
// into THIS build seam, so the honored-override proof lives here.
// Construction is query-free: the DB is a Proxy that throws on any access.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Database } from '#/shared/db'
import type {
  PropertyGoogleBindingPublicApi,
  PropertyPublicApi,
} from '#/contexts/property/application/public-api'
import type { SourceContentPurge } from '#/contexts/review/application/public-api'
import type { GoogleProviderEndpoints } from './build'
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
import type { AuthContext } from '#/shared/domain/auth-context'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import type { ExecutionDecision } from '#/shared/auth/execution-policy'
import { initExecutionPolicy, resetExecutionPolicy } from '#/shared/auth/execution-policy'
import type { OutboxRepository } from '#/shared/outbox'

/** Query-free guard: any DB access during construction throws. */
const dbStub = new Proxy(
  {},
  {
    get: () => {
      throw new Error('integration build must not query the DB during construction')
    },
  },
) as unknown as Database

const ENDPOINTS: GoogleProviderEndpoints = {
  gbpApiBaseUrl: 'https://gbp.example.test/v1',
  gbpAccountManagementBaseUrl: 'https://accounts.example.test/v1',
  gbpPerformanceBaseUrl: 'https://performance.example.test/v1',
  reviewsApiBaseUrl: 'https://reviews.example.test/v4',
  notificationsApiBaseUrl: 'https://notifications.example.test/v1',
  oauthTokenUrl: 'https://oauth.example.test/token',
  oauthJwksUrl: 'https://oauth.example.test/jwks',
  oauthRevokeUrl: 'https://oauth.example.test/revoke',
}

const CONFIG = {
  nodeEnv: 'test' as const,
  googleClientId: 'integration-build-client',
  googleClientSecret: 'integration-build-secret',
  encryptionKey: '11'.repeat(32),
  authBaseUrl: 'https://app.example.test',
  pubsubTopic: '',
  pubsubNotificationTypes: 'NEW_REVIEW',
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
  refreshPolicyStoreRequired?: () => Promise<void>
  assertDirectCredentialEgressAllowed?: (operation: string) => void
}) {
  return {
    db: dbStub,
    outboxRepo: {} as unknown as OutboxRepository,
    clock: () => new Date('2026-01-15T12:00:00.000Z'),
    idGen: () => '00000000-0000-4000-8000-000000000101',
    invalidationOwnerGen: () => 'deterministic-invalidation-owner',
    jobQueue: createInMemoryQueue(),
    propertyApi: {} as unknown as PropertyPublicApi,
    logger: createMockLogger(),
    sourceContentPurge: {} as unknown as SourceContentPurge,
    providerEndpoints: ENDPOINTS,
    config: CONFIG,
    oauthStateHandles: {} as unknown as OAuthStateHandleService,
    ...overrides,
  }
}

describe('buildIntegrationContext provider slots (BQC-6.1)', () => {
  it('exposes frozen capabilities for requests, maintenance, lifecycle, webhook, and workers', () => {
    const ctx = buildIntegrationContext(buildDeps({}))

    expect(Object.keys(ctx).sort()).toEqual([
      'internal',
      'lifecycle',
      'maintenance',
      'publicApi',
      // ARC-03-T12: the named provider capabilities the Review build consumes.
      'reviewSync',
      'webhook',
      'worker',
    ])
    expect(Object.keys(ctx.publicApi).sort()).toEqual([
      'connections',
      'imports',
      'oauth',
      'performance',
    ])
    expect(ctx.publicApi.connections.connect).toBe(
      ctx.internal.useCases.connectGoogleAccount,
    )
    expect(ctx.publicApi.connections.resume).toBe(
      ctx.internal.useCases.resumeGoogleAccountConnection,
    )
    expect(ctx.publicApi.imports.discover).toBe(
      ctx.internal.useCases.googleImportDiscovery,
    )
    expect(ctx.maintenance.imports.inspectBacklog).toBe(
      ctx.internal.useCases.inspectGoogleImportV2Lifecycle,
    )
    expect(ctx.lifecycle.prepareConnectorDeparture).toBe(
      ctx.internal.useCases.prepareGoogleConnectorDeparture,
    )
    expect(ctx.webhook.handleNotification).toBe(ctx.internal.gbpNotificationHandler)
    expect(ctx.worker.processImportItem).toBe(
      ctx.internal.useCases.processGoogleImportV2Item,
    )
    expect(ctx.worker.sweepImportLifecycle).toBe(
      ctx.internal.useCases.sweepGoogleImportV2Lifecycle,
    )

    expect(Object.isFrozen(ctx.publicApi)).toBe(true)
    expect(Object.isFrozen(ctx.publicApi.connections)).toBe(true)
    expect(Object.isFrozen(ctx.publicApi.oauth)).toBe(true)
    expect(Object.isFrozen(ctx.publicApi.imports)).toBe(true)
    expect(Object.isFrozen(ctx.publicApi.performance)).toBe(true)
    expect(Object.isFrozen(ctx.maintenance)).toBe(true)
    expect(Object.isFrozen(ctx.maintenance.imports)).toBe(true)
    expect(Object.isFrozen(ctx.lifecycle)).toBe(true)
    expect(Object.isFrozen(ctx.webhook)).toBe(true)
    expect(Object.isFrozen(ctx.worker)).toBe(true)
  })

  it('uses only the parsed configuration injected by the composition boundary', () => {
    const source = readFileSync(new URL('./build.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/\bgetEnv\s*\(/u)
    expect(source).not.toContain("from '#/shared/config/env'")
  })

  it('routes Review reads and reply publication through their distinct system authorities', () => {
    const source = readFileSync(new URL('./build.ts', import.meta.url), 'utf8')
    const start = source.indexOf('const googleReviewSyncAuthorizer =')
    const end = source.indexOf('const googleReviewApi:', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const reviewWiring = source.slice(start, end)
    expect(reviewWiring).toContain('createGoogleReviewSyncAuthorizer')
    expect(reviewWiring).toContain('createGoogleReplyPublicationAuthorizer')
    expect(reviewWiring).toContain("authorization.capability === 'property.connect_gbp'")
    expect(reviewWiring).toContain(
      "authorization.capability === 'property.publish_reply'",
    )
    expect(reviewWiring).toContain('authorization.publication.attemptNumber')
    expect(reviewWiring).toContain('propertySourceEpoch')
    expect(reviewWiring).not.toContain('connectedBy')
    expect(reviewWiring).not.toContain('property.import_gbp_v2')
  })

  it('routes notification account lookup and desired-state writes through the governed executor', () => {
    const source = readFileSync(new URL('./build.ts', import.meta.url), 'utf8')
    const start = source.indexOf('const googleNotificationProviderExecutor =')
    const end = source.indexOf('const gbpSubscribeBackfill =', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const notificationWiring = source.slice(start, end)
    expect(notificationWiring).toContain('createSingle401RefreshExecutor')
    expect(notificationWiring).toContain('createMyBusinessNotificationsAdapter')
    expect(notificationWiring).toContain('authorization_unavailable')
    expect(notificationWiring).not.toContain('createGoogleAccountManagementAdapter')
    expect(source).toContain('const targetedAccounts = new Set<string>()')
    expect(source).toContain('gbpAccountId: binding.accountId')
    expect(source).not.toContain('createGbpApiAdapter')
  })

  it('activates a durable, non-empty provider-authorization invalidation handler set', () => {
    const source = readFileSync(new URL('./build.ts', import.meta.url), 'utf8')
    expect(source).toContain('createProviderAuthorizationInvalidationFanout')
    expect(source).toContain("id: 'google_import_references'")
    expect(source).toContain('registerProviderAuthorizationInvalidationConsumer')
  })

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

  it('keeps the legacy direct account adapter dark when no override is injected', async () => {
    const ctx = buildIntegrationContext(buildDeps({}))
    const oauth = ctx.internal.repos.oauthPort
    const gbp = ctx.internal.repos.gbpApiPort
    expect(typeof oauth.exchangeCode).toBe('function')
    expect(typeof oauth.refreshAccessToken).toBe('function')
    expect(typeof gbp.listAccounts).toBe('function')
    // The default adapters are constructed, not the in-memory fakes' extras.
    expect('setExchangeResult' in oauth).toBe(false)
    expect('setAccounts' in gbp).toBe(false)
    await expect(gbp.listAccounts('credential')).rejects.toThrow(
      'Legacy Google account lookup is unavailable',
    )
  })

  it('refuses Google review calls when the governed executor is unavailable', async () => {
    const ctx = buildIntegrationContext(buildDeps({}))

    await expect(
      ctx.reviewSync.googleReviewApi.listReviewsPage({} as never),
    ).rejects.toThrow('Governed Google review API is unavailable')
  })

  it('threads the production credential-egress refusal into the real OAuth adapter', async () => {
    const refusal = new Error('credential gateway required')
    const assertDirectCredentialEgressAllowed = vi.fn(() => {
      throw refusal
    })
    const ctx = buildIntegrationContext(
      buildDeps({ assertDirectCredentialEgressAllowed }),
    )

    await expect(
      ctx.internal.repos.oauthPort.refreshAccessToken('refresh-token'),
    ).rejects.toBe(refusal)
    expect(assertDirectCredentialEgressAllowed).toHaveBeenCalledWith(
      'oauth.token.refresh',
    )
  })
})

// The provider/effect path awaits Identity's policy observation before it
// executes. Static policy makes this an immediate successful observation, but
// retaining the ordering prevents composition from bypassing the control seam.
describe('buildIntegrationContext mandatory policy refresh', () => {
  afterEach(() => {
    resetExecutionPolicy()
  })

  const actor: AuthContext = {
    organizationId: organizationId('org-1'),
    userId: userId('user-1'),
    role: 'AccountAdmin',
    effectivePermissions: new Set(['integration.manage']),
  }
  const connectionId = googleConnectionId('11111111-1111-4111-8111-111111111111')

  function discoveryWithRefresh(refreshPolicyStoreRequired: () => Promise<void>) {
    const decide = vi.fn(async (): Promise<ExecutionDecision> => ({
      allowed: true,
      reason: 'allowed',
      action: 'integration.manage',
      policyVersion: 'beta-local-2',
    }))
    initExecutionPolicy({ decide })
    const ctx = buildIntegrationContext(
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
        refreshPolicyStoreRequired,
      }),
    )
    const discovery = ctx.internal.useCases.googleImportDiscovery
    expect(discovery).not.toBeNull()
    return { discovery: discovery!, decide }
  }

  it('reaches the execution policy after observing the static policy', async () => {
    const { discovery, decide } = discoveryWithRefresh(async () => {})

    await expect(discovery.listAccounts({ connectionId }, actor)).rejects.toMatchObject({
      code: 'unauthorized',
    })

    expect(decide).toHaveBeenCalled()
  })
})
