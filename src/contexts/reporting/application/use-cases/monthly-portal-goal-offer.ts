// Reporting — the number the Monthly portal goal's card offers (ADR 0068
// decisions 3 to 5, PLAN PG-09).
//
// The recommendation decides every number; this only picks the ones the card
// offers and says what they stand on. The month is the recommendation's
// default (this month through the 20th local day, else the next) and the
// measure its default (private ratings, or scans when the Portals had scans
// but no private ratings). This month's choices are on top of what already
// counts; the next month's are a whole month's. The set command asks the same
// question of the month and measure it was sent, so "recommended" means the
// number this read would offer. The set sheet (PLAN PG-10) is offered the same
// numbers for both months and both measures, with the exact usual an own
// number is measured against. Pure.
import type {
  Choices,
  PortalGoalMeasure,
  PortalGoalRecommendation,
} from '../../domain/goal-recommendation-types'
import type {
  PortalGoalMeasureOffers,
  PortalGoalOffer,
  PortalGoalSheetFacts,
} from '../dto/monthly-portal-goal.types'

/**
 * The three choices for `month` and `measure`: the rest of this month, or the
 * whole of the next; null for another month, or a measure with no number.
 */
export function offeredChoices(
  recommendation: PortalGoalRecommendation,
  month: string,
  measure: PortalGoalMeasure,
): Choices | null {
  const { months, measures } = recommendation
  if (month === months.current.key) return measures[measure].fromToday
  if (month === months.next.key) return measures[measure].fullMonth.next
  return null
}

/** The offer for `month` and `measure`; null where the recommendation has no number. */
function portalGoalOfferFor(
  recommendation: PortalGoalRecommendation,
  month: string,
  measure: PortalGoalMeasure,
): PortalGoalOffer | null {
  const { months, basis } = recommendation
  const current = month === months.current.key
  const choices = offeredChoices(recommendation, month, measure)
  const { fullMonth, usualPerMonth } = recommendation.measures[measure]
  const whole = current ? fullMonth.current : fullMonth.next
  const usualExact = current ? usualPerMonth.current : usualPerMonth.next
  if (choices === null || whole === null || usualExact === null || basis === null) {
    return null
  }
  const joined = recommendation.portals.filter(({ inBasis }) => inBasis)
  return {
    month,
    current,
    days: current ? months.current.days : months.next.days,
    measure,
    choices: {
      usual: choices.usual,
      aBitMore: choices.aBitMore,
      stretch: choices.stretch,
    },
    usualAbout: whole.about,
    usualExact,
    basis: {
      weeks: basis.weeks,
      days: Math.max(...joined.map(({ liveDays }) => liveDays)),
      lastDay: recommendation.window.lastDay,
      count: basis.counts[measure],
      portals: joined.map(({ name, window, liveDays }) => ({
        name,
        count: window[measure],
        liveDays,
      })),
    },
    newPortals: recommendation.portals.flatMap(({ name, liveDays, joinsOn }) =>
      joinsOn === null ? [] : [{ name, liveDays, joinsOn }],
    ),
    soFar: current ? recommendation.monthToDate[measure] : null,
    rest: current
      ? { daysLeft: months.current.daysLeftWithToday, about: choices.about }
      : null,
    timezone: recommendation.timezone,
  }
}

/** What the ready card offers; null when the recommendation has no number to offer. */
export function portalGoalOfferOf(
  recommendation: PortalGoalRecommendation,
): PortalGoalOffer | null {
  return portalGoalOfferFor(
    recommendation,
    recommendation.defaultMonthKey,
    recommendation.defaultMeasure,
  )
}

/** What the set sheet works from: both months, both measures, and the month it opens on. */
export function portalGoalSheetFactsOf(
  recommendation: PortalGoalRecommendation,
): PortalGoalSheetFacts {
  const { months, monthToDate } = recommendation
  const offersOf = (measure: PortalGoalMeasure): PortalGoalMeasureOffers => ({
    current: portalGoalOfferFor(recommendation, months.current.key, measure),
    next: portalGoalOfferFor(recommendation, months.next.key, measure),
  })
  return {
    month: recommendation.defaultMonthKey,
    ownNumber: {
      current: {
        key: months.current.key,
        soFar: {
          ratings: monthToDate.portal_rating_count,
          scans: monthToDate.qualified_scans,
        },
      },
      next: { key: months.next.key },
    },
    offers: {
      portal_rating_count: offersOf('portal_rating_count'),
      qualified_scans: offersOf('qualified_scans'),
    },
    readyOn: recommendation.readyOn,
  }
}
