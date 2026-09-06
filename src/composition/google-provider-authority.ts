// Composition — the Google provider trust boundary.
//
// ARC-03-T10. One coherent graph used to sit inline in the composition root:
// provider-ephemeral storage, opaque OAuth state, the HMAC keyrings, the
// Google Content authorization authority, the per-capability content
// authorizers, the authorization-lease service and the mTLS egress gateway
// executor. It is the only place in the system that decides whether a Google
// provider call may happen at all, so it belongs in one named module with one
// pinned surface.
//
// Two invariants this module keeps:
//   * FAIL CLOSED. An absent runtime binding, an absent authority or an absent
//     keyring yields `unavailableGoogleContentAuthorization`, never a
//     permissive default.
//   * CONSTRUCTION ONLY. Nothing here queries the database or opens a provider
//     connection while the container is being built.
//
// It takes `env` as an argument and never re-reads ambient configuration
// (ARC-03-T14).

import type { Database } from '#/shared/db'
import type { Redis } from 'ioredis'
import type { Clock } from '#/shared/domain/clock'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { Env } from '#/shared/config/env'
import { createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto'
import { GOOGLE_CONTENT_CAPABILITIES } from '#/shared/auth/google-content-contract'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { ProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import { createRedisProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import { createProviderEphemeralRedis } from '#/shared/provider-ephemeral/redis-client'
import { createInMemoryProviderEphemeralStore } from '#/shared/provider-ephemeral/in-memory-store'
import { createProviderAuthorizationLeaseService } from '#/shared/provider-ephemeral/authorization-lease'
import { providerAuthorizationFenceSha256 } from '#/shared/provider-ephemeral/authorization-binding'
import {
  validateProviderEphemeralRedisUrls,
  verifyProviderEphemeralRedisRuntime,
  type ProviderRedisReadiness,
} from '#/shared/provider-ephemeral/runtime-verification'
import { createGoogleContentAuthorizationAuthority } from '#/shared/auth/google-content-authority'
import { createInProcessGoogleEgressRuntime } from './google-egress-runtime'
import { createGoogleContentAuthorityRepository } from '#/contexts/identity/infrastructure/repositories/google-content-authority.repository'
import { createGoogleContentAuthorizationCheck } from '#/contexts/integration/infrastructure/google-content-authorization-check'
import {
  authorityAdmissionCode,
  createGoogleAuthorizedProviderExecutor,
} from '#/contexts/integration/infrastructure/adapters/google-authorized-provider-executor.adapter'
import { createDurableGoogleImportReferenceStore } from '#/contexts/integration/infrastructure/durable-import-reference-store'
import { createGoogleDisconnectRevokeRepository } from '#/contexts/integration/infrastructure/repositories/google-disconnect-revoke.repository'
import { createGoogleProviderCredentialAdmission } from '#/contexts/integration/infrastructure/adapters/google-credential-provider-admission.adapter'
import {
  createOAuthStateHandleService,
  type OAuthStateHandleService,
} from '#/contexts/integration/application/oauth-state-handle'
import { createRedisGoogleRefreshCoordination } from '#/contexts/integration/infrastructure/adapters/google-refresh-coordination.adapter'
import type { GoogleOAuthProviderCallAuthorizer } from '#/contexts/integration/application/ports/google-oauth.port'
import type { GoogleImportContentAuthorizer } from '#/contexts/integration/application/google-import-command-authorizer'
import type { PerformanceContentAuthorizer } from '#/contexts/integration/application/google-performance-authorizer'
import type { GoogleReviewSyncContentAuthorizer } from '#/contexts/integration/application/google-review-sync-authorizer'
import type { GoogleReplyPublicationContentAuthorizer } from '#/contexts/integration/application/google-reply-publication-authorizer'
import type { ProviderOverrides } from './provider-runtime'

/** The exact capability set this module owns. Pinned by its test. */
export const GOOGLE_PROVIDER_AUTHORITY_KEYS = [
  'authorizeGoogleImportContent',
  'authorizeGoogleOAuthProviderCall',
  'authorizeGooglePerformanceContent',
  'authorizeGoogleReplyPublicationContent',
  'authorizeGoogleReviewSyncContent',
  'googleAuthorizedProviderExecutor',
  'googleDisconnectRevokeStore',
  'googleImportReferences',
  'googleImportReplayKeys',
  'googleOpaqueReferenceKeys',
  'googlePerformancePrincipalKeys',
  'googleRefreshCoordination',
  'oauthStateHandles',
  'providerAuthorizationLeases',
  'providerEphemeralReadiness',
  'providerEphemeralRedis',
  'providerEphemeralStore',
] as const

export type GoogleProviderAuthorityMode = 'required' | 'refusing'

export const OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE =
  '[COMPOSITION] Google provider calls require a provider-enabled application path with provider-ephemeral Redis and Google keyrings; the substrate-free operator container refuses them'
// WP2.2 step 3: `GoogleContentAuthorityRuntime` used to live here — a parse of
// `GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON` into a capability-keyed map of
// installed approvals, plus the Ed25519 verifier for their role signatures, and
// a `googleContentCapabilityRefusal` slice so the refusal explainer could say
// which approval was missing.
//
// All of it is gone with the approval bundle. A runtime binding is now just a
// capability, so the map carried no information: every enablement decision that
// anyone actually exercises is made per-request against live tables, by
// `organization_capability`/`property_capability` grants and the
// `killedCapabilities` kill switch.

export type GoogleProviderAuthorityInput = Readonly<{
  db: Database
  clock: Clock
  logger: Pick<LoggerPort, 'warn' | 'info'>
  /** Parsed configuration, supplied once by the composition boundary. */
  env: Env
  /** Operator processes retain the Integration interface but deny provider calls. */
  mode?: GoogleProviderAuthorityMode
  redis: Redis | undefined
  /** Google's approved provider endpoints, already resolved and overridden. */
  providerEndpoints: Readonly<Record<'gbpApiBaseUrl' | string, string>>
  /**
   * Identity-owned authority facts this trust boundary must consult. Both are
   * typed from their consumers so the seam cannot drift from what the Google
   * Content authority actually calls.
   */
  identity: Readonly<{
    hasActivePropertyGrant: Parameters<
      typeof createGoogleContentAuthorizationCheck
    >[0]['hasActivePropertyGrant']
  }>
  /**
   * Pre-parsed Google Content bindings and the verifier shared with diagnostic
   * composition. Direct builders may omit this and parse exactly once here.
   */
  options?: Readonly<{
    providerEphemeralStore?: ProviderEphemeralStore
    providers?: ProviderOverrides
  }>
}>

function buildRefusingGoogleProviderAuthority(logger: Pick<LoggerPort, 'warn' | 'info'>) {
  const warnRefusal = (): void => {
    logger.warn(
      { stage: 'google-provider-authority', code: 'operator_container_refusal' },
      OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE,
    )
  }
  const refuseContent = async () => {
    warnRefusal()
    return Object.freeze({ ok: false as const, code: 'runtime_unavailable' as const })
  }
  const authorizeGoogleImportContent: GoogleImportContentAuthorizer = refuseContent
  const authorizeGooglePerformanceContent: PerformanceContentAuthorizer = refuseContent
  const authorizeGoogleReviewSyncContent: GoogleReviewSyncContentAuthorizer =
    refuseContent
  const authorizeGoogleReplyPublicationContent: GoogleReplyPublicationContentAuthorizer =
    refuseContent
  const refuseWithError = async (): Promise<never> => {
    warnRefusal()
    throw new Error(OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE)
  }
  const authorizeGoogleOAuthProviderCall: GoogleOAuthProviderCallAuthorizer =
    refuseWithError
  const oauthStateHandles: OAuthStateHandleService = Object.freeze({
    issue: refuseWithError,
    redeem: refuseWithError,
  })

  logger.info(
    {},
    'Google provider authority omitted — operator container refuses provider calls',
  )
  return Object.freeze({
    providerEphemeralRedis: undefined,
    providerEphemeralStore: undefined,
    providerEphemeralReadiness: undefined,
    oauthStateHandles,
    googleImportReplayKeys: undefined,
    googleOpaqueReferenceKeys: undefined,
    googleRefreshCoordination: undefined,
    providerAuthorizationLeases: undefined,
    googleImportReferences: undefined,
    googlePerformancePrincipalKeys: undefined,
    authorizeGoogleImportContent,
    authorizeGooglePerformanceContent,
    authorizeGoogleReviewSyncContent,
    authorizeGoogleReplyPublicationContent,
    authorizeGoogleOAuthProviderCall,
    googleDisconnectRevokeStore: undefined,
    googleAuthorizedProviderExecutor: undefined,
  } as const)
}

// Accepted residual: this is one trust-boundary graph with many fail-closed
// branches; splitting it further would scatter the decision.
// fallow-ignore-next-line complexity
export function buildGoogleProviderAuthority(input: GoogleProviderAuthorityInput) {
  if (input.mode === 'refusing') {
    return buildRefusingGoogleProviderAuthority(input.logger)
  }
  const { db, clock, logger, env, redis, providerEndpoints } = input
  const options = input.options

  let providerEphemeralRedis: Redis | undefined
  let providerEphemeralStore = options?.providerEphemeralStore
  let oauthStateHandles: ReturnType<typeof createOAuthStateHandleService> | undefined
  let providerEphemeralReadiness: Promise<ProviderRedisReadiness> | undefined
  let googleImportReplayKeys: ReturnType<typeof createVersionedHmacKeyring> | undefined
  let googleOpaqueReferenceKeys: ReturnType<typeof createVersionedHmacKeyring> | undefined
  {
    if (!providerEphemeralStore && env.PROVIDER_EPHEMERAL_REDIS_URL) {
      if (env.NODE_ENV === 'production') {
        const urlFailure = validateProviderEphemeralRedisUrls(
          env.PROVIDER_EPHEMERAL_REDIS_URL,
          env.REDIS_URL,
          env.QUEUE_REDIS_URL,
        )
        if (urlFailure) {
          throw new Error(`Provider-ephemeral Redis denied: ${urlFailure.code}`)
        }
      }
      providerEphemeralRedis = createProviderEphemeralRedis(
        env.PROVIDER_EPHEMERAL_REDIS_URL,
        env.PROVIDER_EPHEMERAL_REDIS_CA_PEM,
      )
      providerEphemeralStore = createRedisProviderEphemeralStore(providerEphemeralRedis)
      providerEphemeralReadiness =
        verifyProviderEphemeralRedisRuntime(providerEphemeralRedis)
    }
    if (!providerEphemeralStore) {
      if (env.NODE_ENV === 'production') {
        throw new Error('Opaque OAuth state requires provider-ephemeral Redis')
      }
      providerEphemeralStore = createInMemoryProviderEphemeralStore()
    }
    // Non-production fallback keyrings, derived per purpose.
    //
    // This used to be one `sha256(OAUTH_STATE_SECRET)` shared by BOTH keyrings,
    // which had two problems. A single fast hash is not a key-derivation
    // function, and — the one that actually matters — two distinct HMAC
    // purposes were signing with the same key, so a reference token and a
    // replay token were interchangeable even in development.
    //
    // HKDF with the variable name as `info` gives real domain separation: each
    // keyring gets a different key, and neither is the configured secret.
    // Production never reaches this: it throws for a missing keyring above.
    const fallbackKeyFor = (name: string): string =>
      Buffer.from(
        hkdfSync(
          'sha256',
          env.OAUTH_STATE_SECRET,
          'repkey/google-provider-authority/local-fallback',
          name,
          32,
        ),
      ).toString('hex')
    const requiredKeyring = (raw: string | undefined, name: string): string => {
      if (raw) return raw
      if (env.NODE_ENV === 'production') {
        throw new Error(`${name} is required for opaque OAuth state`)
      }
      return `local:${fallbackKeyFor(name)}`
    }
    googleOpaqueReferenceKeys = createVersionedHmacKeyring(
      requiredKeyring(
        env.GOOGLE_OPAQUE_REFERENCE_HMAC_KEYS,
        'GOOGLE_OPAQUE_REFERENCE_HMAC_KEYS',
      ),
    )
    googleImportReplayKeys = createVersionedHmacKeyring(
      requiredKeyring(env.GOOGLE_REPLAY_HMAC_KEYS, 'GOOGLE_REPLAY_HMAC_KEYS'),
    )
    oauthStateHandles = createOAuthStateHandleService({
      store: providerEphemeralStore,
      handleKeys: createVersionedHmacKeyring(
        requiredKeyring(
          env.GOOGLE_OAUTH_STATE_HANDLE_HMAC_KEYS,
          'GOOGLE_OAUTH_STATE_HANDLE_HMAC_KEYS',
        ),
      ),
      sessionKeys: createVersionedHmacKeyring(
        requiredKeyring(
          env.GOOGLE_SESSION_BINDING_HMAC_KEYS,
          'GOOGLE_SESSION_BINDING_HMAC_KEYS',
        ),
      ),
      ensureRuntimeReady: providerEphemeralReadiness
        ? async () => {
            const readiness = await providerEphemeralReadiness!
            if (!readiness.ok) {
              throw new Error(`Provider-ephemeral Redis denied: ${readiness.code}`)
            }
          }
        : undefined,
    })
  }

  if (env.NODE_ENV === 'production' && !redis) {
    throw new Error('Production Google credential refresh coordination requires Redis')
  }
  const googleRefreshCoordination =
    redis && googleOpaqueReferenceKeys
      ? createRedisGoogleRefreshCoordination({
          redis,
          connectionKeys: googleOpaqueReferenceKeys,
          nowMs: () => clock().getTime(),
          sleep: (durationMs) =>
            new Promise<void>((resolve) => {
              setTimeout(resolve, durationMs)
            }),
          ownerId: randomUUID,
          jitterSample: () => randomBytes(4).readUInt32BE(0),
        })
      : undefined

  // WP2.2 step 3: the authority used to exist only when an installed approval
  // bundle had been parsed out of the environment, which is why every consumer
  // below was written defensively against it being undefined. Nothing gates it
  // now — it is a permit issuer over the live kill switch and the live policy
  // resolver, both always available — so it is constructed unconditionally.
  const googleContentAuthorityStore = createGoogleContentAuthorityRepository(db)
  const googleContentAuthority = createGoogleContentAuthorizationAuthority({
    store: googleContentAuthorityStore,
    clock,
    newPermitId: randomUUID,
    isRegisteredOperator: () => false,
    authorize: createGoogleContentAuthorizationCheck({
      clock,
      hasActivePropertyGrant: input.identity.hasActivePropertyGrant,
    }),
  })
  const ensureProviderEphemeralReady = providerEphemeralReadiness
    ? async () => {
        const readiness = await providerEphemeralReadiness
        if (!readiness.ok) {
          throw new Error(`Provider-ephemeral Redis denied: ${readiness.code}`)
        }
      }
    : undefined
  const defaultProviderAuthorizationLeases =
    providerEphemeralStore && googleOpaqueReferenceKeys
      ? createProviderAuthorizationLeaseService({
          store: providerEphemeralStore,
          handleKeys: googleOpaqueReferenceKeys,
          randomNonce: () => randomBytes(32).toString('base64url'),
          ensureRuntimeReady: ensureProviderEphemeralReady,
          revalidate: async (record) => {
            const runtimeBinding = { capability: record.capability } as const
            try {
              const result = await googleContentAuthority.preauthorize({
                runtimeBinding,
                scope: {
                  organizationId: record.organizationId,
                  propertyId: record.propertyId,
                  connectionId: record.connectionId,
                  initiatorUserId: record.initiatorUserId,
                },
                operationKey: `${record.audience}.lease_renewal`,
              })
              if (!result.ok) {
                return {
                  allowed: false,
                  approvalBindingId: null,
                  authorizationFenceSha256: null,
                }
              }
              const lifecycleVersion =
                result.authorizationVector.connectionLifecycleVersion
              const accessVersion = result.authorizationVector.connectionAccessVersion
              const credentialGeneration = result.authorizationVector.credentialGeneration
              if (
                !Number.isSafeInteger(lifecycleVersion) ||
                !Number.isSafeInteger(accessVersion) ||
                !Number.isSafeInteger(credentialGeneration)
              ) {
                return {
                  allowed: false,
                  approvalBindingId: null,
                  authorizationFenceSha256: null,
                }
              }
              return {
                allowed: true,
                authorizationFenceSha256: providerAuthorizationFenceSha256({
                  connectionLifecycleVersion: lifecycleVersion as number,
                  connectionAccessVersion: accessVersion as number,
                  authorizationVector: result.authorizationVector,
                }),
              }
            } catch {
              return {
                allowed: false,
                approvalBindingId: null,
                authorizationFenceSha256: null,
              }
            }
          },
        })
      : undefined
  const providerAuthorizationLeases =
    options?.providers?.providerAuthorizationLeases ?? defaultProviderAuthorizationLeases
  const googleImportReferences =
    options?.providers?.googleImportReferences ??
    (googleOpaqueReferenceKeys && providerAuthorizationLeases
      ? createDurableGoogleImportReferenceStore({
          db,
          handleKeys: googleOpaqueReferenceKeys,
          leasePrincipalKeys: googleOpaqueReferenceKeys,
          leases: providerAuthorizationLeases,
          clock,
        })
      : undefined)
  const googlePerformancePrincipalKeys =
    options?.providers?.googlePerformancePrincipalKeys ?? googleOpaqueReferenceKeys

  const unavailableGoogleContentAuthorization = Object.freeze({
    ok: false as const,
    code: 'runtime_unavailable' as const,
  })

  /**
   * Every Google Content refusal goes through here, so it always names the
   * surface it came from and the code that decided it.
   *
   * WHY: only the import authorizer used to log, and on 2026-09-01 that single
   * line was the only reason a control-plane outage was diagnosable at all — it
   * said `approval_unavailable`, which pointed straight at a stale route
   * catalogue in the approval row. The same cause reached three other surfaces
   * silently: the performance panel returned an empty 200 with nothing logged,
   * review sync and reply publication reported `runtime_unavailable` with
   * nothing logged, and the OAuth callback flattened it to `connection_failed`.
   * One root cause, four symptoms, one log line between them.
   *
   * An absent binding is reported too, and is the more insidious case: it
   * short-circuits before any database access, so a capability with no binding
   * key — `property.connect_gbp` and `property.publish_reply` have none in this
   * deployment — refuses every call for the lifetime of the process while
   * leaving no evidence anywhere that it was ever asked.
   */
  type GoogleContentSurface =
    'import' | 'performance' | 'review-sync' | 'reply-publication'
  type GoogleContentRefusal = Readonly<{
    ok: false
    code: 'authorization_denied' | 'runtime_unavailable'
  }>

  const refuseDenied = (
    surface: GoogleContentSurface,
    code: string,
  ): GoogleContentRefusal => {
    logger.warn(
      { stage: 'google-content-preauthorize', surface, code },
      'Google Content authorization denied',
    )
    return code === 'authorization_denied' || code === 'authorization_changed'
      ? Object.freeze({ ok: false as const, code: 'authorization_denied' as const })
      : unavailableGoogleContentAuthorization
  }
  const authorizeGoogleImportContent: GoogleImportContentAuthorizer =
    options?.providers?.authorizeGoogleImportContent ??
    (async (input) => {
      const binding = { capability: 'property.import_gbp_v2' } as const
      const result = await googleContentAuthority
        .preauthorize({
          runtimeBinding: binding,
          scope: {
            organizationId: input.actor.organizationId,
            propertyId: null,
            connectionId: input.connectionId,
            initiatorUserId: input.actor.userId,
          },
          operationKey: `import.${input.phase}`,
        })
        .catch((err: unknown) => {
          logger.warn({ err }, 'Google Content preauthorization failed')
          throw err
        })
      if (result.ok) return result
      return refuseDenied('import', result.code)
    })
  const authorizeGooglePerformanceContent: PerformanceContentAuthorizer =
    options?.providers?.authorizeGooglePerformanceContent ??
    (async (input) => {
      const binding = { capability: 'property.read_gbp_performance' } as const
      const result = await googleContentAuthority.preauthorize({
        runtimeBinding: binding,
        scope: {
          organizationId: input.actor.organizationId,
          propertyId: input.propertyId,
          connectionId: input.connectionId,
          initiatorUserId: input.actor.userId,
        },
        operationKey: `performance.${input.phase}`,
      })
      return result.ok ? result : refuseDenied('performance', result.code)
    })
  const authorizeGoogleReviewSyncContent: GoogleReviewSyncContentAuthorizer =
    options?.providers?.authorizeGoogleReviewSyncContent ??
    (async (input) => {
      const binding = { capability: 'property.connect_gbp' } as const
      const result = await googleContentAuthority.preauthorize({
        runtimeBinding: binding,
        scope: {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          connectionId: input.connectionId,
          initiatorUserId: null,
        },
        operationKey: input.operationKey,
      })
      return result.ok ? result : refuseDenied('review-sync', result.code)
    })
  const authorizeGoogleReplyPublicationContent: GoogleReplyPublicationContentAuthorizer =
    options?.providers?.authorizeGoogleReplyPublicationContent ??
    (async (input) => {
      const binding = { capability: 'property.publish_reply' } as const
      const result = await googleContentAuthority.preauthorize({
        runtimeBinding: binding,
        scope: {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          connectionId: input.connectionId,
          initiatorUserId: null,
          publication: {
            reviewId: input.reviewId,
            replyId: input.replyId,
            publicationCycle: input.publicationCycle,
            attemptNumber: input.attemptNumber,
            sourceEpoch: input.sourceEpoch,
            materialReviewRevision: input.materialReviewRevision,
          },
        },
        operationKey: input.operationKey,
      })
      return result.ok ? result : refuseDenied('reply-publication', result.code)
    })
  const authorizeGoogleOAuthProviderCall: GoogleOAuthProviderCallAuthorizer =
    options?.providers?.authorizeGoogleOAuthProviderCall ??
    (async (input) => {
      if (input.disconnectRevoke && input.operation !== 'oauth.revoke') {
        throw new Error('Google OAuth cleanup authority is inconsistent')
      }
      // Every denial below is logged with the deciding code before it throws.
      // The import path already does this (`Google Content authorization
      // denied`, above) and it is the only reason the 2026-09-01 outage was
      // diagnosable at all: the log named `approval_unavailable`, which pointed
      // straight at the approval row. This path threw a bare Error instead, so
      // the identical root cause surfaced to the operator as nothing but
      // `connection_failed` in the OAuth callback — a generic, retryable-looking
      // message for a control-plane condition that no retry can clear. The
      // thrown Error is deliberately left message-identical and code-free: it
      // reaches `connectFailureCode` (routes/api/auth/google/callback.ts), which
      // maps anything but `account_already_connected` to `connection_failed`,
      // and the user-facing surface must not leak authorization internals.
      // The operator signal belongs in the log, not in the response.
      const binding = { capability: 'property.import_gbp_v2' } as const
      const result = await googleContentAuthority.preauthorize({
        runtimeBinding: binding,
        scope: {
          organizationId: input.organizationId,
          propertyId: null,
          connectionId: input.connectionId,
          initiatorUserId: input.initiatorUserId,
        },
        operationKey: input.operation,
      })
      const credentialGeneration = result.ok
        ? result.authorizationVector.credentialGeneration
        : null
      if (
        !result.ok ||
        typeof credentialGeneration !== 'number' ||
        !Number.isSafeInteger(credentialGeneration) ||
        credentialGeneration < 0
      ) {
        logger.warn(
          {
            stage: 'google-oauth-preauthorize',
            // A denial reports the authority's own code; an ok result that got
            // this far failed the credential-generation invariant instead, and
            // saying which keeps the two apart in the log.
            code: result.ok ? 'credential_generation_invalid' : result.code,
            operation: input.operation,
          },
          'Google OAuth authorization denied',
        )
        throw new Error('Google OAuth provider authorization is unavailable')
      }
      return Object.freeze({
        capability: 'property.import_gbp_v2' as const,
        organizationId: organizationId(input.organizationId),
        propertyId: null,
        connectionId: googleConnectionId(input.connectionId),
        initiatorUserId: input.initiatorUserId,
        expectedCredentialGeneration: credentialGeneration,
        authorizationVector: result.authorizationVector,
        ...(input.disconnectRevoke
          ? {
              disconnectRevoke: Object.freeze({
                attemptId: input.disconnectRevoke.attemptId,
                cleanupDeadlineAtMs: input.disconnectRevoke.cleanupDeadlineAt.getTime(),
              }),
            }
          : {}),
      })
    })

  const googleDisconnectRevokeStore = createGoogleDisconnectRevokeRepository(db)

  // WP2.1: the egress runtime is in this process, so "configured" no longer
  // means "an origin, a server name and a private CA are present". It means the
  // two secrets the runtime signs with, the identity permits are bound to, and
  // a Redis to coordinate quota through. The six `GOOGLE_INTERNAL_MTLS_*`
  // variables, both gateway origins and both admission server names are gone.
  const gatewayConfig = [
    env.GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS,
    env.GOOGLE_ADMISSION_GRANT_HMAC_KEYS,
    env.GOOGLE_EGRESS_GATEWAY_IDENTITY,
  ] as const
  const configuredGatewayValues = gatewayConfig.filter(
    (value): value is string => value !== undefined,
  )
  if (
    configuredGatewayValues.length !== 0 &&
    configuredGatewayValues.length !== gatewayConfig.length
  ) {
    throw new Error('Google egress runtime configuration is incomplete')
  }
  // Permits are bound to the revision that issued them. The sidecar read
  // `RELEASE_SHA` from its own environment; in-process it is the same fact the
  // release identity already resolved, so there is one source rather than two
  // that can disagree.
  const releaseRevision = env.RELEASE_SHA ?? env.IMAGE_SOURCE_REVISION
  let googleAuthorizedProviderExecutor =
    options?.providers?.googleAuthorizedProviderExecutor
  // WP2.2 step 3: this fork used to have three outcomes because an approval
  // bundle could be absent or expired while the gateway was configured. There
  // is no bundle now, so `approvalUsable` is permanently true and
  // `googleApprovalGapDisposition` reduces to "is the gateway configured".
  //
  // That is the whole point of the deletion: the 29-day approval window was the
  // mechanism that turned Google off, and the `disable` posture existed to keep
  // the rest of the product up when it lapsed. With the window gone, a
  // configured gateway is a working gateway.
  // The permit's project identity. It used to be `googleProjectAttestationSha256`
  // off the signed approval binding — a digest an operator pinned by hand at
  // approval time. What it has to do is identify the Google project this permit
  // was issued against, so that a permit cannot be spent under a different one,
  // and the OAuth client id IS that project's identity. Digested rather than
  // stored raw because the value lands in an authorization vector that is
  // persisted and logged, and SQL asserts the vector's `projectFingerprint` is
  // 64 hex characters.
  // Lazy on purpose. Computing it eagerly broke `constructs without touching the
  // database` — the operator container builds this graph from an environment
  // that has no `GOOGLE_CLIENT_ID`, and a digest of `undefined` throws at
  // construction rather than at the call that needs it. Memoized because the
  // value is per-process constant and this sits on the admission path.
  let projectFingerprint: string | undefined
  const googleProjectFingerprint = (): string => {
    projectFingerprint ??= createHash('sha256')
      .update(env.GOOGLE_CLIENT_ID, 'utf8')
      .digest('hex')
    return projectFingerprint
  }
  const gatewayConfigured = configuredGatewayValues.length > 0
  if (gatewayConfigured) {
    logger.info(
      { capabilities: [...GOOGLE_CONTENT_CAPABILITIES].sort() },
      'Google provider executor wired',
    )
  } else {
    logger.info(
      {},
      'Google provider not configured — no egress gateway in this environment',
    )
  }
  if (!googleAuthorizedProviderExecutor && gatewayConfigured) {
    // Fail closed, and say which prerequisite is missing. Quota and in-flight
    // coordination are shared with the other process, so a runtime without the
    // coordination Redis would silently drop the only limit Google actually
    // enforces; a runtime without a revision cannot bind a permit to one.
    if (!providerEphemeralRedis) {
      throw new Error('Google egress runtime requires provider-ephemeral Redis')
    }
    if (!releaseRevision) {
      throw new Error('Google egress runtime requires a release revision')
    }
    const [credentialBindingKeys, grantKeys, gatewayIdentity] = configuredGatewayValues
    // One definition. The executor compiles the admission metadata and the
    // gateway compiles the request it actually sends; if these two disagreed
    // about the target, the request binding would not match the permit.
    const routeTarget =
      env.GOOGLE_PROVIDER_ENDPOINT_PROFILE === 'local-sandbox'
        ? ({
            kind: 'local_sandbox',
            simulatorOrigin: new URL(providerEndpoints.gbpApiBaseUrl).origin,
          } as const)
        : ({ kind: 'production' } as const)
    const { gateway, bindCredential } = createInProcessGoogleEgressRuntime({
      // `db.$client` IS the pool the composition root opened. Taking it from
      // the Database rather than as a second parameter makes it impossible to
      // hand the permit authority a pool that is not the one running the
      // transactions it is authorizing.
      pool: db.$client,
      redis: providerEphemeralRedis,
      nowMs: () => clock().getTime(),
      gatewayIdentity,
      releaseSha: releaseRevision,
      credentialBindingKeys,
      grantKeys,
      routeTarget,
      logger,
    })
    googleAuthorizedProviderExecutor = createGoogleAuthorizedProviderExecutor({
      bindCredential,
      disconnectRevoke: {
        prepare: googleDisconnectRevokeStore.prepare,
        acquireDispatch: googleDisconnectRevokeStore.acquireDispatch,
      },
      now: clock,
      admitCredentialExecution: createGoogleProviderCredentialAdmission(db),
      routeTarget,
      admit: async ({ authorization, admission }) => {
        const binding = { capability: authorization.capability } as const
        if (!binding) return { ok: false, code: 'runtime_unavailable' }
        const result = await googleContentAuthority!.admit({
          runtimeBinding: binding,
          scope: {
            organizationId: authorization.organizationId,
            propertyId: authorization.propertyId,
            connectionId: authorization.connectionId,
            initiatorUserId: authorization.initiatorUserId,
            ...(authorization.capability === 'property.publish_reply'
              ? { publication: authorization.publication }
              : {}),
          },
          expectedAuthorizationVector: authorization.authorizationVector,
          operationKey: `provider.${admission.routeKey}`,
          routeKey: admission.routeKey,
          routeCatalogVersion: admission.catalogueVersion,
          quotaPolicyId: admission.quotaPolicyId,
          providerRequestBinding: {
            requestBindingSha256: admission.requestBindingSha256,
            credentialBinding: admission.credentialBinding,
            projectFingerprint: googleProjectFingerprint(),
            requestBodySha256: admission.requestBodySha256,
            requestBodyBytes: admission.requestBodyBytes,
          },
        })
        return result.ok
          ? { ok: true as const, permitId: result.permit.id }
          : { ok: false as const, code: authorityAdmissionCode(result.code) }
      },
      gateway,
      logger,
    })
  }

  return Object.freeze({
    providerEphemeralRedis,
    providerEphemeralStore,
    providerEphemeralReadiness,
    oauthStateHandles,
    googleImportReplayKeys,
    googleOpaqueReferenceKeys,
    googleRefreshCoordination,
    providerAuthorizationLeases,
    googleImportReferences,
    googlePerformancePrincipalKeys,
    authorizeGoogleImportContent,
    authorizeGooglePerformanceContent,
    authorizeGoogleReviewSyncContent,
    authorizeGoogleReplyPublicationContent,
    authorizeGoogleOAuthProviderCall,
    googleDisconnectRevokeStore,
    googleAuthorizedProviderExecutor,
  } as const)
}
