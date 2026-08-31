import type { EventBus } from '#/shared/events/event-bus'
import type { OrganizationId, PortalId, PortalGroupId } from '#/shared/domain/ids'
import type { RecordMetric } from '../../application/use-cases/record-metric'
import type { ReviewRatingLookupPort } from '../../application/ports/review-rating-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { onScanRecorded } from './on-scan-recorded'
import { onQualifiedScanRecorded } from './on-qualified-scan-recorded'
import { onQualifiedScanRetracted } from './on-qualified-scan-retracted'
import { onRatingSubmitted } from './on-rating-submitted'
import { onFeedbackSubmitted } from './on-feedback-submitted'
import { onRatingRetracted } from './on-rating-retracted'
import { onFeedbackRetracted } from './on-feedback-retracted'
import type { RetractMetric } from '../../application/use-cases/retract-metric'
import { onReviewLinkClicked } from './on-review-link-clicked'
import { onReviewCreated } from './on-review-created'
import {
  onApprovedDestinationRatioRecorded,
  onConfigurationCompletenessRecorded,
  onContentReviewCompleted,
  type PortalWorkflowMetricDeps,
} from './on-portal-workflow-metric'

export type FindGroupForPortal = (
  orgId: OrganizationId,
  portalId: PortalId,
  asOf: Date,
) => Promise<{ portalGroupId: PortalGroupId } | null>

export type RegisterMetricHandlersDeps = Readonly<{
  events: EventBus
  recordMetric: RecordMetric
  retractMetric: RetractMetric
  findGroupForPortal: FindGroupForPortal
  resolvePortalWorkflowAttribution: PortalWorkflowMetricDeps['resolveAttribution']
  reviewRatingLookup: ReviewRatingLookupPort
  logger: Pick<LoggerPort, 'error' | 'warn'>
}>

export const registerMetricHandlers = (deps: RegisterMetricHandlersDeps): void => {
  const portalWorkflowDeps: PortalWorkflowMetricDeps = {
    recordMetric: deps.recordMetric,
    resolveAttribution: deps.resolvePortalWorkflowAttribution,
  }
  deps.events.on(
    'portal.content_review.completed',
    onContentReviewCompleted(portalWorkflowDeps),
    { consumer: 'metric.event-handlers' },
  )
  deps.events.on(
    'portal.configuration_completeness.recorded',
    onConfigurationCompletenessRecorded(portalWorkflowDeps),
    { consumer: 'metric.event-handlers' },
  )
  deps.events.on(
    'portal.approved_destination_ratio.recorded',
    onApprovedDestinationRatioRecorded(portalWorkflowDeps),
    { consumer: 'metric.event-handlers' },
  )

  deps.events.on(
    'guest.scan.recorded',
    onScanRecorded({
      recordMetric: deps.recordMetric,
      findGroupForPortal: deps.findGroupForPortal,
      logger: deps.logger,
    }),
    { consumer: 'metric.event-handlers' },
  )
  deps.events.on(
    'guest.qualified_scan.recorded',
    onQualifiedScanRecorded({
      recordMetric: deps.recordMetric,
      findGroupForPortal: deps.findGroupForPortal,
      logger: deps.logger,
    }),
    { consumer: 'metric.event-handlers' },
  )
  deps.events.on(
    'guest.qualified_scan.retracted',
    onQualifiedScanRetracted({
      retractMetric: deps.retractMetric,
      logger: deps.logger,
    }),
    { consumer: 'metric.event-handlers' },
  )
  deps.events.on(
    'guest.rating.submitted',
    onRatingSubmitted({
      recordMetric: deps.recordMetric,
      findGroupForPortal: deps.findGroupForPortal,
      logger: deps.logger,
    }),
    { consumer: 'metric.event-handlers' },
  )
  deps.events.on(
    'guest.rating.retracted',
    onRatingRetracted({ retractMetric: deps.retractMetric, logger: deps.logger }),
    { consumer: 'metric.event-handlers' },
  )
  deps.events.on(
    'guest.feedback.submitted',
    onFeedbackSubmitted({
      recordMetric: deps.recordMetric,
      findGroupForPortal: deps.findGroupForPortal,
      logger: deps.logger,
    }),
    { consumer: 'metric.event-handlers' },
  )
  deps.events.on(
    'guest.feedback.retracted',
    onFeedbackRetracted({ retractMetric: deps.retractMetric, logger: deps.logger }),
    { consumer: 'metric.event-handlers' },
  )
  deps.events.on(
    'guest.review_link.clicked',
    onReviewLinkClicked({
      recordMetric: deps.recordMetric,
      findGroupForPortal: deps.findGroupForPortal,
      logger: deps.logger,
    }),
    { consumer: 'metric.event-handlers' },
  )
  deps.events.on(
    'review.created',
    onReviewCreated({
      recordMetric: deps.recordMetric,
      reviewRatingLookup: deps.reviewRatingLookup,
      logger: deps.logger,
    }),
    { consumer: 'metric.event-handlers' },
  )
}
