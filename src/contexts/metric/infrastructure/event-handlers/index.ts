import type { EventBus } from '#/shared/events/event-bus'
import type { OrganizationId, PortalId, PortalGroupId } from '#/shared/domain/ids'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import type { ReviewRatingLookupPort } from '../../application/ports/review-rating-lookup.port'
import { onScanRecorded } from './on-scan-recorded'
import { onRatingSubmitted } from './on-rating-submitted'
import { onFeedbackSubmitted } from './on-feedback-submitted'
import { onReviewLinkClicked } from './on-review-link-clicked'
import { onReviewCreated } from './on-review-created'

export type FindGroupForPortal = (
  orgId: OrganizationId,
  portalId: PortalId,
) => Promise<{ portalGroupId: PortalGroupId } | null>

export type RegisterMetricHandlersDeps = Readonly<{
  events: EventBus
  recordMetric(input: RecordMetricInput): Promise<unknown>
  findGroupForPortal: FindGroupForPortal
  reviewRatingLookup: ReviewRatingLookupPort
}>

export const registerMetricHandlers = (deps: RegisterMetricHandlersDeps): void => {
  deps.events.on(
    'guest.scan.recorded',
    onScanRecorded({
      recordMetric: deps.recordMetric,
      findGroupForPortal: deps.findGroupForPortal,
    }),
  )
  deps.events.on(
    'guest.rating.submitted',
    onRatingSubmitted({
      recordMetric: deps.recordMetric,
      findGroupForPortal: deps.findGroupForPortal,
    }),
  )
  deps.events.on(
    'guest.feedback.submitted',
    onFeedbackSubmitted({
      recordMetric: deps.recordMetric,
      findGroupForPortal: deps.findGroupForPortal,
    }),
  )
  deps.events.on(
    'guest.review_link.clicked',
    onReviewLinkClicked({
      recordMetric: deps.recordMetric,
      findGroupForPortal: deps.findGroupForPortal,
    }),
  )
  deps.events.on(
    'review.created',
    onReviewCreated({
      recordMetric: deps.recordMetric,
      reviewRatingLookup: deps.reviewRatingLookup,
    }),
  )
}
