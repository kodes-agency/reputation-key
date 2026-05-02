import type { Rating } from '../../domain/types'
import type { GuestInteractionRepository } from '../ports/guest-interaction.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { OrganizationId, PortalId, PropertyId, RatingId } from '#/shared/domain/ids'
import type { ScanSource } from '../../domain/types'
import { buildRating } from '../../domain/constructors'
import { guestError } from '../../domain/errors'
import { ratingSubmitted } from '../../domain/events'

export type SubmitRatingDeps = Readonly<{
  guestRepo: GuestInteractionRepository
  events: EventBus
  idGen: () => RatingId
  clock: () => Date
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

    const ratingResult = buildRating({
      id: deps.idGen(),
      ...input,
      now: deps.clock(),
    })

    if (ratingResult.isErr()) {
      throw ratingResult.error
    }

    const rating = ratingResult.value
    await deps.guestRepo.insertRating(rating)

    deps.events.emit(
      ratingSubmitted({
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
