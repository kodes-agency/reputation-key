import { randomBytes, randomUUID } from 'node:crypto'
import { buildIntegrationContext } from '#/contexts/integration/build'
import { googleOAuthCallbackUrl } from '#/contexts/integration/application/google-authorize-request'
import {
  createInMemoryOAuthCallbackQuotaCounter,
  createOAuthCallbackAbuseGate,
  type OAuthCallbackQuotaCounter,
} from '#/contexts/integration/application/oauth-callback-abuse-gate'
import { createRedisOAuthCallbackQuotaCounter } from '#/contexts/integration/infrastructure/oauth-callback-quota-counter'
import { assertDirectCredentialEgressAllowed } from '#/shared/config/provider-config-guards'
import { getLogger } from '#/shared/observability/logger'
import type { buildIdentityContext } from '#/contexts/identity/build'
import type { buildPropertyContext } from '#/contexts/property/build'
import type { buildPortalContext } from '#/contexts/portal/build'
import type { ReviewContextApi } from '#/contexts/review/build'
import type { createSourceContentPurge } from '#/contexts/review/infrastructure/source-content-purge'
import type { buildGoogleProviderAuthority } from './google-provider-authority'
import type { ContextWiringInput } from './runtime'

export function wireIntegration(
  {
    options,
    db,
    clock,
    env,
    redis,
    outboxRepo,
    infra,
    providerEndpoints,
  }: ContextWiringInput,
  identity: ReturnType<typeof buildIdentityContext>,
  property: ReturnType<typeof buildPropertyContext>,
  portal: ReturnType<typeof buildPortalContext>,
  googleProviderAuthority: ReturnType<typeof buildGoogleProviderAuthority>,
  sourceContentPurge: ReturnType<typeof createSourceContentPurge>,
  getReview: () => ReviewContextApi,
) {
  const {
    providerEphemeralStore,
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
  } = googleProviderAuthority

  const oauthCallbackQuotaCounter: OAuthCallbackQuotaCounter = redis
    ? createRedisOAuthCallbackQuotaCounter(redis)
    : env.NODE_ENV === 'production'
      ? Object.freeze({ consume: async () => false })
      : createInMemoryOAuthCallbackQuotaCounter()
  const oauthCallbackAbuseGate = createOAuthCallbackAbuseGate({
    counter: oauthCallbackQuotaCounter,
    hmacSecret: env.OAUTH_STATE_SECRET,
    projectIdentity: env.GOOGLE_CLIENT_ID,
  })

  const integration = buildIntegrationContext({
    db,
    outboxRepo,
    clock,
    idGen: randomUUID,
    invalidationOwnerGen: () => randomBytes(32).toString('base64url'),
    jobQueue: infra.jobQueue,
    propertyApi: property.publicApi,
    propertyBindingApi: property.googleBinding,
    prepareImportSync: (tx, scope) =>
      getReview().publicApi.syncAdmission.prepareImportSync(tx, scope),
    enqueueReviewSync: (data, options) =>
      getReview().publicApi.syncAdmission.addSyncJob(data, options),
    enqueueTargetedReviewFetch: (data, options) =>
      getReview().publicApi.syncAdmission.addTargetedFetchJob(data, options),
    defaultPublicDisplayName: portal.publicApi.portal.ensureDefaultPublicDisplayName,
    logger: getLogger(),
    providerEndpoints,
    config: {
      nodeEnv: env.NODE_ENV,
      googleClientId: env.GOOGLE_CLIENT_ID,
      googleClientSecret: env.GOOGLE_CLIENT_SECRET,
      encryptionKey: env.ENCRYPTION_KEY,
      googleCallbackUrl: googleOAuthCallbackUrl(env.BETTER_AUTH_URL),
      pubsubTopic: env.GBP_PUBSUB_TOPIC,
      pubsubNotificationTypes: env.GBP_PUBSUB_NOTIFICATION_TYPES,
    },
    sourceContentPurge,
    googleOAuth: options?.providers?.googleOAuth,
    gbpApi: options?.providers?.gbpApi,
    googleAuthorizedProviderExecutor,
    googleDisconnectRevokeStore,
    ...(googleAuthorizedProviderExecutor ? { authorizeGoogleOAuthProviderCall } : {}),
    googleImportReplayKeys,
    authorizeGoogleImportContent,
    authorizeGooglePerformanceContent,
    authorizeGoogleReviewSyncContent,
    authorizeGoogleReplyPublicationContent,
    googlePerformancePrincipalKeys,
    providerAuthorizationLeases,
    googleImportReferences,
    providerEphemeralStore,
    googleOpaqueReferenceKeys,
    googleReviewCursorStore: options?.providers?.googleReviewCursorStore,
    oauthStateHandles,
    oauthCallbackAbuseGate,
    refreshPolicyStoreRequired: identity.policy.refreshRequired,
    googleRefreshCoordination,
    assertDirectCredentialEgressAllowed: (operation) =>
      assertDirectCredentialEgressAllowed(env, operation),
  })

  return integration
}
