import type { Feedback } from '../../domain/types'
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
import { guestFeedbackSubmitted } from '../../domain/events'
import { emitAndRecord } from '#/shared/outbox/emit-and-record'
import type { OutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'

export type SubmitFeedbackDeps = Readonly<{
  guestRepo: GuestInteractionRepository
  events: EventBus
  idGen: () => FeedbackId
  clock: () => Date
  outboxRepo?: OutboxRepository
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
  (deps: SubmitFeedbackDeps) =>
  async (input: SubmitFeedbackInput): Promise<Feedback> => {
    const feedbackResult = buildFeedback({
      id: deps.idGen(),
      organizationId: input.organizationId,
      portalId: input.portalId,
      propertyId: input.propertyId,
      sessionId: input.sessionId,
      comment: input.comment,
      source: input.source,
      ipHash: input.ipHash,
      ratingId: input.ratingId ?? null,
      now: deps.clock(),
    })

    if (feedbackResult.isErr()) {
      throw feedbackResult.error
    }

    const feedback = feedbackResult.value
    await deps.guestRepo.insertFeedback(feedback)

    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      guestFeedbackSubmitted({
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
