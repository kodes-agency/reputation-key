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
import type { EventBus } from '#/shared/events/event-bus'
import type { Redis } from 'ioredis'
import type { Clock } from '#/shared/domain/clock'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { Env } from '#/shared/config/env'
import { hkdfSync, randomBytes, randomUUID } from 'node:crypto'
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
import {
  createGoogleContentRoleSignatureVerifier,
  parseGoogleContentRolePublicKeys,
} from '#/shared/auth/google-content-approval'
import { parseGoogleContentRuntimeBindings } from '#/shared/auth/google-content-runtime-bindings'
import { createGoogleCredentialBinder } from '#/shared/google-provider-control/credential-binding'
import { googleApprovalGapDisposition } from '#/shared/release/google-approval-gap'
import { createGoogleEgressGatewayHttpClient } from '../../services/google-egress-gateway/http-api'
import {
  createInternalMtlsJsonTransport,
  loadInternalMtlsMaterialFromOneSource,
} from '../../services/internal-mtls'
import { createGoogleContentAuthorityRepository } from '#/contexts/identity/infrastructure/repositories/google-content-authority.repository'
import { createGoogleContentAuthorizationCheck } from '#/contexts/integration/infrastructure/google-content-authorization-check'
import {
  authorityAdmissionCode,
  createGoogleAuthorizedProviderExecutor,
} from '#/contexts/integration/infrastructure/adapters/google-authorized-provider-executor.adapter'
import { createDurableGoogleImportReferenceStore } from '#/contexts/integration/infrastructure/durable-import-reference-store'
import { createGoogleDisconnectRevokeRepository } from '#/contexts/integration/infrastructure/repositories/google-disconnect-revoke.repository'
import { createDirectGoogleProviderCredentialAdmission } from '#/contexts/integration/infrastructure/adapters/google-credential-provider-admission.adapter'
import { createOAuthStateHandleService } from '#/contexts/integration/application/oauth-state-handle'
import { createRedisGoogleRefreshCoordination } from '#/contexts/integration/infrastructure/adapters/google-refresh-coordination.adapter'
import type { GoogleOAuthProviderCallAuthorizer } from '#/contexts/integration/application/ports/google-oauth.port'
import type { GoogleImportContentAuthorizer } from '#/contexts/integration/application/google-import-command-authorizer'
import type { PerformanceContentAuthorizer } from '#/contexts/integration/application/google-performance-authorizer'
import type { GoogleReviewSyncContentAuthorizer } from '#/contexts/integration/application/google-review-sync-authorizer'
import type { GoogleReplyPublicationContentAuthorizer } from '#/contexts/integration/application/google-reply-publication-authorizer'
import type { createDataCellExecutionFence } from '#/shared/routing/data-cell-execution-fence'
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

export type GoogleProviderAuthorityInput = Readonly<{
  db: Database
  eventBus: EventBus
  clock: Clock
  logger: Pick<LoggerPort, 'warn' | 'info'>
  /** Parsed configuration, supplied once by the composition boundary. */
  env: Env
  redis: Redis | undefined
  /** The cell's approved provider endpoints, already resolved and overridden. */
  providerEndpoints: Readonly<Record<'gbpApiBaseUrl' | string, string>>
  dataCellExecutionFence: ReturnType<typeof createDataCellExecutionFence>
  /**
   * Identity-owned authority facts this trust boundary must consult. Both are
   * typed from their consumers so the seam cannot drift from what the Google
   * Content authority actually calls.
   */
  identity: Readonly<{
    refreshPolicyStoreRequired: Parameters<
      typeof createGoogleContentAuthorizationAuthority<Database>
    >[0]['refreshPolicy']
    hasActivePropertyGrant: Parameters<
      typeof createGoogleContentAuthorizationCheck
    >[0]['hasActivePropertyGrant']
  }>
  options?: Readonly<{
    providerEphemeralStore?: ProviderEphemeralStore
    providers?: ProviderOverrides
  }>
}>

// Accepted residual: this is one trust-boundary graph with many fail-closed
// branches; splitting it further would scatter the decision.
// fallow-ignore-next-line complexity
export function buildGoogleProviderAuthority(input: GoogleProviderAuthorityInput) {
  const { db, eventBus, clock, logger, env, redis, providerEndpoints } = input
  const dataCellExecutionFence = input.dataCellExecutionFence
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

  const googleContentRuntimeBindings = env.GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON
    ? parseGoogleContentRuntimeBindings(env.GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON)
    : undefined
  let googleContentAuthority:
    ReturnType<typeof createGoogleContentAuthorizationAuthority<Database>> | undefined
  let googleContentAuthorityStore:
    ReturnType<typeof createGoogleContentAuthorityRepository> | undefined
  if (googleContentRuntimeBindings) {
    const rawPublicKeys = env.GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON
    if (!rawPublicKeys) {
      throw new Error('Google Content approval role public keys are unavailable')
    }
    let publicKeysInput: unknown
    try {
      publicKeysInput = JSON.parse(rawPublicKeys)
    } catch {
      throw new Error('Google Content approval role public keys are invalid')
    }
    const publicKeys = parseGoogleContentRolePublicKeys(publicKeysInput)
    if (!publicKeys.ok) {
      throw new Error('Google Content approval role public keys are invalid')
    }
    googleContentAuthorityStore = createGoogleContentAuthorityRepository(db)
    googleContentAuthority = createGoogleContentAuthorizationAuthority({
      store: googleContentAuthorityStore,
      clock,
      newPermitId: randomUUID,
      verifyRoleApproval: createGoogleContentRoleSignatureVerifier(publicKeys.publicKeys),
      refreshPolicy: input.identity.refreshPolicyStoreRequired,
      isRegisteredOperator: () => false,
      authorize: createGoogleContentAuthorizationCheck({
        clock,
        hasActivePropertyGrant: input.identity.hasActivePropertyGrant,
      }),
    })
  }
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
            const runtimeBinding = googleContentRuntimeBindings?.[record.capability]
            if (!runtimeBinding || !googleContentAuthority) {
              return {
                allowed: false,
                approvalBindingId: null,
                authorizationFenceSha256: null,
              }
            }
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
                vectorMode: 'full',
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
                approvalBindingId: result.approvalBindingId,
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
  const authorizeGoogleImportContent: GoogleImportContentAuthorizer =
    options?.providers?.authorizeGoogleImportContent ??
    (async (input) => {
      const binding = googleContentRuntimeBindings?.['property.import_gbp_v2']
      if (!binding || !googleContentAuthority) {
        return unavailableGoogleContentAuthorization
      }
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
          vectorMode: 'full',
        })
        .catch((err: unknown) => {
          logger.warn({ err }, 'Google Content preauthorization failed')
          throw err
        })
      if (result.ok) return result
      logger.warn(
        { stage: 'google-content-preauthorize', code: result.code },
        'Google Content authorization denied',
      )
      return {
        ok: false as const,
        code:
          result.code === 'authorization_denied' ||
          result.code === 'authorization_changed'
            ? ('authorization_denied' as const)
            : ('runtime_unavailable' as const),
      }
    })
  const authorizeGooglePerformanceContent: PerformanceContentAuthorizer =
    options?.providers?.authorizeGooglePerformanceContent ??
    (async (input) => {
      const binding = googleContentRuntimeBindings?.['property.read_gbp_performance']
      if (!binding || !googleContentAuthority) {
        return unavailableGoogleContentAuthorization
      }
      const result = await googleContentAuthority.preauthorize({
        runtimeBinding: binding,
        scope: {
          organizationId: input.actor.organizationId,
          propertyId: input.propertyId,
          connectionId: input.connectionId,
          initiatorUserId: input.actor.userId,
        },
        operationKey: `performance.${input.phase}`,
        vectorMode: 'full',
      })
      return result.ok
        ? result
        : {
            ok: false as const,
            code:
              result.code === 'authorization_denied' ||
              result.code === 'authorization_changed'
                ? ('authorization_denied' as const)
                : ('runtime_unavailable' as const),
          }
    })
  const authorizeGoogleReviewSyncContent: GoogleReviewSyncContentAuthorizer =
    options?.providers?.authorizeGoogleReviewSyncContent ??
    (async (input) => {
      const binding = googleContentRuntimeBindings?.['property.connect_gbp']
      if (!binding || !googleContentAuthority) {
        return unavailableGoogleContentAuthorization
      }
      const result = await googleContentAuthority.preauthorize({
        runtimeBinding: binding,
        scope: {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          connectionId: input.connectionId,
          initiatorUserId: null,
        },
        operationKey: input.operationKey,
        vectorMode: 'full',
      })
      return result.ok
        ? result
        : {
            ok: false as const,
            code:
              result.code === 'authorization_denied' ||
              result.code === 'authorization_changed'
                ? ('authorization_denied' as const)
                : ('runtime_unavailable' as const),
          }
    })
  const authorizeGoogleReplyPublicationContent: GoogleReplyPublicationContentAuthorizer =
    options?.providers?.authorizeGoogleReplyPublicationContent ??
    (async (input) => {
      const binding = googleContentRuntimeBindings?.['property.publish_reply']
      if (!binding || !googleContentAuthority) {
        return unavailableGoogleContentAuthorization
      }
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
        vectorMode: 'full',
      })
      return result.ok
        ? result
        : {
            ok: false as const,
            code:
              result.code === 'authorization_denied' ||
              result.code === 'authorization_changed'
                ? ('authorization_denied' as const)
                : ('runtime_unavailable' as const),
          }
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
      const binding = googleContentRuntimeBindings?.['property.import_gbp_v2']
      if (!binding || !googleContentAuthority) {
        logger.warn(
          {
            stage: 'google-oauth-preauthorize',
            code: 'runtime_unavailable',
            operation: input.operation,
            missing: !binding ? 'runtime_binding' : 'content_authority',
          },
          'Google OAuth authorization unavailable',
        )
        throw new Error('Google OAuth provider authorization is unavailable')
      }
      const result = await googleContentAuthority.preauthorize({
        runtimeBinding: binding,
        scope: {
          organizationId: input.organizationId,
          propertyId: null,
          connectionId: input.connectionId,
          initiatorUserId: input.initiatorUserId,
        },
        operationKey: input.operation,
        vectorMode: 'full',
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
        approvalBindingId: result.approvalBindingId,
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

  const googleDisconnectRevokeStore = createGoogleDisconnectRevokeRepository(db, eventBus)

  const gatewayConfig = [
    env.GOOGLE_EGRESS_GATEWAY_ORIGIN,
    env.GOOGLE_EGRESS_GATEWAY_SERVER_NAME,
    env.GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS,
  ] as const
  const gatewayBase64Tls = [
    env.GOOGLE_INTERNAL_MTLS_CA_B64,
    env.GOOGLE_INTERNAL_MTLS_CERT_B64,
    env.GOOGLE_INTERNAL_MTLS_KEY_B64,
  ] as const
  const gatewayPathTls = [
    env.GOOGLE_INTERNAL_MTLS_CA_PATH,
    env.GOOGLE_INTERNAL_MTLS_CERT_PATH,
    env.GOOGLE_INTERNAL_MTLS_KEY_PATH,
  ] as const
  const configuredGatewayValues = gatewayConfig.filter(
    (value): value is string => value !== undefined,
  )
  const configuredBase64Tls = gatewayBase64Tls.filter(
    (value): value is string => value !== undefined,
  )
  const configuredPathTls = gatewayPathTls.filter(
    (value): value is string => value !== undefined,
  )
  if (
    configuredGatewayValues.length !== 0 &&
    configuredGatewayValues.length !== gatewayConfig.length
  ) {
    throw new Error('Google egress gateway transport configuration is incomplete')
  }
  if (
    configuredBase64Tls.length !== 0 &&
    configuredBase64Tls.length !== gatewayBase64Tls.length
  ) {
    throw new Error('Google egress gateway base64 mTLS configuration is incomplete')
  }
  if (
    configuredPathTls.length !== 0 &&
    configuredPathTls.length !== gatewayPathTls.length
  ) {
    throw new Error('Google egress gateway path mTLS configuration is incomplete')
  }
  if (configuredBase64Tls.length > 0 && configuredPathTls.length > 0) {
    throw new Error('Google egress gateway mTLS configuration is ambiguous')
  }
  if (
    (configuredGatewayValues.length > 0 &&
      configuredBase64Tls.length === 0 &&
      configuredPathTls.length === 0) ||
    (configuredGatewayValues.length === 0 &&
      (configuredBase64Tls.length > 0 || configuredPathTls.length > 0))
  ) {
    throw new Error('Google egress gateway transport configuration is incomplete')
  }
  let googleAuthorizedProviderExecutor =
    options?.providers?.googleAuthorizedProviderExecutor
  const approvalGap = googleApprovalGapDisposition({
    gatewayConfigured: configuredGatewayValues.length > 0,
    approvalUsable: Boolean(googleContentAuthority && googleContentRuntimeBindings),
  })
  if (approvalGap === 'refuse') {
    throw new Error('Google egress gateway requires Google Content runtime approval')
  }
  // State every boot which side of the fork it took.
  //
  // Silence used to mean either "Google is fine" or "Google is off and every
  // import will 503", with nothing to tell them apart until a user tried one.
  // Logging only the failure would leave the same ambiguity whenever logging
  // itself is misconfigured, so both outcomes are stated and the healthy line
  // names the capabilities that were actually admitted.
  if (approvalGap === 'wire') {
    logger.info(
      { capabilities: Object.keys(googleContentRuntimeBindings ?? {}).sort() },
      'Google provider executor wired — Google Content approval is usable',
    )
  } else if (configuredGatewayValues.length > 0) {
    logger.warn(
      {
        hasRuntimeBindings: Boolean(googleContentRuntimeBindings),
        hasContentAuthority: Boolean(googleContentAuthority),
      },
      'Google provider DISABLED — no usable Google Content approval. Import and performance reads will fail with 503 until a freshly signed bundle is installed (docs/operations/google-content-approval-closed-beta.md)',
    )
  } else {
    logger.info(
      {},
      'Google provider not configured — no egress gateway in this environment',
    )
  }
  if (!googleAuthorizedProviderExecutor && approvalGap === 'wire') {
    // `wire` is only returned when both of these resolved, so this cannot fire.
    // It is kept because the compiler cannot see through the disposition, and a
    // redundant guard is better than the non-null assertion it replaces: if the
    // disposition and this branch ever disagree, the failure is named here
    // rather than surfacing as a null dereference deep inside an admit call.
    if (!googleContentAuthority || !googleContentRuntimeBindings) {
      throw new Error('Google egress gateway requires Google Content runtime approval')
    }
    const [gatewayOrigin, gatewayServerName, credentialBindingKeys] =
      configuredGatewayValues
    const bindCredential = createGoogleCredentialBinder(
      createVersionedHmacKeyring(credentialBindingKeys),
    )
    const gateway = createGoogleEgressGatewayHttpClient(
      createInternalMtlsJsonTransport({
        origin: gatewayOrigin,
        serverName: gatewayServerName,
        tls: loadInternalMtlsMaterialFromOneSource({
          base64: {
            ca: configuredBase64Tls[0],
            cert: configuredBase64Tls[1],
            key: configuredBase64Tls[2],
          },
          path: {
            ca: configuredPathTls[0],
            cert: configuredPathTls[1],
            key: configuredPathTls[2],
          },
        }),
        peerIdentityPolicy: {
          uri: 'spiffe://repkey.internal/google-egress-gateway',
          dnsName: gatewayServerName,
          extendedKeyUsages: ['serverAuth', 'clientAuth'],
        },
        timeoutMs: 30_000,
        maxResponseBytes: 5 * 1024 * 1024,
      }),
    )
    googleAuthorizedProviderExecutor = createGoogleAuthorizedProviderExecutor({
      bindCredential,
      disconnectRevoke: {
        prepare: googleDisconnectRevokeStore.prepare,
        acquireDispatch: googleDisconnectRevokeStore.acquireDispatch,
      },
      now: clock,
      admitPropertyExecution: dataCellExecutionFence.decideProperty,
      admitDirectCredentialExecution: createDirectGoogleProviderCredentialAdmission({
        db,
        localCellId: dataCellExecutionFence.localCell,
      }),
      routeTarget:
        env.GOOGLE_PROVIDER_ENDPOINT_PROFILE === 'local-sandbox'
          ? {
              kind: 'local_sandbox',
              simulatorOrigin: new URL(providerEndpoints.gbpApiBaseUrl).origin,
            }
          : { kind: 'production' },
      admit: async ({ authorization, admission }) => {
        const binding = googleContentRuntimeBindings[authorization.capability]
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
          expectedApprovalBindingId: authorization.approvalBindingId,
          expectedAuthorizationVector: authorization.authorizationVector,
          operationKey: `provider.${admission.routeKey}`,
          routeKey: admission.routeKey,
          routeCatalogVersion: admission.catalogueVersion,
          quotaPolicyId: admission.quotaPolicyId,
          providerRequestBinding: {
            requestBindingSha256: admission.requestBindingSha256,
            credentialBinding: admission.credentialBinding,
            projectFingerprint: binding.googleProjectAttestationSha256,
            requestBodySha256: admission.requestBodySha256,
            requestBodyBytes: admission.requestBodyBytes,
          },
          startVectorMode: 'full',
          commitVectorMode: 'full',
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
