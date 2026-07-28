// Metric context — records portal.review_link_click metric on review link click events
import type { GuestReviewLinkClicked } from '#/contexts/guest/application/public-api'
import { makeRecordMetricHandler } from './record-portal-metric'

export const onReviewLinkClicked = makeRecordMetricHandler<GuestReviewLinkClicked>({
  metricKey: 'portal.review_link_click',
  span: 'metric.event.onReviewLinkClicked',
})
