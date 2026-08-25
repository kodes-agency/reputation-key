import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { FleetMetricEvidence } from '../../domain/types'
import type { DashboardComparisonPeriod } from './dashboard.repository'

export const FLEET_PAGE_SIZE = 50

export type FleetProjectionScope = Readonly<{
  userId: UserId
  organizationWide: boolean
}>

export type FleetCursorAnchor = Readonly<{
  lowerName: string
  propertyId: PropertyId
}>

export type FleetOverviewProjectionInput = Readonly<{
  organizationId: OrganizationId
  accessiblePropertyIds: readonly PropertyId[] | null
  portalReadEnabled: boolean
  goalReadEnabled: boolean
  cursor: FleetCursorAnchor | null
  startDate: Date
  endDate: Date
  comparisonPeriod: DashboardComparisonPeriod | null
  now: Date
  slaCutoff: Date
}>

export type FleetOverviewProjectionRow = Readonly<{
  propertyId: PropertyId
  name: string
  slug: string
  timezone: string
  reviewCount: number
  priorReviewCount: number
  avgRating: number
  priorAvgRating: number
  scanCount: number
  feedbackCount: number
  unanswered: number
  newFeedback: number
  escalated: number
  goalsBehindPace: number
  reviewEvidence: FleetMetricEvidence
  scanEvidence: FleetMetricEvidence | null
  feedbackEvidence: FleetMetricEvidence | null
}>

export type FleetOverviewProjectionResult = Readonly<{
  rows: readonly FleetOverviewProjectionRow[]
  summary: Readonly<{
    propertyCount: number
    overallAvgRating: number
    totalAttention: number
  }>
  nextAnchor: FleetCursorAnchor | null
}>

export type FleetOverviewProjectionPort = Readonly<{
  read(input: FleetOverviewProjectionInput): Promise<FleetOverviewProjectionResult>
}>
