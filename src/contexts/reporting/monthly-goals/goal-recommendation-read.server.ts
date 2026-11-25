// Reporting — the Monthly portal goal's recommended number for one Property
// (ADR 0068 decisions 4, 5 and 12).
//
// Who may read it is whoever may set the goal: a composed read asks for
// `goal.create` itself (under `goal.use` and the Property grant, through the
// execution policy) and gathers it with `gatherPortalGoalRecommendation` at the
// instant it read its own clock. It reads the Property's time zone and Portal's facts about its
// Portals together, and the Property's goal-count readings in one statement: the
// basis and this month as one range, never before both measures began, with
// each published Portal's last scan looked for from its code's date (at most a
// year back). The counts wait for the Portals because those dates come from
// them. The rule is the domain's (`recommendPortalGoal`); this only gathers
// what it is applied to. A suggestion, never a result: it writes nothing.

import { calendarPeriodRange } from '#/shared/domain/period-range'
import { recommendationWindow, recommendPortalGoal } from '../domain/goal-recommendation'
import type { RecommendationPortal } from '../domain/goal-recommendation-types'
import { findMetricVersionById, METRIC_VERSION_IDS } from '../readings/contracts'
import type { PortalGoalRecommendation } from './contracts'
import type {
  GoalRecommendationCounts,
  GoalRecommendationFactsPort,
} from './goal-recommendation-facts.port.server'
import {
  GoalProgramError,
  type GoalProgramSubjectReader,
} from '../application/use-cases/goal-program-shared'

/** How far back a Portal's last scan is looked for, whatever its code's age. */
const SCAN_LOOKBACK_MS = 365 * 86_400_000

/** The first instant both goal count measures are in effect. */
const MEASURES_FROM = new Date(
  Math.max(
    ...[
      METRIC_VERSION_IDS.qualifiedScanGoal,
      METRIC_VERSION_IDS.portalRatingCountGoal,
    ].map((versionId) => {
      const governed = findMetricVersionById(versionId)
      if (!governed) throw new Error(`Goal count metric is unavailable: ${versionId}`)
      return governed.version.effectiveFrom.getTime()
    }),
  ),
)

/** The basis and the current month as one half-open range, ending now. */
function readingsFrom(now: Date, timezone: string): Date {
  const basis = recommendationWindow(now, timezone).start
  const month = calendarPeriodRange(now, timezone, 'monthly').start
  return new Date(
    Math.max(Math.min(basis.getTime(), month.getTime()), MEASURES_FROM.getTime()),
  )
}

/**
 * Each published Portal with a code, from its code's date or a year back. A
 * disabled one's last scan feeds no step and no quiet fact, and finding it walks
 * every reading the Portal ever had, so it is not looked for.
 */
function scanLookbackOf(portals: readonly RecommendationPortal[], now: Date) {
  const yearBack = now.getTime() - SCAN_LOOKBACK_MS
  return portals.flatMap((portal) =>
    portal.publicationState === 'published' && portal.codeIssuedAt
      ? [
          {
            portalId: portal.portalId,
            from: new Date(Math.max(portal.codeIssuedAt.getTime(), yearBack)),
          },
        ]
      : [],
  )
}

/** What the recommendation reads, for a caller that has authorized `goal.create`. */
export type PortalGoalRecommendationReads = Readonly<{
  subjects: Pick<GoalProgramSubjectReader, 'getTimezone'>
  facts: GoalRecommendationFactsPort
}>

/**
 * What the recommendation is worked out from, as read at `now`: the Property's
 * time zone, Portal's facts about its Portals (each with its group now), and
 * the counts per Portal and per Portal Group. The add sheet works
 * a number out for each of them from the same facts.
 */
export type PortalGoalFacts = Readonly<{
  now: Date
  timezone: string
  listed: Awaited<ReturnType<GoalRecommendationFactsPort['listPortalReadiness']>>
  counts: GoalRecommendationCounts
}>

/**
 * The facts at `now`, read for a caller that has already asked the policy for
 * `goal.create` on the Property: it authorizes nothing itself.
 */
export async function gatherPortalGoalFacts(
  deps: PortalGoalRecommendationReads,
  input: Readonly<{ organizationId: string; propertyId: string; now: Date }>,
): Promise<PortalGoalFacts> {
  const { organizationId, propertyId, now } = input
  const [timezone, listed] = await Promise.all([
    deps.subjects.getTimezone(organizationId, propertyId),
    deps.facts.listPortalReadiness(organizationId, propertyId, now),
  ])
  if (!timezone) throw new GoalProgramError('not_found')

  const counts = await deps.facts.readDailyCounts({
    organizationId,
    propertyId,
    timezone,
    from: readingsFrom(now, timezone),
    to: now,
    scanLookback: scanLookbackOf(listed.portals, now),
  })
  return { now, timezone, listed, counts }
}

/** The domain's rule on the facts. */
export function recommendationFrom(facts: PortalGoalFacts): PortalGoalRecommendation {
  const { now, timezone, listed, counts } = facts
  return recommendPortalGoal({
    now,
    timezone,
    versionFrom: MEASURES_FROM,
    portals: listed.portals,
    ...counts,
  })
}

/**
 * The recommendation at `now`, read for a caller that has already asked the
 * policy for `goal.create` on the Property: it authorizes nothing itself.
 */
export async function gatherPortalGoalRecommendation(
  deps: PortalGoalRecommendationReads,
  input: Readonly<{ organizationId: string; propertyId: string; now: Date }>,
): Promise<PortalGoalRecommendation> {
  return recommendationFrom(await gatherPortalGoalFacts(deps, input))
}
