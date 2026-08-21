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
  submitResponse,
  type GuestResponse,
  type ResponseError,
} from '../../domain/guest-response'
import { guestFeedbackSubmitted, guestRatingSubmitted } from '../../domain/events'
import {
  feedbackId,
  organizationId,
  portalId,
  propertyId,
  ratingId,
} from '#/shared/domain/ids'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'
import type { EventBus } from '#/shared/events/event-bus'

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
  text: string | null
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
    text: response.text,
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
    events: EventBus
    outboxRepo?: OutboxRepository
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
  const emitSubmissionFacts = async (response: GuestResponse) => {
    const scopeIds = {
      organizationId: organizationId(response.organizationId),
      portalId: portalId(response.portalId),
      propertyId: propertyId(response.propertyId),
    }
    const occurredAt = response.submittedAt ?? deps.clock()
    if (response.rating !== null && response.responseConsent) {
      await emitAndRecord(
        deps.events,
        deps.outboxRepo,
        guestRatingSubmitted({
          ratingId: ratingId(response.id),
          ...scopeIds,
          value: response.rating,
          occurredAt,
        }),
      )
    }
    if (response.text !== null && response.textConsent) {
      await emitAndRecord(
        deps.events,
        deps.outboxRepo,
        guestFeedbackSubmitted({
          feedbackId: feedbackId(response.id),
          ...scopeIds,
          ratingId: response.rating !== null ? ratingId(response.id) : null,
          occurredAt,
        }),
      )
    }
  }

  return {
    getState,

    submit: async (
      scope: GuestResponseScope,
      sessionId: string,
      input: GuestResponseInput,
    ): Promise<GuestResponseView> => {
      const existing = await deps.repo.findForSession(scope, sessionId)
      if (existing) return toView(existing)
      const now = deps.clock()
      const submitted = unwrap(
        submitResponse(
          createResponse({
            id: deps.idGen(),
            ...scope,
            sessionId,
            retentionDeadline: new Date(now.getTime() + retentionMs),
          }),
          input,
          now,
        ),
      )
      if (await deps.repo.insertSubmitted(submitted)) {
        // Only the winning insert emits: the `existing`/`raced` paths return an
        // already-counted response, so a refresh or a lost race adds no facts.
        await emitSubmissionFacts(submitted)
        return toView(submitted)
      }
      const raced = await deps.repo.findForSession(scope, sessionId)
      if (!raced) throw new GuestResponseLifecycleError('response_unavailable')
      return toView(raced)
    },

    // PB2.4: a correction deliberately emits NO fact, so one guest never yields
    // two readings. Superseding (rather than adding) needs the whole chain
    // metric-command-store.ts already implements for portal workflow facts:
    // (1) a `rating_source_event_id` / `feedback_source_event_id` column on
    // guest_responses, written in the same statement as the submit, so the
    // correction knows which fact it replaces; (2) a `supersedesSourceEventId`
    // member on GuestRatingSubmitted / GuestFeedbackSubmitted; and (3) that
    // field forwarded by makeRecordMetricHandler (metric context) into
    // RecordMetricInput. Until all three exist the reading keeps the submitted
    // value — stale, but never double-counted.
    correct: async (
      scope: GuestResponseScope,
      sessionId: string,
      input: GuestResponseInput,
    ): Promise<GuestResponseView> => {
      const current = await deps.repo.findForSession(scope, sessionId)
      if (!current) throw new GuestResponseLifecycleError('response_not_found')
      const corrected = unwrap(
        correctResponse(current, input, deps.clock(), CORRECTION_WINDOW_MS),
      )
      if (!(await deps.repo.saveCorrection(corrected))) {
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
      const deleted = unwrap(deleteResponse(current, deps.clock()))
      const objectKeys = await deps.repo.deleteAndQueueMediaPurge(deleted)
      await removeObjects(scope, objectKeys)
      return toView(deleted)
    },

    moderate: async (
      scope: GuestResponseScope,
      responseId: string,
      action: 'quarantine' | 'delete',
    ): Promise<GuestResponseView> => {
      const current = await deps.repo.findById(scope, responseId)
      if (!current) throw new GuestResponseLifecycleError('response_not_found')
      if (action === 'delete') {
        if (current.status === 'deleted') return toView(current)
        const deleted = unwrap(deleteResponse(current, deps.clock()))
        const objectKeys = await deps.repo.deleteAndQueueMediaPurge(deleted)
        await removeObjects(scope, objectKeys)
        return toView(deleted)
      }
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
