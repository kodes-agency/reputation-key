import type { LoggerPort } from '#/shared/domain/logger.port'
import { getExecutionPolicy } from '#/shared/auth/execution-policy'
import type { ProviderAuthorizationLeaseService } from '#/shared/provider-ephemeral/authorization-lease'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { GooglePerformanceDependencyDescriptor } from '#/shared/architecture/google-performance-live-boundary'
import type { PropertyGoogleBindingPublicApi } from '#/contexts/property/application/public-api'
import {
  createActiveConnectionTokenProvider,
  type ActiveConnectionTokenProviderDeps,
} from '../application/active-connection-token-provider'
import { sameAuthorizationVectorExceptCredentialGeneration } from '../application/google-authorization-vector'
import {
  createGooglePerformanceAuthorizer,
  type PerformanceContentAuthorizer,
} from '../application/google-performance-authorizer'
import { createGetPropertyGooglePerformance } from '../application/get-property-google-performance'
import { createRenewGooglePerformanceLease } from '../application/renew-google-performance-lease'
import { createGooglePerformanceAdapter } from '../infrastructure/adapters/google-performance.adapter'
import type { ActiveMemberAuthResolver } from '../infrastructure/active-member-auth.adapter'
import type {
  GoogleAuthorizedProviderExecutor,
  GoogleRefreshingProviderExecutorFactory,
} from '../application/ports/google-authorized-provider-executor.port'

/**
 * ADR 0050 §10: the live Google Performance path may not depend on a write
 * repository, a queue/job, a server cache, or Metric. This array is the machine-
 * readable statement of what the real wiring below actually injects into
 * `createGetPropertyGooglePerformance` (see the block that assigns
 * `getPropertyGooglePerformance`) — one entry per injected dependency, naming
 * the property it is injected as and the module specifier it comes from.
 *
 * `src/shared/architecture/google-performance-live-boundary.test.ts` asserts
 * `validateGooglePerformanceLiveDependencies` over this array AND parses the
 * real call site to require the injected property names to match `injectedAs`
 * exactly, so a new injected dependency cannot be added without appearing here
 * (and therefore without facing the validator). The same test walks the use
 * case's transitive runtime module graph against the forbidden module paths, so
 * a forbidden dependency reached indirectly also fails.
 */
export type GooglePerformanceWiringDescriptor = GooglePerformanceDependencyDescriptor &
  Readonly<{ injectedAs: string }>

export const GOOGLE_PERFORMANCE_LIVE_DEPENDENCY_DESCRIPTORS: readonly GooglePerformanceWiringDescriptor[] =
  Object.freeze([
    // Interactive authorization seam (ExecutionPolicy + Google Content authority
    // + property binding read); no durable Performance write.
    Object.freeze({
      injectedAs: 'authorize',
      kind: 'execution_policy',
      modulePath: '#/contexts/integration/application/google-performance-authorizer',
    }),
    // Request-lifetime provider read adapter. It is under infrastructure/ but is
    // an adapter, not a repositories/jobs/queues/cache module.
    Object.freeze({
      injectedAs: 'fetchReport',
      kind: 'google_performance_source',
      modulePath:
        '#/contexts/integration/infrastructure/adapters/google-performance.adapter',
    }),
    Object.freeze({
      injectedAs: 'issueLease',
      kind: 'provider_content_lease',
      modulePath: '#/shared/provider-ephemeral/authorization-lease',
    }),
    Object.freeze({
      injectedAs: 'clock',
      kind: 'clock',
      modulePath: '#/shared/domain/clock',
    }),
  ])

export type GooglePerformanceRuntimeDeps = Readonly<{
  clock: () => Date
  logger: LoggerPort
  connectionRepo: ActiveConnectionTokenProviderDeps['connectionRepo']
  encryption: ActiveConnectionTokenProviderDeps['encryption']
  refreshGoogleToken: ActiveConnectionTokenProviderDeps['refreshGoogleToken']
  resolveActiveMember: ActiveMemberAuthResolver
  propertyBindingApi: PropertyGoogleBindingPublicApi | undefined
  executor: GoogleAuthorizedProviderExecutor | undefined
  withSingle401Refresh: GoogleRefreshingProviderExecutorFactory
  authorizeContent: PerformanceContentAuthorizer | undefined
  principalKeys: VersionedHmacKeyring | undefined
  leases: ProviderAuthorizationLeaseService | undefined
}>

export type GooglePerformanceRuntime = Readonly<{
  getPropertyGooglePerformance: ReturnType<
    typeof createGetPropertyGooglePerformance
  > | null
  renewGooglePerformanceLease: ReturnType<typeof createRenewGooglePerformanceLease> | null
}>

const UNAVAILABLE: GooglePerformanceRuntime = Object.freeze({
  getPropertyGooglePerformance: null,
  renewGooglePerformanceLease: null,
})

/**
 * Live Google Performance: authorization, a provider read and a renewable lease.
 * Nothing here is stored; absent any provider dependency the feature is off.
 */
export const createGooglePerformanceRuntime = (
  deps: GooglePerformanceRuntimeDeps,
): GooglePerformanceRuntime => {
  const {
    propertyBindingApi,
    executor,
    authorizeContent,
    principalKeys,
    leases,
    resolveActiveMember,
  } = deps
  if (
    !propertyBindingApi ||
    !executor ||
    !authorizeContent ||
    !principalKeys ||
    !leases
  ) {
    return UNAVAILABLE
  }
  const tokenProvider = createActiveConnectionTokenProvider({
    connectionRepo: deps.connectionRepo,
    encryption: deps.encryption,
    clock: deps.clock,
    refreshGoogleToken: deps.refreshGoogleToken,
  })
  const authorize = createGooglePerformanceAuthorizer({
    resolveActor: resolveActiveMember,
    readBinding: propertyBindingApi.readInternal,
    findConnection: deps.connectionRepo.findById,
    getAccessToken: tokenProvider.getAccessToken,
    decide: (request) => getExecutionPolicy().decide(request),
    authorizeGoogleContent: authorizeContent,
    principalKeys,
    clock: deps.clock,
    logger: deps.logger,
  })
  const providerExecutor = deps.withSingle401Refresh({
    executor,
    refreshAccessToken: ({ authorization }) =>
      tokenProvider.forceRefreshAccessToken(
        authorization.organizationId,
        authorization.connectionId,
        authorization.expectedCredentialGeneration,
      ),
    getAccessToken: ({ authorization }) =>
      tokenProvider.getAccessToken(
        authorization.organizationId,
        authorization.connectionId,
      ),
    reauthorize: async ({ authorization }) => {
      if (
        authorization.capability !== 'property.read_gbp_performance' ||
        authorization.propertyId === null ||
        authorization.initiatorUserId === null
      ) {
        throw new Error('Google Performance reauthorization is unavailable')
      }
      const actor = await resolveActiveMember(
        authorization.organizationId,
        authorization.initiatorUserId,
      )
      if (!actor) {
        throw new Error('Google Performance reauthorization is unavailable')
      }
      const refreshed = await authorize({
        actor,
        propertyId: authorization.propertyId,
        phase: 'before_provider',
        requireAccessToken: false,
      })
      if (!refreshed.ok) {
        throw new Error('Google Performance reauthorization is unavailable')
      }
      if (
        !sameAuthorizationVectorExceptCredentialGeneration(
          refreshed.snapshot.authorizationVector,
          authorization.authorizationVector,
        )
      ) {
        throw new Error('Google Performance reauthorization changed')
      }
      return {
        capability: 'property.read_gbp_performance',
        organizationId: refreshed.snapshot.organizationId,
        propertyId: refreshed.snapshot.propertyId,
        connectionId: refreshed.snapshot.connectionId,
        initiatorUserId: actor.userId,
        expectedCredentialGeneration: refreshed.snapshot.credentialGeneration,
        authorizationVector: refreshed.snapshot.authorizationVector,
      }
    },
  })
  const source = createGooglePerformanceAdapter({
    executor: providerExecutor,
    nowMs: () => deps.clock().getTime(),
  })
  // ADR 0050 §10 live boundary. Every property injected here MUST have a
  // matching entry in GOOGLE_PERFORMANCE_LIVE_DEPENDENCY_DESCRIPTORS above;
  // the architecture test parses this call and fails on any drift.
  const getPropertyGooglePerformance = createGetPropertyGooglePerformance({
    authorize,
    fetchReport: (input, actor, snapshot, accessToken) =>
      source.fetchReport(input, accessToken, {
        capability: 'property.read_gbp_performance',
        organizationId: snapshot.organizationId,
        propertyId: snapshot.propertyId,
        connectionId: snapshot.connectionId,
        initiatorUserId: actor.userId,
        expectedCredentialGeneration: snapshot.credentialGeneration,
        authorizationVector: snapshot.authorizationVector,
      }),
    issueLease: ({ actor, snapshot, absoluteDeadlineMs, nowMs }) =>
      leases.issue({
        audience: 'performance',
        capability: 'property.read_gbp_performance',
        organizationId: snapshot.organizationId,
        initiatorUserId: actor.userId,
        propertyId: snapshot.propertyId,
        connectionId: snapshot.connectionId,
        principalHmacKeyVersion: snapshot.principalHmacKeyVersion,
        principalHmac: snapshot.principalHmac,
        authorizationFenceSha256: snapshot.authorizationFenceSha256,
        absoluteDeadlineMs,
        nowMs,
      }),
    clock: deps.clock,
  })
  const renewGooglePerformanceLease = createRenewGooglePerformanceLease({
    authorize,
    renew: leases.renew,
    clock: deps.clock,
    logger: deps.logger,
  })
  return Object.freeze({ getPropertyGooglePerformance, renewGooglePerformanceLease })
}
