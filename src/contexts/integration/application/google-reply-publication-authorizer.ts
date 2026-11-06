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
import type { GoogleConnection } from '../domain/types'
import type { ActiveConnectionTokenProvider } from './active-connection-token-provider'
import type { GoogleReplyPublicationProviderCallAuthorization } from './google-provider-contract'

export const GOOGLE_REPLY_PUBLICATION_SYSTEM_PRINCIPAL =
  'reply-publication-worker-v1' as const
export const GOOGLE_REPLY_PUBLICATION_SYSTEM_PERMISSION_DIGEST = sha256Hex(
  GOOGLE_REPLY_PUBLICATION_SYSTEM_PRINCIPAL,
)

export type GoogleReplyPublicationIdentity = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  sourceEpoch: number
  reviewId: string
  materialReviewRevision: number
  replyId: string
  publicationCycle: number
  attemptNumber: number
}>

export type GoogleReplyPublicationContentAuthorizationResult =
  | Readonly<{
      ok: true
      authorizationVector: Readonly<Record<string, string | number | boolean | null>>
    }>
  | Readonly<{
      ok: false
      code: 'authorization_denied' | 'runtime_unavailable'
    }>

export type GoogleReplyPublicationContentAuthorizer = (
  input: GoogleReplyPublicationIdentity & Readonly<{ operationKey: 'reply.publish' }>,
) => Promise<GoogleReplyPublicationContentAuthorizationResult>

export type GoogleReplyPublicationAuthorizationResult =
  | Readonly<{
      ok: true
      accessToken: string
      authorization: GoogleReplyPublicationProviderCallAuthorization
    }>
  | Readonly<{
      ok: false
      code: 'authorization_denied' | 'runtime_unavailable' | 'stale_source'
    }>

export type GoogleReplyPublicationAuthorizer = (
  input: GoogleReplyPublicationIdentity,
) => Promise<GoogleReplyPublicationAuthorizationResult>

function safeGeneration(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum
}

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

function validIdentity(input: GoogleReplyPublicationIdentity): boolean {
  return (
    CANONICAL_UUID.test(input.reviewId) &&
    CANONICAL_UUID.test(input.replyId) &&
    safeGeneration(input.sourceEpoch) &&
    safeGeneration(input.materialReviewRevision, 1) &&
    safeGeneration(input.publicationCycle, 1) &&
    safeGeneration(input.attemptNumber, 1)
  )
}

function validPublicationVector(
  input: GoogleReplyPublicationIdentity,
  vector: Readonly<Record<string, string | number | boolean | null>>,
): vector is typeof vector &
  Readonly<{
    replyStateRevision: number
    baseObservationRevision: number
    expectedReplyDigest: string
    confirmingActorUserId: string
    confirmingActorRole: 'AccountAdmin' | 'PropertyManager'
    confirmingActorPermissionVersion: number
  }> {
  return (
    vector.reviewId === input.reviewId &&
    vector.replyId === input.replyId &&
    vector.publicationCycle === input.publicationCycle &&
    vector.publicationAttemptNumber === input.attemptNumber &&
    vector.materialReviewRevision === input.materialReviewRevision &&
    safeGeneration(vector.replyStateRevision, 1) &&
    safeGeneration(vector.baseObservationRevision) &&
    typeof vector.expectedReplyDigest === 'string' &&
    /^[a-f0-9]{64}$/u.test(vector.expectedReplyDigest) &&
    typeof vector.confirmingActorUserId === 'string' &&
    vector.confirmingActorUserId.trim().length > 0 &&
    (vector.confirmingActorRole === 'AccountAdmin' ||
      vector.confirmingActorRole === 'PropertyManager') &&
    safeGeneration(vector.confirmingActorPermissionVersion)
  )
}

function expectedSystemVector(
  input: GoogleReplyPublicationIdentity,
  binding: GooglePropertyAuthorizationView,
  connection: GoogleConnection,
  content: Extract<GoogleReplyPublicationContentAuthorizationResult, { ok: true }>,
) {
  const vector = content.authorizationVector
  if (!validPublicationVector(input, vector)) return null
  return Object.freeze({
    ...googleSystemAuthorizationVector(
      GOOGLE_REPLY_PUBLICATION_SYSTEM_PRINCIPAL,
      GOOGLE_REPLY_PUBLICATION_SYSTEM_PERMISSION_DIGEST,
    ),
    confirmingActorUserId: vector.confirmingActorUserId,
    confirmingActorRole: vector.confirmingActorRole,
    confirmingActorPermissionVersion: vector.confirmingActorPermissionVersion,
    ...googleConnectionAuthorizationVector(connection),
    ...googlePropertyAuthorizationVector(binding),
    reviewId: input.reviewId,
    replyId: input.replyId,
    publicationCycle: input.publicationCycle,
    publicationAttemptNumber: input.attemptNumber,
    materialReviewRevision: input.materialReviewRevision,
    replyStateRevision: vector.replyStateRevision,
    baseObservationRevision: vector.baseObservationRevision,
    expectedReplyDigest: vector.expectedReplyDigest,
  })
}

function validSystemContent(
  input: GoogleReplyPublicationIdentity,
  binding: GooglePropertyAuthorizationView,
  connection: GoogleConnection,
  content: Extract<GoogleReplyPublicationContentAuthorizationResult, { ok: true }>,
): boolean {
  const expected = expectedSystemVector(input, binding, connection, content)
  return Boolean(
    expected &&
    safeGeneration(binding.sourceEpoch) &&
    safeGeneration(binding.profileVersion, 1) &&
    safeGeneration(connection.lifecycleVersion, 1) &&
    safeGeneration(connection.accessVersion, 1) &&
    safeGeneration(connection.credentialGeneration, 1) &&
    sameGoogleContentAuthorizationVector(content.authorizationVector, expected),
  )
}

/**
 * Freezes one Review-owned durable publication attempt into a Google provider
 * authorization. Review remains the command/evidence owner; Integration sees
 * only identifiers, revisions, digests, and the current credential generation.
 */
export function createGoogleReplyPublicationAuthorizer(
  deps: GooglePropertyAuthorizationReader &
    Readonly<{
      getAccessToken: ActiveConnectionTokenProvider['getAccessToken']
      authorizeGoogleContent: GoogleReplyPublicationContentAuthorizer
      warn?: (fields: Readonly<Record<string, unknown>>, message: string) => void
    }>,
): GoogleReplyPublicationAuthorizer {
  return async (input) => {
    if (!validIdentity(input)) return { ok: false, code: 'authorization_denied' }
    const initial = await readGooglePropertyAuthorization(deps, input)
    if (!initial.ok) return initial
    const { binding: initialBinding, connection: initialConnection } = initial
    if (!googleConnectionHasUsableCredential(initialConnection)) {
      return { ok: false, code: 'authorization_denied' }
    }

    let initialContent: GoogleReplyPublicationContentAuthorizationResult
    try {
      initialContent = await deps.authorizeGoogleContent({
        ...input,
        operationKey: 'reply.publish',
      })
    } catch {
      return { ok: false, code: 'runtime_unavailable' }
    }
    if (!initialContent.ok) return initialContent
    if (!validSystemContent(input, initialBinding, initialConnection, initialContent)) {
      return { ok: false, code: 'authorization_denied' }
    }

    let accessToken: string
    try {
      accessToken = await deps.getAccessToken(input.organizationId, input.connectionId)
    } catch {
      return { ok: false, code: 'runtime_unavailable' }
    }

    const current = await readGooglePropertyAuthorization(deps, input)
    if (!current.ok) return current
    const { binding, connection } = current
    if (!googleConnectionHasUsableCredential(connection)) {
      return { ok: false, code: 'authorization_denied' }
    }

    let content: GoogleReplyPublicationContentAuthorizationResult
    try {
      content = await deps.authorizeGoogleContent({
        ...input,
        operationKey: 'reply.publish',
      })
    } catch {
      return { ok: false, code: 'runtime_unavailable' }
    }
    if (!content.ok) return content
    const expected = expectedSystemVector(input, binding, connection, content)
    if (!expected || !validSystemContent(input, binding, connection, content)) {
      deps.warn?.(
        {
          event: 'google_reply_publication_authorization_vector_changed',
          drift: expected
            ? exactVectorDrift(content.authorizationVector, expected)
            : ['publicationVector'],
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          connectionId: input.connectionId,
          reviewId: input.reviewId,
          replyId: input.replyId,
          publicationCycle: input.publicationCycle,
          attemptNumber: input.attemptNumber,
        },
        'Google reply publication authorization changed',
      )
      return { ok: false, code: 'authorization_denied' }
    }

    return {
      ok: true,
      accessToken,
      authorization: {
        capability: 'property.publish_reply',
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        connectionId: input.connectionId,
        initiatorUserId: null,
        expectedCredentialGeneration: connection.credentialGeneration,
        authorizationVector: content.authorizationVector,
        publication: {
          reviewId: input.reviewId,
          replyId: input.replyId,
          publicationCycle: input.publicationCycle,
          attemptNumber: input.attemptNumber,
          sourceEpoch: input.sourceEpoch,
          materialReviewRevision: input.materialReviewRevision,
        },
      },
    }
  }
}

/**
 * The provider-call form the Review adapter consumes: an admitted attempt
 * returns its authorization, and a refusal throws carrying the authorizer's
 * closed code. The adapter records that code as not-sent evidence, which is
 * the only way the publish job can tell RepKey's own refusal (`stale_source`:
 * the Property is no longer active at the cycle's source epoch) from a changed
 * approval, and so never report it to the author as Google's answer.
 */
export function createReplyPublicationProviderCall(
  authorize: GoogleReplyPublicationAuthorizer,
) {
  return async (input: GoogleReplyPublicationIdentity) => {
    const authorized = await authorize(input)
    if (!authorized.ok) {
      throw Object.assign(
        new Error(
          `Google reply publication authorization is unavailable: ${authorized.code}`,
        ),
        { code: authorized.code },
      )
    }
    return authorized
  }
}
