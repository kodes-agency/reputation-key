import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { PropertyGoogleBindingPublicApi } from '#/contexts/property/application/public-api'
import {
  googleReviewApiNotConfigured,
  type GoogleReviewApiPort,
  type TargetedGoogleReviewReferenceResolver,
} from '#/contexts/review/application/public-api'
import type { ActiveConnectionTokenProviderDeps } from '../application/active-connection-token-provider'
import type {
  GoogleAuthorizedProviderExecutor,
  GoogleProviderReauthorize,
  GoogleProviderTokenAccess,
  GoogleRefreshingProviderExecutorFactory,
} from '../application/ports/google-authorized-provider-executor.port'
import type { GoogleReviewPushReferenceStore } from '../application/ports/google-review-push-reference.port'
import { sameAuthorizationVectorExceptCredentialGeneration } from '../application/google-authorization-vector'
import { createGoogleNotificationProviderAuthorizer } from '../application/google-notification-provider-authorizer'
import {
  createGoogleReplyPublicationAuthorizer,
  createReplyPublicationProviderCall,
  type GoogleReplyPublicationContentAuthorizer,
} from '../application/google-reply-publication-authorizer'
import {
  createGoogleReviewSyncAuthorizer,
  type GoogleReviewSyncContentAuthorizer,
} from '../application/google-review-sync-authorizer'
import { createGoogleReviewApiAdapter } from '../infrastructure/adapters/google-review-api.adapter'
import { createGoogleReviewPushTargetResolver } from '../infrastructure/adapters/google-review-push-target-resolver.adapter'
import {
  createGoogleReviewCursorStore,
  createUnavailableGoogleReviewCursorStore,
  type GoogleReviewCursorStore,
} from '../infrastructure/google-review-cursor-store'

export type GoogleReviewSyncRuntimeDeps = Readonly<{
  clock: () => Date
  logger: LoggerPort
  connectionRepo: ActiveConnectionTokenProviderDeps['connectionRepo']
  getAccessToken: Parameters<typeof createGoogleReviewSyncAuthorizer>[0]['getAccessToken']
  providerTokenAccess: GoogleProviderTokenAccess
  withSingle401Refresh: GoogleRefreshingProviderExecutorFactory
  findLinkedPropertyIds: Parameters<
    typeof createGoogleNotificationProviderAuthorizer
  >[0]['findLinkedPropertyIds']
  propertyBindingApi: PropertyGoogleBindingPublicApi | undefined
  executor: GoogleAuthorizedProviderExecutor | undefined
  authorizeReviewSyncContent: GoogleReviewSyncContentAuthorizer | undefined
  authorizeReplyPublicationContent: GoogleReplyPublicationContentAuthorizer | undefined
  cursorStore: GoogleReviewCursorStore | undefined
  providerEphemeralStore: ProviderEphemeralStore | undefined
  opaqueReferenceKeys: VersionedHmacKeyring | undefined
  pushReferences: GoogleReviewPushReferenceStore
}>

export type GoogleReviewSyncRuntime = Readonly<{
  googleReviewApi: GoogleReviewApiPort
  googleReviewPushTargetResolver: TargetedGoogleReviewReferenceResolver
  /** Present only when review-sync content authority and the binding reader exist. */
  notification:
    | Readonly<{
        authorizeProviderCall: ReturnType<
          typeof createGoogleNotificationProviderAuthorizer
        >
        reauthorize: GoogleProviderReauthorize
      }>
    | undefined
}>

const buildNotificationAuthority = (
  deps: GoogleReviewSyncRuntimeDeps,
  binding: PropertyGoogleBindingPublicApi,
  reviewSyncAuthorizer: ReturnType<typeof createGoogleReviewSyncAuthorizer>,
): NonNullable<GoogleReviewSyncRuntime['notification']> => ({
  authorizeProviderCall: createGoogleNotificationProviderAuthorizer({
    findConnection: deps.connectionRepo.findById,
    findLinkedPropertyIds: deps.findLinkedPropertyIds,
    readBinding: binding.readInternal,
    authorizeSystemCall: reviewSyncAuthorizer,
  }),
  reauthorize: async ({ authorization }) => {
    if (
      authorization.capability !== 'property.connect_gbp' ||
      authorization.initiatorUserId !== null
    ) {
      throw new Error('Google notification reauthorization is unavailable')
    }
    const refreshed = await reviewSyncAuthorizer({
      organizationId: authorization.organizationId,
      propertyId: authorization.propertyId,
      connectionId: authorization.connectionId,
      sourceEpoch: Number(authorization.authorizationVector.propertySourceEpoch),
      operationKey: 'notifications.manage',
    })
    if (
      !refreshed.ok ||
      !sameAuthorizationVectorExceptCredentialGeneration(
        refreshed.authorization.authorizationVector,
        authorization.authorizationVector,
      )
    ) {
      throw new Error('Google notification reauthorization changed')
    }
    return refreshed.authorization
  },
})

/**
 * The Review context's two provider capabilities (the governed Google review API
 * and the webhook push-target resolver) plus the system authority the
 * notification subscription path shares with review sync.
 */
export const createGoogleReviewSyncRuntime = (
  deps: GoogleReviewSyncRuntimeDeps,
): GoogleReviewSyncRuntime => {
  const binding = deps.propertyBindingApi
  const cursorStore =
    deps.cursorStore ??
    (deps.providerEphemeralStore && deps.opaqueReferenceKeys
      ? createGoogleReviewCursorStore({
          store: deps.providerEphemeralStore,
          keys: deps.opaqueReferenceKeys,
          nowMs: () => deps.clock().getTime(),
        })
      : createUnavailableGoogleReviewCursorStore())

  const reviewSyncAuthorizer =
    binding && deps.authorizeReviewSyncContent
      ? createGoogleReviewSyncAuthorizer({
          readBinding: binding.readInternal,
          findConnection: deps.connectionRepo.findById,
          getAccessToken: deps.getAccessToken,
          authorizeGoogleContent: deps.authorizeReviewSyncContent,
          warn: (fields, message) => deps.logger.warn(fields, message),
        })
      : null
  const replyPublicationAuthorizer =
    binding && deps.authorizeReplyPublicationContent
      ? createGoogleReplyPublicationAuthorizer({
          readBinding: binding.readInternal,
          findConnection: deps.connectionRepo.findById,
          getAccessToken: deps.getAccessToken,
          authorizeGoogleContent: deps.authorizeReplyPublicationContent,
          warn: (fields, message) => deps.logger.warn(fields, message),
        })
      : null

  const authorizeReviewSyncProviderCall:
    | Parameters<
        typeof createGoogleReviewApiAdapter
      >[0]['authorizeReviewSyncProviderCall']
    | undefined = reviewSyncAuthorizer
    ? async (input) => {
        const authorized = await reviewSyncAuthorizer(input)
        if (!authorized.ok) {
          throw Object.assign(
            new Error(
              `Google review provider authorization is unavailable: ${authorized.code}`,
            ),
            { code: authorized.code },
          )
        }
        return authorized
      }
    : undefined
  const authorizeReplyPublicationProviderCall:
    | Parameters<
        typeof createGoogleReviewApiAdapter
      >[0]['authorizeReplyPublicationProviderCall']
    | undefined = replyPublicationAuthorizer
    ? createReplyPublicationProviderCall(replyPublicationAuthorizer)
    : undefined

  const providerExecutor = deps.executor
    ? deps.withSingle401Refresh({
        executor: deps.executor,
        ...deps.providerTokenAccess,
        reauthorize: async ({ authorization }) => {
          if (authorization.initiatorUserId !== null) {
            throw new Error('Google review provider reauthorization is unavailable')
          }
          const refreshed =
            authorization.capability === 'property.connect_gbp' && reviewSyncAuthorizer
              ? await reviewSyncAuthorizer({
                  organizationId: authorization.organizationId,
                  propertyId: authorization.propertyId,
                  connectionId: authorization.connectionId,
                  sourceEpoch: Number(
                    authorization.authorizationVector.propertySourceEpoch,
                  ),
                })
              : authorization.capability === 'property.publish_reply' &&
                  replyPublicationAuthorizer
                ? await replyPublicationAuthorizer({
                    organizationId: authorization.organizationId,
                    propertyId: authorization.propertyId,
                    connectionId: authorization.connectionId,
                    sourceEpoch: authorization.publication.sourceEpoch,
                    reviewId: authorization.publication.reviewId,
                    materialReviewRevision:
                      authorization.publication.materialReviewRevision,
                    replyId: authorization.publication.replyId,
                    publicationCycle: authorization.publication.publicationCycle,
                    attemptNumber: authorization.publication.attemptNumber,
                  })
                : null
          if (
            !refreshed ||
            !refreshed.ok ||
            !sameAuthorizationVectorExceptCredentialGeneration(
              refreshed.authorization.authorizationVector,
              authorization.authorizationVector,
            )
          ) {
            throw new Error('Google review provider reauthorization changed')
          }
          return refreshed.authorization
        },
      })
    : undefined

  const refuseWithoutProvider = (): Promise<never> =>
    Promise.reject(googleReviewApiNotConfigured())
  const googleReviewApi: GoogleReviewApiPort = providerExecutor
    ? createGoogleReviewApiAdapter({
        connectionRepo: deps.connectionRepo,
        logger: deps.logger,
        executor: providerExecutor,
        authorizeReviewSyncProviderCall,
        authorizeReplyPublicationProviderCall,
        nowMs: () => deps.clock().getTime(),
        cursorStore,
      })
    : Object.freeze({
        listReviewsPage: refuseWithoutProvider,
        readReviewsHead: refuseWithoutProvider,
        getReview: refuseWithoutProvider,
        discardReviewCursors: refuseWithoutProvider,
        replyToReview: refuseWithoutProvider,
      })

  const googleReviewPushTargetResolver: TargetedGoogleReviewReferenceResolver = binding
    ? createGoogleReviewPushTargetResolver({
        readBinding: binding.readInternal,
        references: deps.pushReferences,
      })
    : Object.freeze({
        resolve: async () => ({ status: 'obsolete' as const }),
      })

  return Object.freeze({
    googleReviewApi,
    googleReviewPushTargetResolver,
    notification:
      binding && reviewSyncAuthorizer
        ? buildNotificationAuthority(deps, binding, reviewSyncAuthorizer)
        : undefined,
  })
}
