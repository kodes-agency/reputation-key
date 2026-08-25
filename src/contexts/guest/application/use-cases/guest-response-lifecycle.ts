import type { StoragePort } from '#/contexts/portal/application/public-api'
import type {
  GuestResponseRepository,
  GuestResponseScope,
} from '../ports/guest-response.repository'
import {
  claimMediaForProcessing,
  completeMediaProcessing,
  issueGuestMedia,
  MAX_GUEST_MEDIA_BYTES,
  namesIssuedObject,
  uploadMatchesIssuance,
  type GuestMedia,
} from '../../domain/guest-media'
import {
  correctResponse,
  createResponse,
  deleteResponse,
  moderateResponse,
  submitPrivateFeedback,
  submitResponse,
  type GuestResponse,
  type ResponseError,
} from '../../domain/guest-response'
import {
  guestFeedbackRetracted,
  guestFeedbackSubmitted,
  guestRatingRetracted,
  guestRatingSubmitted,
} from '../../domain/events'
import type {
  GuestResponseCommandStore,
  GuestMutationFact,
  GuestSubmissionFact,
} from '../ports/guest-response-command-store.port'
import {
  feedbackId,
  organizationId,
  portalId,
  propertyId,
  ratingId,
} from '#/shared/domain/ids'

export type GuestResponseInput = Readonly<{
  rating?: number | null
  category?: string | null
  text?: string | null
  responseConsent?: boolean
  textConsent?: boolean
  mediaConsent?: boolean
}>

export type GuestResponseView = Readonly<{
  id: string
  status: GuestResponse['status']
  responseConsent: boolean
  textConsent: boolean
  rating: number | null
  category: string | null
  hasPrivateFeedback: boolean
  privateFeedbackEligible: boolean
  mediaConsent: boolean
  submittedAt: string | null
  correctedAt: string | null
  correctionDeadline: string | null
  deletedAt: string | null
}>

export class GuestResponseLifecycleError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'GuestResponseLifecycleError'
  }
}

/** Exported for the server boundary, which mirrors a submitted view's shape. */
export const CORRECTION_WINDOW_MS = 60 * 60 * 1000
const retentionMs = 90 * 24 * 60 * 60 * 1000

function toView(response: GuestResponse): GuestResponseView {
  return {
    id: response.id,
    status: response.status,
    rating: response.rating,
    category: response.category,
    // Receipt-only public projection: feedback content never returns to the
    // browser or a shared device after submission. It is absent from the type,
    // rather than represented as a nullable field that a future mapper might fill.
    hasPrivateFeedback: response.text !== null,
    privateFeedbackEligible:
      response.text === null &&
      response.rating !== null &&
      response.privateFeedbackThreshold !== null &&
      response.rating <= response.privateFeedbackThreshold,
    mediaConsent: response.mediaConsent,
    responseConsent: response.responseConsent,
    textConsent: response.textConsent,
    submittedAt: response.submittedAt?.toISOString() ?? null,
    correctedAt: response.correctedAt?.toISOString() ?? null,
    correctionDeadline: response.submittedAt
      ? new Date(response.submittedAt.getTime() + CORRECTION_WINDOW_MS).toISOString()
      : null,
    deletedAt: response.deletedAt?.toISOString() ?? null,
  }
}

function unwrap(result: GuestResponse | ResponseError): GuestResponse {
  if ('code' in result) throw new GuestResponseLifecycleError(result.code)
  return result
}

export function guestResponseLifecycle(
  deps: Readonly<{
    repo: GuestResponseRepository
    storage: StoragePort
    clock: () => Date
    idGen: () => string
    commandStore: GuestResponseCommandStore
  }>,
) {
  const getState = async (scope: GuestResponseScope, sessionId: string) => {
    const response = await deps.repo.findForSession(scope, sessionId)
    return response ? toView(response) : null
  }

  const removeObjects = async (
    scope: GuestResponseScope,
    objectKeys: ReadonlyArray<string>,
  ) => {
    for (const objectKey of objectKeys) {
      try {
        await deps.storage.deleteObject(objectKey)
        await deps.repo.markMediaDeleted(scope, objectKey, deps.clock())
      } catch {
        // The durable purge_pending row is intentionally retained for retry.
      }
    }
  }

  /**
   * Terminal purge for an object that must not be published. The durable
   * purge_pending row is written before the best-effort object delete, so a
   * failed delete is retried rather than lost.
   */
  const purgeIssuedObject = async (scope: GuestResponseScope, media: GuestMedia) => {
    await deps.repo.queueMediaPurge(media, deps.clock())
    await removeObjects(scope, [media.objectKey])
  }

  /**
   * Takes the processing lease under both the domain transition and the repo's
   * compare-and-set. A domain rejection short-circuits the persistence call, so
   * its specific code (expired, not issued, response not processable) wins over
   * the generic lost-race code.
   */
  const claimForProcessing = async (
    media: GuestMedia,
    response: GuestResponse,
    lease: string,
  ): Promise<GuestMedia | { code: string }> => {
    const claimed = claimMediaForProcessing(media, response, lease, deps.clock())
    if ('code' in claimed) return claimed
    if (!(await deps.repo.claimMedia(media, lease, deps.clock()))) {
      return { code: 'media_not_processable' }
    }
    return claimed
  }

  /**
   * Publishes the stored object only once the store vouches that what landed
   * matches what was issued. Throws on every unacceptable outcome so the caller
   * has a single failure path to purge from.
   */
  const confirmUploadedObject = async (media: GuestMedia) => {
    if (!deps.storage.inspectObject) {
      throw new Error('Object metadata inspection is unavailable')
    }
    const metadata = await deps.storage.inspectObject(media.objectKey)
    if (!uploadMatchesIssuance(metadata, media)) {
      throw new Error('Object metadata did not match its issuance')
    }
    return deps.storage.confirmUpload(media.objectKey)
  }

  // PB2.4 / ADR 0044: the aggregate submit is the LIVE producer of the guest
  // rating and feedback facts. The former submit-rating/submit-feedback use
  // cases emitted them, but no server function ever reached those use cases —
  // the metric handlers (portal.rating, portal.feedback) had no producer and
  // both metrics read 0 forever. Those two use cases are gone with this change.
  //
  // Gated on the aggregate's resolved consent flags — never on the raw input.
  // submitResponse() normalizes those booleans and a row may legitimately hold
  // a rating the guest declined to share; an unconsented fact must not become
  // a metric reading (ADR 0044 consent scope).
  //
  // The aggregate row id is the identity of both facts: one submit yields at
  // most one rating and one feedback, and inbox keys its item on feedbackId,
  // so a replayed emission is idempotent rather than duplicated.
  const submissionFacts = (response: GuestResponse): GuestSubmissionFact[] => {
    const facts: GuestSubmissionFact[] = []
    const scopeIds = {
      organizationId: organizationId(response.organizationId),
      portalId: portalId(response.portalId),
      propertyId: propertyId(response.propertyId),
    }
    const occurredAt = response.submittedAt ?? deps.clock()
    if (response.rating !== null && response.responseConsent) {
      facts.push(
        guestRatingSubmitted({
          ratingId: ratingId(response.id),
          ...scopeIds,
          value: response.rating,
          occurredAt,
        }),
      )
    }
    if (response.text !== null && response.textConsent) {
      facts.push(
        guestFeedbackSubmitted({
          feedbackId: feedbackId(response.id),
          ...scopeIds,
          ratingId: response.rating !== null ? ratingId(response.id) : null,
          occurredAt,
        }),
      )
    }
    return facts
  }

  const correctionFacts = (
    previous: GuestResponse,
    corrected: GuestResponse,
  ): GuestMutationFact[] => {
    const facts: GuestMutationFact[] = []
    const scopeIds = {
      organizationId: organizationId(corrected.organizationId),
      portalId: portalId(corrected.portalId),
      propertyId: propertyId(corrected.propertyId),
    }
    const occurredAt = corrected.correctedAt ?? deps.clock()
    const nextRatingShared = corrected.rating !== null && corrected.responseConsent
    if (
      nextRatingShared &&
      (previous.rating !== corrected.rating || !previous.ratingSourceEventId)
    ) {
      facts.push(
        guestRatingSubmitted({
          ratingId: ratingId(corrected.id),
          ...scopeIds,
          value: corrected.rating!,
          supersedesSourceEventId: previous.ratingSourceEventId,
          occurredAt,
        }),
      )
    } else if (!nextRatingShared && previous.ratingSourceEventId) {
      facts.push(
        guestRatingRetracted({
          ratingId: ratingId(corrected.id),
          ...scopeIds,
          supersedesSourceEventId: previous.ratingSourceEventId,
          occurredAt,
        }),
      )
    }

    const nextFeedbackShared = corrected.text !== null && corrected.textConsent
    if (nextFeedbackShared && !previous.feedbackSourceEventId) {
      facts.push(
        guestFeedbackSubmitted({
          feedbackId: feedbackId(corrected.id),
          ...scopeIds,
          ratingId: corrected.rating !== null ? ratingId(corrected.id) : null,
          occurredAt,
        }),
      )
    } else if (!nextFeedbackShared && previous.feedbackSourceEventId) {
      facts.push(
        guestFeedbackRetracted({
          feedbackId: feedbackId(corrected.id),
          ...scopeIds,
          supersedesSourceEventId: previous.feedbackSourceEventId,
          occurredAt,
        }),
      )
    }
    return facts
  }

  const withdrawalFacts = (response: GuestResponse): GuestMutationFact[] => {
    const scopeIds = {
      organizationId: organizationId(response.organizationId),
      portalId: portalId(response.portalId),
      propertyId: propertyId(response.propertyId),
    }
    const occurredAt = deps.clock()
    const facts: GuestMutationFact[] = []
    if (response.ratingSourceEventId) {
      facts.push(
        guestRatingRetracted({
          ratingId: ratingId(response.id),
          ...scopeIds,
          supersedesSourceEventId: response.ratingSourceEventId,
          occurredAt,
        }),
      )
    }
    if (response.feedbackSourceEventId) {
      facts.push(
        guestFeedbackRetracted({
          feedbackId: feedbackId(response.id),
          ...scopeIds,
          supersedesSourceEventId: response.feedbackSourceEventId,
          occurredAt,
        }),
      )
    }
    return facts
  }

  const requireKnownFactLineage = (response: GuestResponse): void => {
    if (
      (response.rating !== null &&
        response.responseConsent &&
        !response.ratingSourceEventId) ||
      (response.text !== null && response.textConsent && !response.feedbackSourceEventId)
    ) {
      // Never turn an unresolved historical fact into an additive correction or
      // erase its source row while leaving a stale managerial projection.
      throw new GuestResponseLifecycleError('response_unavailable')
    }
  }

  return {
    getState,

    submit: async (
      scope: GuestResponseScope,
      sessionId: string,
      input: GuestResponseInput,
      privateFeedbackThreshold = 3,
    ): Promise<GuestResponseView> => {
      const existing = await deps.repo.findForSession(scope, sessionId)
      if (existing) return toView(existing)
      if (input.rating === null || input.rating === undefined) {
        throw new GuestResponseLifecycleError('rating_required')
      }
      if (input.text?.trim()) {
        throw new GuestResponseLifecycleError('feedback_must_follow_rating')
      }
      if (
        !Number.isInteger(privateFeedbackThreshold) ||
        privateFeedbackThreshold < 1 ||
        privateFeedbackThreshold > 5
      ) {
        throw new GuestResponseLifecycleError('response_unavailable')
      }
      const now = deps.clock()
      const submitted = unwrap(
        submitResponse(
          createResponse({
            id: deps.idGen(),
            ...scope,
            sessionId,
            retentionDeadline: new Date(now.getTime() + retentionMs),
            privateFeedbackThreshold,
          }),
          input,
          now,
        ),
      )
      if (
        (await deps.commandStore.commitSubmitted(
          submitted,
          submissionFacts(submitted),
        )) === 'applied'
      ) {
        // Only the winning insert emits: the `existing`/`raced` paths return an
        // already-counted response, so a refresh or a lost race adds no facts.
        return toView(submitted)
      }
      const raced = await deps.repo.findForSession(scope, sessionId)
      if (!raced) throw new GuestResponseLifecycleError('response_unavailable')
      return toView(raced)
    },

    addPrivateFeedback: async (
      scope: GuestResponseScope,
      sessionId: string,
      input: Readonly<{ text: string; textConsent: boolean }>,
    ): Promise<GuestResponseView> => {
      const current = await deps.repo.findForSession(scope, sessionId)
      if (!current) throw new GuestResponseLifecycleError('response_not_found')
      requireKnownFactLineage(current)
      const feedbackAdded = unwrap(submitPrivateFeedback(current, input, deps.clock()))
      const fact = guestFeedbackSubmitted({
        feedbackId: feedbackId(feedbackAdded.id),
        organizationId: organizationId(feedbackAdded.organizationId),
        portalId: portalId(feedbackAdded.portalId),
        propertyId: propertyId(feedbackAdded.propertyId),
        ratingId: feedbackAdded.rating === null ? null : ratingId(feedbackAdded.id),
        occurredAt: feedbackAdded.feedbackSubmittedAt ?? deps.clock(),
      })
      if (
        (await deps.commandStore.commitFeedbackAdded(feedbackAdded, fact)) !== 'applied'
      ) {
        throw new GuestResponseLifecycleError('feedback_already_submitted')
      }
      return toView(feedbackAdded)
    },

    // The response revision and every replacement/retraction fact share one
    // transaction. Metric consumers can therefore append corrections without
    // double-counting or leaving the originally submitted value stale.
    correct: async (
      scope: GuestResponseScope,
      sessionId: string,
      input: GuestResponseInput,
    ): Promise<GuestResponseView> => {
      const current = await deps.repo.findForSession(scope, sessionId)
      if (!current) throw new GuestResponseLifecycleError('response_not_found')
      if (input.text !== undefined) {
        throw new GuestResponseLifecycleError('feedback_must_use_separate_action')
      }
      requireKnownFactLineage(current)
      const corrected = unwrap(
        correctResponse(current, input, deps.clock(), CORRECTION_WINDOW_MS),
      )
      if (
        (await deps.commandStore.commitCorrected(
          current,
          corrected,
          correctionFacts(current, corrected),
        )) !== 'applied'
      ) {
        throw new GuestResponseLifecycleError('already_submitted')
      }
      return toView(corrected)
    },

    withdraw: async (
      scope: GuestResponseScope,
      sessionId: string,
    ): Promise<GuestResponseView> => {
      const current = await deps.repo.findForSession(scope, sessionId)
      if (!current) throw new GuestResponseLifecycleError('response_not_found')
      if (current.status === 'deleted') return toView(current)
      requireKnownFactLineage(current)
      const deleted = unwrap(deleteResponse(current, deps.clock()))
      const committed = await deps.commandStore.commitWithdrawn(
        deleted,
        withdrawalFacts(current),
      )
      if (committed.outcome !== 'applied') {
        throw new GuestResponseLifecycleError('response_unavailable')
      }
      await removeObjects(scope, committed.objectKeys)
      return toView(deleted)
    },

    moderate: async (
      scope: GuestResponseScope,
      responseId: string,
      action: 'quarantine' | 'delete',
    ): Promise<GuestResponseView> => {
      const current = await deps.repo.findById(scope, responseId)
      if (!current) throw new GuestResponseLifecycleError('response_not_found')
      // Both legacy moderation actions now mean manager-side quarantine/hide.
      // A manager may hide abusive text/media but can never retract or erase the
      // guest's numeric rating; only signed guest withdrawal owns that fact.
      void action
      const moderated = unwrap(moderateResponse(current, deps.clock()))
      if (!(await deps.repo.saveModeration(moderated))) {
        throw new GuestResponseLifecycleError('response_not_found')
      }
      return toView(moderated)
    },

    issueMedia: async (
      scope: GuestResponseScope,
      sessionId: string,
      input: Readonly<{ contentType: string; sizeBytes: number }>,
    ) => {
      const response = await deps.repo.findForSession(scope, sessionId)
      if (!response) throw new GuestResponseLifecycleError('response_not_found')
      const media = issueGuestMedia(
        response,
        { id: deps.idGen(), ...input },
        deps.clock(),
      )
      if ('code' in media) throw new GuestResponseLifecycleError(media.code)
      if (!(await deps.repo.insertMedia(media))) {
        throw new GuestResponseLifecycleError('media_unavailable')
      }
      const { uploadUrl } = await deps.storage.createPresignedUploadUrl(
        media.objectKey,
        media.contentType,
        MAX_GUEST_MEDIA_BYTES,
      )
      return {
        mediaId: media.id,
        objectKey: media.objectKey,
        uploadUrl,
        contentType: media.contentType,
        maxSizeBytes: MAX_GUEST_MEDIA_BYTES,
        expiresAt: media.expiresAt.toISOString(),
      }
    },

    confirmMedia: async (
      scope: GuestResponseScope,
      sessionId: string,
      input: Readonly<{ mediaId: string; objectKey: string }>,
    ) => {
      const media = await deps.repo.findMediaForSession(scope, sessionId, input.mediaId)
      if (!namesIssuedObject(media, input.objectKey)) {
        throw new GuestResponseLifecycleError('media_not_found')
      }
      const response = await deps.repo.findForSession(scope, sessionId)
      if (!response) throw new GuestResponseLifecycleError('response_not_found')

      const lease = deps.idGen()
      const claimed = await claimForProcessing(media, response, lease)
      if ('code' in claimed) throw new GuestResponseLifecycleError(claimed.code)

      let publicUrl: string
      try {
        publicUrl = await confirmUploadedObject(media)
      } catch {
        await purgeIssuedObject(scope, media)
        throw new GuestResponseLifecycleError('media_validation_failed')
      }

      const completed = completeMediaProcessing(
        claimed,
        response,
        lease,
        publicUrl,
        deps.clock(),
      )
      if (
        completed.deleteObject ||
        !(await deps.repo.completeMedia(completed.media, lease, publicUrl, deps.clock()))
      ) {
        await purgeIssuedObject(scope, media)
        throw new GuestResponseLifecycleError('media_not_processable')
      }
      return { mediaId: media.id, status: 'ready' as const }
    },
  } as const
}
