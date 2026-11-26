// Integration build — provider override proof (BQC-6.1).
//
// The composition-level characterization test can only observe the storage
// override at the container boundary; the googleOAuth slots thread
// into THIS build seam, so the honored-override proof lives here.
// Construction is query-free: the DB is a Proxy that throws on any access.

import { describe, it, expect, afterEach, vi } from 'vitest'
import type { Database } from '#/shared/db'
import type {
  PropertyGoogleBindingPublicApi,
  PropertyPublicApi,
} from '#/contexts/property/public-api'
import { GOOGLE_REVIEW_API_NOT_CONFIGURED_CODE } from '#/contexts/reputation/public-api'
import type { GoogleProviderEndpoints } from './build'
import { createInMemoryQueue } from '#/shared/testing/in-memory-queue'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { buildIntegrationContext } from './build'
import { createGoogleConnectionsRuntime } from './connections/connections-runtime.server'
import type { GoogleAuthorizedProviderExecutor } from './provider/google-client.port.server'
import type { GoogleImportReferenceStore } from './imports/durable-import-reference-store.port.server'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { ProviderAuthorizationLeaseService } from '#/shared/provider-ephemeral/authorization-lease'
import type { OAuthStateHandleService } from './application/oauth-state-handle'
import type { OAuthCallbackAbuseGate } from './connections/oauth-callback-abuse-gate.server'
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
  googleCallbackUrl: 'https://app.example.test/api/auth/google/callback',
  pubsubTopic: '',
  pubsubNotificationTypes: 'NEW_REVIEW',
}

const refuseContent = async () => ({ ok: false, code: 'runtime_unavailable' }) as const

const inertAbuseGate: OAuthCallbackAbuseGate = Object.freeze({
  admitPreState: async () => ({ ok: true }) as const,
  admitResolvedTenant: async () => ({ ok: true }) as const,
})

function buildDeps(overrides: {
  googleOAuth?: ReturnType<typeof createInMemoryGoogleOAuthPort>
  googleAuthorizedProviderExecutor?: GoogleAuthorizedProviderExecutor
  googleImportReferences?: GoogleImportReferenceStore
  propertyBindingApi?: PropertyGoogleBindingPublicApi
  googleImportReplayKeys?: ReturnType<typeof createVersionedHmacKeyring>
  googlePerformancePrincipalKeys?: ReturnType<typeof createVersionedHmacKeyring>
  providerAuthorizationLeases?: ProviderAuthorizationLeaseService
  oauthStateHandles?: OAuthStateHandleService
}) {
  return {
    db: dbStub,
    prepareImportSync: vi.fn(async () => undefined),
    outboxRepo: {} as unknown as OutboxRepository,
    clock: () => new Date('2026-01-15T12:00:00.000Z'),
    idGen: () => '00000000-0000-4000-8000-000000000101',
    jobQueue: createInMemoryQueue(),
    propertyApi: {} as unknown as PropertyPublicApi,
    propertyBindingApi: {} as unknown as PropertyGoogleBindingPublicApi,
    enqueueReviewSync: vi.fn(),
    enqueueTargetedReviewFetch: vi.fn(),
    defaultPublicDisplayName: vi.fn(),
    logger: createMockLogger(),
    providerEndpoints: ENDPOINTS,
    config: CONFIG,
    oauthStateHandles: {} as unknown as OAuthStateHandleService,
    oauthCallbackAbuseGate: inertAbuseGate,
    authorizeGoogleImportContent: refuseContent,
    authorizeGoogleReviewSyncContent: refuseContent,
    authorizeGoogleReplyPublicationContent: refuseContent,
    authorizeGooglePerformanceContent: refuseContent,
    ...overrides,
  }
}

function connectionsDeps(overrides: {
  googleOAuth?: ReturnType<typeof createInMemoryGoogleOAuthPort>
}) {
  const deps = buildDeps({})
  return {
    db: deps.db,
    clock: deps.clock,
    idGen: deps.idGen,
    logger: deps.logger,
    config: deps.config,
    oauthJwksUrl: deps.providerEndpoints.oauthJwksUrl,
    googleOAuth: overrides.googleOAuth,
    googleAuthorizedProviderExecutor: undefined,
    googleDisconnectRevokeStore: undefined,
    authorizeGoogleOAuthProviderCall: undefined,
    oauthStateHandles: deps.oauthStateHandles,
    oauthCallbackAbuseGate: deps.oauthCallbackAbuseGate,
    googleRefreshCoordination: undefined,
  }
}

describe('buildIntegrationContext provider slots (BQC-6.1)', () => {
  it('exposes frozen capabilities for requests, maintenance, webhook, and workers', () => {
    const ctx = buildIntegrationContext(buildDeps({}))

    expect(Object.keys(ctx).sort()).toEqual([
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
    expect(Object.keys(ctx.worker).sort()).toEqual([
      'completeImportsForRestore',
      'processImportItem',
      'reconcileNotificationSubscriptions',
      'reconcileProviderRecovery',
      'recoverImports',
      'registerOutboxConsumers',
      'sweepImportLifecycle',
    ])

    expect(Object.isFrozen(ctx.publicApi)).toBe(true)
    expect(Object.isFrozen(ctx.publicApi.connections)).toBe(true)
    expect(Object.isFrozen(ctx.publicApi.oauth)).toBe(true)
    expect(Object.isFrozen(ctx.publicApi.imports)).toBe(true)
    expect(Object.isFrozen(ctx.publicApi.performance)).toBe(true)
    expect(Object.isFrozen(ctx.maintenance)).toBe(true)
    expect(Object.isFrozen(ctx.maintenance.imports)).toBe(true)
    expect(Object.isFrozen(ctx.webhook)).toBe(true)
    expect(Object.isFrozen(ctx.worker)).toBe(true)
  })

  it('honors the injected googleOAuth override', () => {
    const googleOAuth = createInMemoryGoogleOAuthPort()
    const { oauthPort } = createGoogleConnectionsRuntime(connectionsDeps({ googleOAuth }))
    expect(oauthPort).toBe(googleOAuth)
  })

  it('constructs bounded import discovery only with every protected dependency', () => {
    const complete = buildIntegrationContext(
      buildDeps({
        googleAuthorizedProviderExecutor:
          {} as unknown as GoogleAuthorizedProviderExecutor,
        googleImportReferences: {} as unknown as GoogleImportReferenceStore,
        propertyBindingApi: {} as unknown as PropertyGoogleBindingPublicApi,
        googleImportReplayKeys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
      }),
    )
    const transportless = buildIntegrationContext(
      buildDeps({
        propertyBindingApi: {} as unknown as PropertyGoogleBindingPublicApi,
      }),
    )

    expect(complete.publicApi.imports.discover).not.toBeNull()
    expect(transportless.publicApi.imports.discover).toBeNull()
    expect(complete.publicApi.imports.transact).not.toBeNull()
    expect(transportless.publicApi.imports.transact).toBeNull()
    expect(complete.worker.processImportItem).not.toBeNull()
    expect(transportless.worker.processImportItem).not.toBeNull()
  })

  it('constructs live Performance only with every protected dependency', () => {
    const complete = buildIntegrationContext(
      buildDeps({
        propertyBindingApi: {} as unknown as PropertyGoogleBindingPublicApi,
        googleAuthorizedProviderExecutor:
          {} as unknown as GoogleAuthorizedProviderExecutor,
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
        googlePerformancePrincipalKeys: createVersionedHmacKeyring(
          `v1:${'22'.repeat(32)}`,
        ),
      }),
    )

    expect(complete.publicApi.performance.get).not.toBeNull()
    expect(complete.publicApi.performance.renewLease).not.toBeNull()
    expect(missingLease.publicApi.performance.get).toBeNull()
    expect(missingLease.publicApi.performance.renewLease).toBeNull()
  })

  it('constructs the OAuth adapter without the in-memory fake helpers', () => {
    const { oauthPort: oauth } = createGoogleConnectionsRuntime(connectionsDeps({}))
    expect(typeof oauth.exchangeCode).toBe('function')
    expect(typeof oauth.refreshAccessToken).toBe('function')
    expect('setExchangeResult' in oauth).toBe(false)
  })

  it('refuses Google review calls when the governed executor is unavailable', async () => {
    const ctx = buildIntegrationContext(buildDeps({}))

    await expect(
      ctx.reviewSync.googleReviewApi.listReviewsPage({} as never),
    ).rejects.toThrow('Governed Google review API is unavailable')
  })

  it('refuses the Google head read the same way when the governed executor is unavailable', async () => {
    const ctx = buildIntegrationContext(buildDeps({}))

    await expect(
      ctx.reviewSync.googleReviewApi.readReviewsHead({} as never),
    ).rejects.toMatchObject({ code: GOOGLE_REVIEW_API_NOT_CONFIGURED_CODE })
  })

  it('marks the refusal of a process with no Google provider so a caller can tell it from an outage', async () => {
    const ctx = buildIntegrationContext(buildDeps({}))

    await expect(
      ctx.reviewSync.googleReviewApi.getReview({} as never),
    ).rejects.toMatchObject({ code: GOOGLE_REVIEW_API_NOT_CONFIGURED_CODE })
  })

  it('refuses OAuth without a governed executor before opening a credential socket', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    try {
      const { oauthPort } = createGoogleConnectionsRuntime(connectionsDeps({}))
      await expect(oauthPort.refreshAccessToken('refresh-token')).rejects.toMatchObject({
        code: 'token_refresh_failed',
      })
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
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

  function discoveryContext() {
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
        propertyBindingApi: {} as unknown as PropertyGoogleBindingPublicApi,
        googleImportReplayKeys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
      }),
    )
    const discovery = ctx.publicApi.imports.discover
    expect(discovery).not.toBeNull()
    return { discovery: discovery!, decide }
  }

  it('reaches the execution policy', async () => {
    const { discovery, decide } = discoveryContext()

    // The content authority is unavailable here, which is a dependency fault the
    // administrator can retry, not a change of their access.
    await expect(discovery.listAccounts({ connectionId }, actor)).rejects.toMatchObject({
      code: 'temporarily_unavailable',
    })

    expect(decide).toHaveBeenCalled()
  })
})
