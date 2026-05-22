// Metric context — domain types

import type { OrganizationId, PropertyId, PortalId, MetricReadingId } from '#/shared/domain/ids'

export type MetricKey =
  | 'portal.scan'
  | 'portal.rating'
  | 'portal.feedback'
  | 'portal.review_link_click'
  | 'property.review'

export type MetricReading = Readonly<{
  id: MetricReadingId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  metricKey: MetricKey
  value: number
  recordedAt: Date
}>
