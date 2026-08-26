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
  DEFAULT_FEEDBACK_WITHDRAWAL_WINDOW_MS,
  DEFAULT_RESPONSE_SESSION_WINDOW_MS,
  DEFAULT_RESPONSE_WITHDRAWAL_WINDOW_MS,
  moderateResponse,
  submitPrivateFeedback,
  submitResponse,
  withdrawPrivateFeedback,
  withdrawResponse,
  type GuestResponse,
  type GuestResponseExperienceSnapshot,
  type ResponseError,
} from '../../domain/guest-response'
import {
  changeGuestResponseIntegrity,
  DEFAULT_GUEST_RESPONSE_INTEGRITY_ASSESSMENT,
  initialGuestResponseIntegrityDecision,
  isRatingMetricEligible,
  ratingMetricOccurredAt,
  type GuestResponseInitialIntegrityAssessment,
  type GuestResponseIntegrityOutcome,
} from '../../domain/guest-response-integrity'
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

export type GuestResponseExperienceInput = Readonly<{
  portalPublicationState: 'published'
  portalPublicationSnapshotId: string
  portalPublicationVersion: number
  portalPublicationDigest: string
  portalConfigurationDigest: string
  guestLocale: string
  languagePackVersion: string
  privateFeedbackThreshold: number
}>

export type GuestResponseView = Readonly<{
  status: GuestResponse['status']
  rating: number | null
  hasPrivateFeedback: boolean
  privateFeedbackEligible: boolean
  submittedAt: string | null
  correctedAt: string | null
  correctionDeadline: string | null
  correctionAvailable: boolean
  responseWithdrawalDeadline: string | null
  responseWithdrawalAvailable: boolean
  feedbackSubmittedAt: string | null
  feedbackWithdrawalDeadline: string | null
  feedbackWithdrawalAvailable: boolean
  feedbackWithdrawnAt: string | null
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
export const FEEDBACK_WITHDRAWAL_WINDOW_MS = DEFAULT_FEEDBACK_WITHDRAWAL_WINDOW_MS
export const RESPONSE_WITHDRAWAL_WINDOW_MS = DEFAULT_RESPONSE_WITHDRAWAL_WINDOW_MS

function factRetentionDeadline(from: Date): Date {
  const deadline = new Date(from)
  deadline.setUTCMonth(deadline.getUTCMonth() + 24)
  return deadline
}

const CONFIGURATION_DIGEST_PATTERN = /^[0-9a-f]{64}$/
const GUEST_LOCALE_LANGUAGE_PATTERN = /^[A-Za-z]{2,3}$/
const GUEST_LOCALE_SUBTAG_PATTERN = /^[A-Za-z0-9]{2,8}$/
const LANGUAGE_PACK_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/

function isGuestLocale(value: string): boolean {
  if (value.length > 35) return false
  const [language, ...subtags] = value.split('-')
  return (
    GUEST_LOCALE_LANGUAGE_PATTERN.test(language ?? '') &&
    subtags.every((subtag) => GUEST_LOCALE_SUBTAG_PATTERN.test(subtag))
  )
}

function captureExperience(
  input: GuestResponseExperienceInput,
  capturedAt: Date,
): GuestResponseExperienceSnapshot {
  if (
    input.portalPublicationState !== 'published' ||
    input.portalPublicationSnapshotId.length === 0 ||
    !Number.isSafeInteger(input.portalPublicationVersion) ||
    input.portalPublicationVersion < 1 ||
    !CONFIGURATION_DIGEST_PATTERN.test(input.portalPublicationDigest) ||
    !CONFIGURATION_DIGEST_PATTERN.test(input.portalConfigurationDigest) ||
    !isGuestLocale(input.guestLocale) ||
    !LANGUAGE_PACK_VERSION_PATTERN.test(input.languagePackVersion) ||
    !Number.isInteger(input.privateFeedbackThreshold) ||
    input.privateFeedbackThreshold < 1 ||
    input.privateFeedbackThreshold > 5
  ) {
    throw new GuestResponseLifecycleError('response_unavailable')
  }
  return {
    ...input,
    capturedAt,
  }
}

function toView(response: GuestResponse, now: Date): GuestResponseView {
  const correctionDeadline = response.submittedAt
    ? new Date(response.submittedAt.getTime() + CORRECTION_WINDOW_MS)
    : null
  const feedbackWithdrawalDeadline = response.feedbackSubmittedAt
    ? new Date(response.feedbackSubmittedAt.getTime() + FEEDBACK_WITHDRAWAL_WINDOW_MS)
    : null
  const responseWithdrawalDeadline = response.submittedAt
    ? new Date(response.submittedAt.getTime() + RESPONSE_WITHDRAWAL_WINDOW_MS)
    : null
  return {
    status: response.status,
    rating: response.rating,
    // Receipt-only public projection: feedback content never returns to the
    // browser or a shared device after submission. It is absent from the type,
    // rather than represented as a nullable field that a future mapper might fill.
    hasPrivateFeedback: response.text !== null,
    privateFeedbackEligible:
      response.text === null &&
      response.feedbackSubmittedAt === null &&
      response.feedbackWithdrawnAt === null &&
      response.rating !== null &&
      response.privateFeedbackThreshold !== null &&
      response.rating <= response.privateFeedbackThreshold,
    submittedAt: response.submittedAt?.toISOString() ?? null,
    correctedAt: response.correctedAt?.toISOString() ?? null,
    correctionDeadline: correctionDeadline?.toISOString() ?? null,
    correctionAvailable:
      response.status === 'submitted' &&
      response.correctionCount === 0 &&
      correctionDeadline !== null &&
      now.getTime() <= correctionDeadline.getTime(),
    responseWithdrawalDeadline: responseWithdrawalDeadline?.toISOString() ?? null,
    responseWithdrawalAvailable:
      response.status !== 'deleted' &&
      responseWithdrawalDeadline !== null &&
      now.getTime() <= responseWithdrawalDeadline.getTime(),
    feedbackSubmittedAt: response.feedbackSubmittedAt?.toISOString() ?? null,
    feedbackWithdrawalDeadline: feedbackWithdrawalDeadline?.toISOString() ?? null,
    feedbackWithdrawalAvailable:
      response.text !== null &&
      response.feedbackWithdrawnAt === null &&
      feedbackWithdrawalDeadline !== null &&
      now.getTime() <= feedbackWithdrawalDeadline.getTime(),
    feedbackWithdrawnAt: response.feedbackWithdrawnAt?.toISOString() ?? null,
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
    const now = deps.clock()
    const response = await deps.repo.findForSession(scope, sessionId, now)
    return response ? toView(response, now) : null
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
    if (isRatingMetricEligible(response)) {
      facts.push(
        guestRatingSubmitted({
          ratingId: ratingId(response.id),
          ...scopeIds,
          value: response.rating!,
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
    const nextRatingShared = isRatingMetricEligible(corrected)
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

  const integrityFacts = (
    previous: GuestResponse,
    changed: GuestResponse,
  ): GuestMutationFact[] => {
    const wasEligible = isRatingMetricEligible(previous)
    const isEligible = isRatingMetricEligible(changed)
    if (wasEligible === isEligible) return []
    const scopeIds = {
      organizationId: organizationId(changed.organizationId),
      portalId: portalId(changed.portalId),
      propertyId: propertyId(changed.propertyId),
    }
    if (wasEligible) {
      if (!previous.ratingSourceEventId) {
        throw new GuestResponseLifecycleError('response_unavailable')
      }
      return [
        guestRatingRetracted({
          ratingId: ratingId(changed.id),
          ...scopeIds,
          supersedesSourceEventId: previous.ratingSourceEventId,
          occurredAt: changed.integrityAssessedAt,
        }),
      ]
    }
    return [
      guestRatingSubmitted({
        ratingId: ratingId(changed.id),
        ...scopeIds,
        value: changed.rating!,
        supersedesSourceEventId: previous.ratingSourceEventId,
        occurredAt: ratingMetricOccurredAt(changed),
      }),
    ]
  }

  const requireKnownFactLineage = (response: GuestResponse): void => {
    if (
      (isRatingMetricEligible(response) && !response.ratingSourceEventId) ||
      (response.integrityOutcome !== 'accepted' && response.ratingSourceEventId) ||
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
      experience: GuestResponseExperienceInput,
      sessionExpiresAt?: Date,
      initialIntegrityAssessment: GuestResponseInitialIntegrityAssessment = DEFAULT_GUEST_RESPONSE_INTEGRITY_ASSESSMENT,
    ): Promise<GuestResponseView> => {
      const now = deps.clock()
      const bindingExpiresAt =
        sessionExpiresAt ?? new Date(now.getTime() + DEFAULT_RESPONSE_SESSION_WINDOW_MS)
      if (
        bindingExpiresAt.getTime() - now.getTime() !==
        DEFAULT_RESPONSE_SESSION_WINDOW_MS
      ) {
        throw new GuestResponseLifecycleError('response_unavailable')
      }
      const existing = await deps.repo.findForSession(scope, sessionId, now)
      if (existing) return toView(existing, now)
      if (input.rating === null || input.rating === undefined) {
        throw new GuestResponseLifecycleError('rating_required')
      }
      if (input.text?.trim()) {
        throw new GuestResponseLifecycleError('feedback_must_follow_rating')
      }
      const experienceSnapshot = captureExperience(experience, now)
      const submitted = unwrap(
        submitResponse(
          createResponse({
            id: deps.idGen(),
            ...scope,
            sessionId,
            sessionExpiresAt: bindingExpiresAt,
            retentionDeadline: factRetentionDeadline(now),
            experienceSnapshot,
            integrityAssessment: initialIntegrityAssessment,
          }),
          input,
          now,
        ),
      )
      if (
        (await deps.commandStore.commitSubmitted(
          submitted,
          submissionFacts(submitted),
          initialGuestResponseIntegrityDecision(submitted, initialIntegrityAssessment),
        )) === 'applied'
      ) {
        // Only the winning insert emits: the `existing`/`raced` paths return an
        // already-counted response, so a refresh or a lost race adds no facts.
        return toView(submitted, deps.clock())
      }
      const raced = await deps.repo.findForSession(scope, sessionId, deps.clock())
      if (!raced) throw new GuestResponseLifecycleError('response_unavailable')
      return toView(raced, deps.clock())
    },

    addPrivateFeedback: async (
      scope: GuestResponseScope,
      sessionId: string,
      input: Readonly<{ text: string; textConsent: boolean }>,
    ): Promise<GuestResponseView> => {
      const now = deps.clock()
      const current = await deps.repo.findForSession(scope, sessionId, now)
      if (!current) throw new GuestResponseLifecycleError('response_not_found')
      if (
        current.text !== null &&
        current.feedbackSubmittedAt !== null &&
        current.feedbackSourceEventId !== null
      ) {
        return toView(current, now)
      }
      requireKnownFactLineage(current)
      const feedbackAdded = unwrap(submitPrivateFeedback(current, input, now))
      const renewed = {
        ...feedbackAdded,
        sessionExpiresAt: new Date(now.getTime() + DEFAULT_RESPONSE_SESSION_WINDOW_MS),
      }
      const fact = guestFeedbackSubmitted({
        feedbackId: feedbackId(renewed.id),
        organizationId: organizationId(renewed.organizationId),
        portalId: portalId(renewed.portalId),
        propertyId: propertyId(renewed.propertyId),
        ratingId: renewed.rating === null ? null : ratingId(renewed.id),
        occurredAt: renewed.feedbackSubmittedAt ?? now,
      })
      if ((await deps.commandStore.commitFeedbackAdded(renewed, fact)) !== 'applied') {
        throw new GuestResponseLifecycleError('feedback_already_submitted')
      }
      return toView(renewed, deps.clock())
    },

    withdrawPrivateFeedback: async (
      scope: GuestResponseScope,
      sessionId: string,
    ): Promise<GuestResponseView> => {
      const current = await deps.repo.findForSession(scope, sessionId, deps.clock())
      if (!current) throw new GuestResponseLifecycleError('response_not_found')
      if (current.feedbackWithdrawnAt !== null) return toView(current, deps.clock())
      requireKnownFactLineage(current)
      const now = deps.clock()
      const withdrawn = unwrap(
        withdrawPrivateFeedback(current, now, FEEDBACK_WITHDRAWAL_WINDOW_MS),
      )
      const fact = guestFeedbackRetracted({
        feedbackId: feedbackId(withdrawn.id),
        organizationId: organizationId(withdrawn.organizationId),
        portalId: portalId(withdrawn.portalId),
        propertyId: propertyId(withdrawn.propertyId),
        supersedesSourceEventId: current.feedbackSourceEventId!,
        occurredAt: withdrawn.feedbackWithdrawnAt ?? now,
      })
      if (
        (await deps.commandStore.commitFeedbackWithdrawn(current, withdrawn, fact)) !==
        'applied'
      ) {
        throw new GuestResponseLifecycleError('response_unavailable')
      }
      return toView(withdrawn, deps.clock())
    },

    // The response revision and every replacement/retraction fact share one
    // transaction. Metric consumers can therefore append corrections without
    // double-counting or leaving the originally submitted value stale.
    correct: async (
      scope: GuestResponseScope,
      sessionId: string,
      input: GuestResponseInput,
    ): Promise<GuestResponseView> => {
      const current = await deps.repo.findForSession(scope, sessionId, deps.clock())
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
      return toView(corrected, deps.clock())
    },

    /**
     * Internal integrity control. Delivery layers must keep this unavailable to
     * Property managers: their moderation path may hide text/media only.
     */
    changeIntegrity: async (
      scope: GuestResponseScope,
      responseId: string,
      input: Readonly<{
        outcome: GuestResponseIntegrityOutcome
        reasonCode: string
        source: 'automatic' | 'reviewer'
        actorId: string
      }>,
    ) => {
      const current = await deps.repo.findById(scope, responseId)
      if (!current) throw new GuestResponseLifecycleError('response_not_found')
      requireKnownFactLineage(current)
      const changed = changeGuestResponseIntegrity(current, input, deps.clock())
      if ('code' in changed) throw new GuestResponseLifecycleError(changed.code)
      const facts = integrityFacts(current, changed.response)
      if (
        (await deps.commandStore.commitIntegrityChanged(
          current,
          changed.response,
          changed.decision,
          facts,
        )) !== 'applied'
      ) {
        throw new GuestResponseLifecycleError('response_unavailable')
      }
      return changed.decision
    },

    withdraw: async (
      scope: GuestResponseScope,
      sessionId: string,
    ): Promise<GuestResponseView> => {
      const current = await deps.repo.findForSession(scope, sessionId, deps.clock())
      if (!current) throw new GuestResponseLifecycleError('response_not_found')
      if (current.status === 'deleted') return toView(current, deps.clock())
      requireKnownFactLineage(current)
      const deleted = unwrap(
        withdrawResponse(current, deps.clock(), RESPONSE_WITHDRAWAL_WINDOW_MS),
      )
      const committed = await deps.commandStore.commitWithdrawn(
        deleted,
        withdrawalFacts(current),
      )
      if (committed.outcome !== 'applied') {
        throw new GuestResponseLifecycleError('response_unavailable')
      }
      await removeObjects(scope, committed.objectKeys)
      return toView(deleted, deps.clock())
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
      return toView(moderated, deps.clock())
    },

    issueMedia: async (
      scope: GuestResponseScope,
      sessionId: string,
      input: Readonly<{ contentType: string; sizeBytes: number }>,
    ) => {
      const response = await deps.repo.findForSession(scope, sessionId, deps.clock())
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
      const response = await deps.repo.findForSession(scope, sessionId, deps.clock())
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
