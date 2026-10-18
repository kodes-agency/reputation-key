// Reporting — what the Monthly portal goal's recommended number is read from.
//
// Two reads, both bounded: Portal's facts about the Property's Portals (its
// public API, `listGoalReadinessFacts`, with each Portal's group now), and the
// Property's goal-count readings, per Portal and per Portal Group, in one
// set-based statement (`infrastructure/adapters/goal-recommendation-readings.ts`).
// Neither checks a permission; the use case has authorized `goal.create` first.

import type {
  RecommendationDayCount,
  RecommendationGroupDayCount,
  RecommendationGroupUnreadableDay,
  RecommendationPortal,
  RecommendationUnreadableDay,
} from '../../domain/goal-recommendation-types'

export type GoalRecommendationCountsQuery = Readonly<{
  organizationId: string
  propertyId: string
  /** The Property's time zone, which draws the local days. */
  timezone: string
  /** Readings at or after this instant and before `to`. */
  from: Date
  to: Date
  /** Each published Portal's last scan is looked for from its own instant on. */
  scanLookback: readonly Readonly<{ portalId: string; from: Date }>[]
}>

export type GoalRecommendationCounts = Readonly<{
  /** Each Portal's (or no Portal's) readings per measure and local day. */
  days: readonly RecommendationDayCount[]
  /** Each Portal's (or no Portal's) day with a reading the governed read would quarantine. */
  unreadable: readonly RecommendationUnreadableDay[]
  /** A Portal's last scan in its lookback, when it had one. */
  lastScanAt: ReadonlyMap<string, Date>
  /**
   * Each Portal Group's readings per measure and local day, by the group each
   * reading was recorded with: a Portal that moved counts in its old group
   * before the move and in its new one after (PLAN PG-20, G19).
   */
  groupDays: readonly RecommendationGroupDayCount[]
  /** Each Portal Group's day with a reading the governed read would quarantine. */
  groupUnreadable: readonly RecommendationGroupUnreadableDay[]
}>

export type GoalRecommendationFactsPort = Readonly<{
  /** Every non-archived Portal of the Property, in name order, at most 100. */
  listPortalReadiness(
    organizationId: string,
    propertyId: string,
    asOf: Date,
  ): Promise<Readonly<{ portals: readonly RecommendationPortal[]; truncated: boolean }>>
  readDailyCounts(query: GoalRecommendationCountsQuery): Promise<GoalRecommendationCounts>
}>
