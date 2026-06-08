// Metric context — domain types

import type {
  OrganizationId,
  PropertyId,
  PortalId,
  PortalGroupId,
  MetricReadingId,
} from '#/shared/domain/ids'

export type { MetricKey } from '#/shared/domain/metric-keys'
export type { AggregationFunction } from '#/shared/domain/metric-keys'

// Re-export for backward compatibility — consumers import MetricKey from here
import type { MetricKey } from '#/shared/domain/metric-keys'

export type MetricReading = Readonly<{
  id: MetricReadingId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  metricKey: MetricKey
  value: number
  groupId: PortalGroupId | null
  occurredAt: Date
}>
