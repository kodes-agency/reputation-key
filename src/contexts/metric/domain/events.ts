// Metric context — domain events
import type {
  MetricReadingId,
  OrganizationId,
  PropertyId,
  PortalId,
  PortalGroupId,
} from '#/shared/domain/ids'
import type { MetricKey } from './types'

// fallow-ignore-next-line unused-type
export type MetricRecorded = Readonly<{
  _tag: 'metric.recorded'
  readingId: MetricReadingId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  groupId: PortalGroupId | null
  metricKey: MetricKey
  value: number
  recordedAt: Date
}>

export type MetricEvent = MetricRecorded

export const metricRecorded = (args: Omit<MetricRecorded, '_tag'>): MetricRecorded => ({
  _tag: 'metric.recorded',
  ...args,
})
