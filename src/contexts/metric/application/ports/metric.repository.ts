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
  /** Optional half-open bounds: periodStart <= eventAt < periodEnd. */
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

export type GoalMetricSubject =
  | Readonly<{ kind: 'property'; propertyId: PropertyId }>
  | Readonly<{ kind: 'portal_group'; portalGroupId: PortalGroupId }>
  | Readonly<{ kind: 'portal'; portalId: PortalId }>

export type GoalMetricAggregateQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  definitionVersionId: string
  expectedMetricKey: MetricKey
  allowedSourcePolicies: readonly string[]
  subject: GoalMetricSubject
  /** Half-open property-local period expressed as UTC instants. */
  periodStart: Date
  periodEnd: Date
}>

export type GoalMetricAggregate = Readonly<{
  sum: number
  weightedSum: number
  sampleCount: number
  readingCount: number
  approximateCount: number
  updatingCount: number
  invalidQualityCount: number
  invalidSampleCount: number
  invalidSourceCount: number
  invalidDefinitionCount: number
}>

export type MetricRepository = Readonly<{
  queryAggregate(query: MetricReadingsQuery): Promise<MetricReadingsAggregate>
  queryGoalAggregate(query: GoalMetricAggregateQuery): Promise<GoalMetricAggregate>
}>
