import {
  exactVectorDrift,
  GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
  sameGoogleContentAuthorizationVector,
} from '#/shared/domain/google-content-authorization-vector'
import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import { sha256Hex } from '#/shared/domain/sha256'
import type { GoogleConnection } from '../domain/types'
import type { ActiveConnectionTokenProvider } from './active-connection-token-provider'
import {
  GOOGLE_BUSINESS_MANAGE_SCOPE,
  type GoogleReviewSyncProviderCallAuthorization,
} from './google-provider-contract'

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

type ReviewSyncPropertyAuthorizationView = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  state: string
  connectionId: GoogleConnectionId | null
  locationId: string | null
  sourceEpoch: number
  profileVersion: number
  profileSource: 'legacy' | 'tenant_confirmed'
  profileConfirmedAt: Date | null
  lifecycleState: string
  deletedAt: Date | null
}>

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

export type GoogleReviewSyncAuthorizationResult =
  | Readonly<{
      ok: true
      accessToken: string
      authorization: GoogleReviewSyncProviderAuthorization
    }>
  | Readonly<{
      ok: false
      code: 'authorization_denied' | 'runtime_unavailable' | 'stale_source'
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

function currentBinding(
  binding: ReviewSyncPropertyAuthorizationView | null,
  input: Parameters<GoogleReviewSyncAuthorizer>[0],
): binding is ReviewSyncPropertyAuthorizationView & {
  connectionId: GoogleConnectionId
  locationId: string
} {
  return Boolean(
    binding &&
    binding.organizationId === input.organizationId &&
    binding.propertyId === input.propertyId &&
    binding.connectionId === input.connectionId &&
    binding.locationId &&
    binding.sourceEpoch === input.sourceEpoch &&
    binding.state === 'active' &&
    binding.lifecycleState === 'active' &&
    binding.deletedAt === null,
  )
}

function usableConnection(
  connection: GoogleConnection | null,
  input: Parameters<GoogleReviewSyncAuthorizer>[0],
): connection is GoogleConnection {
  return Boolean(
    connection &&
    connection.organizationId === input.organizationId &&
    connection.id === input.connectionId &&
    connection.status === 'active' &&
    connection.credentialUseState === 'active' &&
    connection.scopes.includes(GOOGLE_BUSINESS_MANAGE_SCOPE),
  )
}

function safeGeneration(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function expectedSystemVector(
  binding: ReviewSyncPropertyAuthorizationView,
  connection: GoogleConnection,
  operationKey: GoogleConnectionSystemOperation,
) {
  const notificationOperation = operationKey === 'notifications.manage'
  return Object.freeze({
    executionPolicyVersion: GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
    principalKind: 'system',
    systemPrincipal: notificationOperation
      ? GOOGLE_NOTIFICATION_SYSTEM_PRINCIPAL
      : GOOGLE_REVIEW_SYNC_SYSTEM_PRINCIPAL,
    role: 'System',
    permissionVersion: null,
    permissionDigest: notificationOperation
      ? GOOGLE_NOTIFICATION_SYSTEM_PERMISSION_DIGEST
      : GOOGLE_REVIEW_SYNC_SYSTEM_PERMISSION_DIGEST,
    connectionLifecycleVersion: connection.lifecycleVersion,
    connectionAccessVersion: connection.accessVersion,
    credentialGeneration: connection.credentialGeneration,
    propertySourceEpoch: binding.sourceEpoch,
    propertyProfileVersion: binding.profileVersion,
    propertyBindingState: binding.state,
    propertyLifecycleState: binding.lifecycleState,
    propertyProfileSource: binding.profileSource,
    propertyTimezoneConfirmed: binding.profileConfirmedAt !== null,
  })
}

function validSystemContent(
  binding: ReviewSyncPropertyAuthorizationView,
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
  deps: Readonly<{
    readBinding(
      organizationId: OrganizationId,
      propertyId: PropertyId,
    ): Promise<ReviewSyncPropertyAuthorizationView | null>
    findConnection(
      organizationId: OrganizationId,
      connectionId: GoogleConnectionId,
    ): Promise<GoogleConnection | null>
    getAccessToken: ActiveConnectionTokenProvider['getAccessToken']
    authorizeGoogleContent: GoogleReviewSyncContentAuthorizer
    warn?: (fields: Readonly<Record<string, unknown>>, message: string) => void
  }>,
): GoogleReviewSyncAuthorizer {
  return async (input) => {
    const operationKey = input.operationKey ?? 'review.sync'
    let initialBinding: ReviewSyncPropertyAuthorizationView | null
    let initialConnection: GoogleConnection | null
    try {
      ;[initialBinding, initialConnection] = await Promise.all([
        deps.readBinding(input.organizationId, input.propertyId),
        deps.findConnection(input.organizationId, input.connectionId),
      ])
    } catch {
      return { ok: false, code: 'runtime_unavailable' }
    }
    if (!currentBinding(initialBinding, input)) {
      return { ok: false, code: 'stale_source' }
    }
    if (!usableConnection(initialConnection, input)) {
      return { ok: false, code: 'authorization_denied' }
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
      accessToken = await deps.getAccessToken(input.organizationId, input.connectionId, [
        input.propertyId,
      ])
    } catch {
      return { ok: false, code: 'runtime_unavailable' }
    }

    let binding: ReviewSyncPropertyAuthorizationView | null
    let connection: GoogleConnection | null
    try {
      ;[binding, connection] = await Promise.all([
        deps.readBinding(input.organizationId, input.propertyId),
        deps.findConnection(input.organizationId, input.connectionId),
      ])
    } catch {
      return { ok: false, code: 'runtime_unavailable' }
    }
    if (!currentBinding(binding, input)) {
      return { ok: false, code: 'stale_source' }
    }
    if (!usableConnection(connection, input)) {
      return { ok: false, code: 'authorization_denied' }
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
