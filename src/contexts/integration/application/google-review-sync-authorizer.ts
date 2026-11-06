import {
  googleConnectionHasUsableCredential,
  readGooglePropertyAuthorization,
  type GooglePropertyAuthorizationReader,
  type GooglePropertyAuthorizationView,
} from './google-property-authorization'
import {
  googleConnectionAuthorizationVector,
  googleSystemAuthorizationVector,
  googlePropertyAuthorizationVector,
} from './google-authorization-vector'
import {
  exactVectorDrift,
  sameGoogleContentAuthorizationVector,
} from '#/shared/domain/google-content-authorization-vector'
import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import { sha256Hex } from '#/shared/domain/sha256'
import { isIntegrationError } from '../domain/errors'
import type { GoogleConnection } from '../domain/types'
import type { ActiveConnectionTokenProvider } from './active-connection-token-provider'
import type { GoogleReviewSyncProviderCallAuthorization } from './google-provider-contract'

export const GOOGLE_REVIEW_SYNC_SYSTEM_PRINCIPAL = 'review-sync-worker-v1' as const
export const GOOGLE_REVIEW_SYNC_SYSTEM_PERMISSION_DIGEST = sha256Hex(
  GOOGLE_REVIEW_SYNC_SYSTEM_PRINCIPAL,
)
export const GOOGLE_NOTIFICATION_SYSTEM_PRINCIPAL =
  'notification-management-worker-v1' as const
export const GOOGLE_NOTIFICATION_SYSTEM_PERMISSION_DIGEST = sha256Hex(
  GOOGLE_NOTIFICATION_SYSTEM_PRINCIPAL,
)

export type GoogleConnectionSystemOperation = 'review.sync' | 'notifications.manage'

export type GoogleReviewSyncContentAuthorizationResult =
  | Readonly<{
      ok: true
      authorizationVector: Readonly<Record<string, string | number | boolean | null>>
    }>
  | Readonly<{
      ok: false
      code: 'authorization_denied' | 'runtime_unavailable'
    }>

export type GoogleReviewSyncContentAuthorizer = (
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    connectionId: GoogleConnectionId
    operationKey: GoogleConnectionSystemOperation
  }>,
) => Promise<GoogleReviewSyncContentAuthorizationResult>

/**
 * The system-principal provider authorization for Google review reads.
 *
 * This remains a dedicated type until the executor/build seam is cut over:
 * the existing human union requires a non-null initiator. Wiring must widen
 * that seam and pass the Property id/source epoch already carried by
 * `GoogleReviewPageRequest` / `GoogleReviewGetRequest`; it must never recover a
 * user from `google_connections.connected_by`.
 */
export type GoogleReviewSyncProviderAuthorization =
  GoogleReviewSyncProviderCallAuthorization

/**
 * Why a review-sync call was refused. `connection_unusable` is the one refusal
 * that is not a fault in the call: the Property's Google connection is not
 * active, its credential may not be used, or it lacks the Business Profile
 * scope, and only a fresh consent (a reconnect) changes that. The reconnect
 * notice is already the signal, so a caller ends such a step quietly. Every
 * other refusal stays loud: `authorization_denied` is the authority saying no
 * to a connection that IS usable (the permit vector moved, the content posture
 * refused), `runtime_unavailable` could not decide, and `stale_source` is a
 * Property that moved on.
 */
export type GoogleReviewSyncRefusalCode =
  'authorization_denied' | 'connection_unusable' | 'runtime_unavailable' | 'stale_source'

export type GoogleReviewSyncAuthorizationResult =
  | Readonly<{
      ok: true
      accessToken: string
      authorization: GoogleReviewSyncProviderAuthorization
    }>
  | Readonly<{
      ok: false
      code: GoogleReviewSyncRefusalCode
    }>

export type GoogleReviewSyncAuthorizer = (
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    connectionId: GoogleConnectionId
    sourceEpoch: number
    /** Defaults to review.sync for the review polling path. */
    operationKey?: GoogleConnectionSystemOperation
  }>,
) => Promise<GoogleReviewSyncAuthorizationResult>

/**
 * The refresh found, or just recorded, that Google refuses the grant for good
 * (or that the connection already waits for a reconnect). Other token provider
 * failures stay `runtime_unavailable`: a refresh that lost its credential fence
 * to a concurrent writer says `connection_disconnected` without saying the
 * connection is unusable, so the next attempt's own read decides.
 */
function refreshLearnedConnectionUnusable(error: unknown): boolean {
  return isIntegrationError(error) && error.code === 'reauthorization_required'
}

function safeGeneration(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function expectedSystemVector(
  binding: GooglePropertyAuthorizationView,
  connection: GoogleConnection,
  operationKey: GoogleConnectionSystemOperation,
) {
  const notificationOperation = operationKey === 'notifications.manage'
  return Object.freeze({
    ...googleSystemAuthorizationVector(
      notificationOperation
        ? GOOGLE_NOTIFICATION_SYSTEM_PRINCIPAL
        : GOOGLE_REVIEW_SYNC_SYSTEM_PRINCIPAL,
      notificationOperation
        ? GOOGLE_NOTIFICATION_SYSTEM_PERMISSION_DIGEST
        : GOOGLE_REVIEW_SYNC_SYSTEM_PERMISSION_DIGEST,
    ),
    ...googleConnectionAuthorizationVector(connection),
    ...googlePropertyAuthorizationVector(binding),
  })
}

function validSystemContent(
  binding: GooglePropertyAuthorizationView,
  connection: GoogleConnection,
  content: Extract<GoogleReviewSyncContentAuthorizationResult, { ok: true }>,
  operationKey: GoogleConnectionSystemOperation,
): boolean {
  return (
    safeGeneration(binding.sourceEpoch) &&
    safeGeneration(binding.profileVersion) &&
    safeGeneration(connection.lifecycleVersion) &&
    safeGeneration(connection.accessVersion) &&
    safeGeneration(connection.credentialGeneration) &&
    sameGoogleContentAuthorizationVector(
      content.authorizationVector,
      expectedSystemVector(binding, connection, operationKey),
    )
  )
}

/**
 * Creates the application-side half of Organization-owned review-sync
 * authorization. The token refresh happens before the authoritative second
 * read so its credential-generation bump is frozen into the permit vector.
 */
export function createGoogleReviewSyncAuthorizer(
  deps: GooglePropertyAuthorizationReader &
    Readonly<{
      getAccessToken: ActiveConnectionTokenProvider['getAccessToken']
      authorizeGoogleContent: GoogleReviewSyncContentAuthorizer
      warn?: (fields: Readonly<Record<string, unknown>>, message: string) => void
    }>,
): GoogleReviewSyncAuthorizer {
  return async (input) => {
    const operationKey = input.operationKey ?? 'review.sync'
    const initial = await readGooglePropertyAuthorization(deps, input)
    if (!initial.ok) return initial
    const { binding: initialBinding, connection: initialConnection } = initial
    if (!googleConnectionHasUsableCredential(initialConnection)) {
      return { ok: false, code: 'connection_unusable' }
    }

    let initialContent: GoogleReviewSyncContentAuthorizationResult
    try {
      initialContent = await deps.authorizeGoogleContent({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        connectionId: input.connectionId,
        operationKey,
      })
    } catch {
      return { ok: false, code: 'runtime_unavailable' }
    }
    if (!initialContent.ok) return initialContent
    if (
      !validSystemContent(initialBinding, initialConnection, initialContent, operationKey)
    ) {
      return { ok: false, code: 'authorization_denied' }
    }

    let accessToken: string
    try {
      accessToken = await deps.getAccessToken(input.organizationId, input.connectionId)
    } catch (error) {
      return refreshLearnedConnectionUnusable(error)
        ? { ok: false, code: 'connection_unusable' }
        : { ok: false, code: 'runtime_unavailable' }
    }

    const current = await readGooglePropertyAuthorization(deps, input)
    if (!current.ok) return current
    const { binding, connection } = current
    if (!googleConnectionHasUsableCredential(connection)) {
      return { ok: false, code: 'connection_unusable' }
    }

    let content: GoogleReviewSyncContentAuthorizationResult
    try {
      content = await deps.authorizeGoogleContent({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        connectionId: input.connectionId,
        operationKey,
      })
    } catch {
      return { ok: false, code: 'runtime_unavailable' }
    }
    if (!content.ok) return content
    const expectedVector = expectedSystemVector(binding, connection, operationKey)
    if (!validSystemContent(binding, connection, content, operationKey)) {
      deps.warn?.(
        {
          event:
            operationKey === 'review.sync'
              ? 'google_review_sync_authorization_vector_changed'
              : 'google_notification_authorization_vector_changed',
          drift: exactVectorDrift(content.authorizationVector, expectedVector),
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          connectionId: input.connectionId,
        },
        'Google review sync authorization changed',
      )
      return { ok: false, code: 'authorization_denied' }
    }

    return {
      ok: true,
      accessToken,
      authorization: {
        capability: 'property.connect_gbp',
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        connectionId: input.connectionId,
        initiatorUserId: null,
        expectedCredentialGeneration: connection.credentialGeneration,
        authorizationVector: content.authorizationVector,
      },
    }
  }
}
