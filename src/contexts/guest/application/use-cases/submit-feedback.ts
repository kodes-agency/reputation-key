import type { GuestInteractionRepository } from '../ports/guest-interaction.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type {
  OrganizationId,
  PortalId,
  PropertyId,
  FeedbackId,
  RatingId,
} from '#/shared/domain/ids'
import type { ScanSource } from '../../domain/types'
import { buildFeedback } from '../../domain/constructors'
import { feedbackSubmitted } from '../../domain/events'

export type SubmitFeedbackDeps = Readonly<{
  guestRepo: GuestInteractionRepository
  events: EventBus
  idGen: () => FeedbackId
  clock: () => Date
}>

export type SubmitFeedbackInput = Readonly<{
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  sessionId: string
  comment: string
  source: ScanSource
  ipHash: string
  ratingId?: RatingId
}>

export const submitFeedback =
  (deps: SubmitFeedbackDeps) => async (input: SubmitFeedbackInput) => {
    const feedbackResult = buildFeedback({
      id: deps.idGen(),
      ...input,
      ratingId: input.ratingId ?? null,
      now: deps.clock(),
    })

    if (feedbackResult.isErr()) {
      throw feedbackResult.error
    }

    const feedback = feedbackResult.value
    await deps.guestRepo.insertFeedback(feedback)

    deps.events.emit(
      feedbackSubmitted({
        feedbackId: feedback.id,
        organizationId: input.organizationId,
        portalId: input.portalId,
        propertyId: input.propertyId,
        ratingId: feedback.ratingId,
        occurredAt: feedback.createdAt,
      }),
    )

    return feedback
  }

export type SubmitFeedback = ReturnType<typeof submitFeedback>
