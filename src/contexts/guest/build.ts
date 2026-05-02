import type { EventBus } from '#/shared/events/event-bus'
import type { Database } from '#/shared/db'
import { createGuestInteractionRepository } from './infrastructure/repositories/guest-interaction.repository'
import { recordScan } from './application/use-cases/record-scan'
import { submitRating } from './application/use-cases/submit-rating'
import { submitFeedback } from './application/use-cases/submit-feedback'
import { trackReviewLinkClick } from './application/use-cases/track-review-link-click'
import { scanEventId, ratingId, feedbackId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'

type GuestContextDeps = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
}>

export const buildGuestContext = (deps: GuestContextDeps) => {
  const guestRepo = createGuestInteractionRepository(deps.db)

  const useCases = {
    recordScan: recordScan({
      guestRepo,
      events: deps.events,
      idGen: () => scanEventId(randomUUID()),
      clock: deps.clock,
    }),
    submitRating: submitRating({
      guestRepo,
      events: deps.events,
      idGen: () => ratingId(randomUUID()),
      clock: deps.clock,
    }),
    submitFeedback: submitFeedback({
      guestRepo,
      events: deps.events,
      idGen: () => feedbackId(randomUUID()),
      clock: deps.clock,
    }),
    trackReviewLinkClick: trackReviewLinkClick({
      events: deps.events,
      clock: deps.clock,
    }),
  } as const

  return { useCases, guestRepo } as const
}
