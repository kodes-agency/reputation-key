// Metric context — domain events
// Standards: docs/standards.md §1

import type {
  MetricReadingId,
  OrganizationId,
  PropertyId,
  PortalId,
  PortalGroupId,
} from '#/shared/domain/ids'
import type { MetricKey } from './types'
import { metricError } from './errors'

export type MetricRecorded = Readonly<{
  _tag: 'metric.recorded'
  eventId: string
  readingId: MetricReadingId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  groupId: PortalGroupId | null
  metricKey: MetricKey
  value: number
  occurredAt: Date
  correlationId: string | null
}>
export const metricRecorded = (
  args: Omit<MetricRecorded, '_tag' | 'correlationId'>,
): MetricRecorded => {
  if (!(args.occurredAt instanceof Date))
    throw metricError('invalid_value', 'occurredAt must be Date')
  return {
    _tag: 'metric.recorded',
    correlationId: null,
    ...args,
  }
}

export type MetricEvent = MetricRecorded
