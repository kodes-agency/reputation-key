// Metric context — records portal.review_link_click metric on review link click events
import type { GuestReviewLinkClicked } from '#/contexts/guest/application/public-api'
import {
  makeDurableRecordMetricHandler,
  makeRecordMetricHandler,
} from './record-portal-metric'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'

const options = {
  metricKey: 'portal.review_link_click',
  definitionVersionId: METRIC_VERSION_IDS.portalDestinationClickAnalytics,
  sourcePolicy: 'review_solicitation_analytics_only',
  span: 'metric.event.onReviewLinkClicked',
} as const

export const onReviewLinkClicked =
  makeRecordMetricHandler<GuestReviewLinkClicked>(options)
export const onReviewLinkClickedDurably =
  makeDurableRecordMetricHandler<GuestReviewLinkClicked>(options)
