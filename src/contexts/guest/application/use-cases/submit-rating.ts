import type { Rating } from '../../domain/types'
import type { GuestInteractionRepository } from '../ports/guest-interaction.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { OrganizationId, PortalId, PropertyId, RatingId } from '#/shared/domain/ids'
import type { ScanSource } from '../../domain/types'
import { buildRating } from '../../domain/constructors'
import { guestError } from '../../domain/errors'
import { guestRatingSubmitted } from '../../domain/events'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

export type SubmitRatingDeps = Readonly<{
  guestRepo: GuestInteractionRepository
  events: EventBus
  idGen: () => RatingId
  clock: () => Date
  /**
   * Window (seconds) for ipHash-based abuse dedup. A single source IP may not
   * rate the same portal more than once within this window — guards against
   * cookie-rotation flooding while staying short enough to avoid over-blocking
   * shared NATs (cafés, offices).
   */
  ipDedupWindowSeconds: number
  outboxRepo?: OutboxRepository
}>

export type SubmitRatingInput = Readonly<{
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  sessionId: string
  value: number
  source: ScanSource
  ipHash: string
}>

export const submitRating =
  (deps: SubmitRatingDeps) =>
  async (input: SubmitRatingInput): Promise<Rating> => {
    const alreadyRated = await deps.guestRepo.hasRated(
      input.organizationId,
      input.sessionId,
      input.portalId,
    )
    if (alreadyRated) {
      throw guestError('duplicate_rating', 'You have already rated this portal')
    }

    // Abuse-detection guard: a client that rotates the guest_session cookie
    // gets a fresh sessionId (and thus bypasses hasRated + the session/portal
    // unique constraint) on every request. Reject when the same source IP has
    // already rated this portal within the dedup window.
    const ipDuplicate = await deps.guestRepo.hasRatedByIpWithin(
      input.organizationId,
      input.ipHash,
      input.portalId,
      deps.ipDedupWindowSeconds,
    )
    if (ipDuplicate) {
      throw guestError('duplicate_rating', 'You have already rated this portal')
    }

    const ratingResult = buildRating({
      id: deps.idGen(),
      organizationId: input.organizationId,
      portalId: input.portalId,
      propertyId: input.propertyId,
      sessionId: input.sessionId,
      value: input.value,
      source: input.source,
      ipHash: input.ipHash,
      now: deps.clock(),
    })

    if (ratingResult.isErr()) {
      throw ratingResult.error
    }

    const rating = ratingResult.value
    await deps.guestRepo.insertRating(rating)

    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      guestRatingSubmitted({
        ratingId: rating.id,
        organizationId: input.organizationId,
        portalId: input.portalId,
        propertyId: input.propertyId,
        value: rating.value,
        occurredAt: rating.createdAt,
      }),
    )

    return rating
  }

export type SubmitRating = ReturnType<typeof submitRating>
