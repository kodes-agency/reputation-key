// Metric context — records portal.review_link_click metric on review link click events
import type { GuestReviewLinkClicked } from '#/contexts/guest/application/public-api'
import { makeRecordMetricHandler } from './record-portal-metric'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'

export const onReviewLinkClicked = makeRecordMetricHandler<GuestReviewLinkClicked>({
  metricKey: 'portal.review_link_click',
  definitionVersionId: METRIC_VERSION_IDS.portalDestinationClickAnalytics,
  sourcePolicy: 'review_solicitation_analytics_only',
  span: 'metric.event.onReviewLinkClicked',
})
