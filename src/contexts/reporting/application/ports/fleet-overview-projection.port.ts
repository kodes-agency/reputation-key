import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { FleetMetricEvidence } from '../../domain/dashboard-types'
import type { GoogleSnapshotFigures } from '../../domain/google-numbers'
import type { RatingGoalMode, RatingGoalStatus } from '../../domain/rating-goal'

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
  /** Null means the unbounded All Time period; otherwise local calendar days. */
  periodDays: number | null
  now: Date
}>

export type FleetOverviewProjectionRow = Readonly<{
  propertyId: PropertyId
  name: string
  slug: string
  timezone: string
  reviewCount: number
  priorReviewCount: number
  avgRating: number | null
  priorAvgRating: number | null
  scanCount: number
  feedbackCount: number
  overdue: number
  itemsToTriage: number
  escalated: number
  goalsBehindPace: number
  /** Distinct Inbox work anchors plus goals behind pace, before rating-drop signal. */
  needsAttention: number
  reviewEvidence: FleetMetricEvidence
  scanEvidence: FleetMetricEvidence | null
  feedbackEvidence: FleetMetricEvidence | null
  /**
   * The Current on Google snapshot at the Property's current binding epoch,
   * and whether that binding is active now; null when Google sent none.
   */
  google: (GoogleSnapshotFigures & Readonly<{ bindingActive: boolean }>) | null
  /** `properties.lifecycle_state` is `active` (not paused). */
  lifecycleActive: boolean
  /**
   * The Property's active Google rating goal as stored: its target, mode and
   * the status its last evaluation stored. Null without one, and always null
   * when the reader's goal read is off. Never evaluated here.
   */
  ratingGoal: Readonly<{
    mode: RatingGoalMode
    targetTenths: number
    lastStatus: RatingGoalStatus | null
  }> | null
}>

export type FleetOverviewProjectionResult = Readonly<{
  rows: readonly FleetOverviewProjectionRow[]
  summary: Readonly<{
    propertyCount: number
    ratingSampleCount: number
    overallAvgRating: number
    totalAttention: number
  }>
  nextAnchor: FleetCursorAnchor | null
}>

export type FleetOverviewProjectionPort = Readonly<{
  read(input: FleetOverviewProjectionInput): Promise<FleetOverviewProjectionResult>
}>
