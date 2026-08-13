// Metric context — metric repository port
// Per architecture: "Repository ports for all data access."

import type { MetricKey } from '../../domain/types'
import type { PermittedConsumer } from '../../domain/metric-registry'
import type {
  OrganizationId,
  PropertyId,
  PortalId,
  PortalGroupId,
} from '#/shared/domain/ids'

export type MetricReadingsQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  groupId: PortalGroupId | null
  metricKey: MetricKey
  consumer: PermittedConsumer
  periodStart?: Date
  periodEnd?: Date
  rollingWindowDays?: number
}>

export type MetricReadingsAggregate = Readonly<{
  sum: number
  count: number
  max: number
  available: boolean
  sampleCount: number
  minimumSample: number
}>

export type MetricRepository = Readonly<{
  queryAggregate(query: MetricReadingsQuery): Promise<MetricReadingsAggregate>
}>
