// Metric context — domain types

export type MetricKey =
  | 'portal.scan'
  | 'portal.rating'
  | 'portal.feedback'
  | 'portal.review_link_click'
  | 'property.review'

export type MetricReading = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  portalId: string | null
  metricKey: MetricKey
  value: number
  recordedAt: Date
}>
