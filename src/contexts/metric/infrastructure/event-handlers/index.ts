import type { EventBus } from '#/shared/events/event-bus'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import { onScanRecorded } from './on-scan-recorded'
import { onRatingSubmitted } from './on-rating-submitted'
import { onFeedbackSubmitted } from './on-feedback-submitted'
import { onReviewLinkClicked } from './on-review-link-clicked'
import { onReviewCreated } from './on-review-created'

export type RegisterMetricHandlersDeps = Readonly<{
  events: EventBus
  recordMetric(input: RecordMetricInput): Promise<unknown>
}>

export const registerMetricHandlers = (deps: RegisterMetricHandlersDeps): void => {
  deps.events.on('scan.recorded', onScanRecorded({ recordMetric: deps.recordMetric }))
  deps.events.on(
    'rating.submitted',
    onRatingSubmitted({ recordMetric: deps.recordMetric }),
  )
  deps.events.on(
    'feedback.submitted',
    onFeedbackSubmitted({ recordMetric: deps.recordMetric }),
  )
  deps.events.on(
    'review-link.clicked',
    onReviewLinkClicked({ recordMetric: deps.recordMetric }),
  )
  deps.events.on('review.created', onReviewCreated({ recordMetric: deps.recordMetric }))
}
