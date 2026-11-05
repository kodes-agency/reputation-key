// Metric context — metric repository port
// Per architecture: "Repository ports for all data access."

import type { MetricKey } from '../../domain/metric-types'
import type {
  OrganizationId,
  PropertyId,
  PortalId,
  PortalGroupId,
} from '#/shared/domain/ids'

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
  /** Latest current correction tip affecting this exact subject/period. */
  correctionHead: Date | null
}>

export type MetricReadingPresenceQuery = Readonly<{
  organizationId: OrganizationId
  definitionVersionId: string
  sourceEventId: string
}>

export type MetricRepository = Readonly<{
  queryGoalAggregate(query: GoalMetricAggregateQuery): Promise<GoalMetricAggregate>
  /** Whether the source event has a reading under this version, corrected since or not. */
  hasReading(query: MetricReadingPresenceQuery): Promise<boolean>
}>
