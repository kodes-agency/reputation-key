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
// number is measured against: the one its "your usual" is rounded from, so for
// this month what already counts plus the days left at the usual. The
// month-start check-in (PLAN PG-15) offers this month's one recommended
// number, the sheet's (PLAN E6), worked out as a whole month ("a 31-day month
// gets about 38") only while the rest of the month is all of it: on its first
// day with nothing in yet, when the two are the same numbers. Pure.
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

/**
 * The offer for `month` and `measure`; null where the recommendation has no
 * number. This month's is the rest of it, on top of what already counts,
 * unless `wholeMonth` asks for all of it, as the next month's is.
 */
function portalGoalOfferFor(
  recommendation: PortalGoalRecommendation,
  month: string,
  measure: PortalGoalMeasure,
  wholeMonth = false,
): PortalGoalOffer | null {
  const { months, basis } = recommendation
  const thisMonth = month === months.current.key
  const current = thisMonth && !wholeMonth
  const { fullMonth, usualPerMonth, usualFromToday } = recommendation.measures[measure]
  const whole = thisMonth ? fullMonth.current : fullMonth.next
  const choices = current ? offeredChoices(recommendation, month, measure) : whole
  // What the offer's "your usual" stands for: this month's from today (what
  // already counts and the days left), a whole month's for all of it.
  const usualExact = current
    ? usualFromToday
    : thisMonth
      ? usualPerMonth.current
      : usualPerMonth.next
  if (
    (!thisMonth && month !== months.next.key) ||
    choices === null ||
    whole === null ||
    usualExact === null ||
    basis === null
  ) {
    return null
  }
  const joined = recommendation.portals.filter(({ inBasis }) => inBasis)
  return {
    month,
    current,
    days: thisMonth ? months.current.days : months.next.days,
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

/**
 * What the month-start check-in offers for this month, in `measure`: the
 * number the sheet offers for it now, on top of what already counts (PLAN E6).
 * On the month's first day with nothing in yet that is the whole month's (G4:
 * 40 · 45 · 50 for a 31-day December, 45 recommended), and it is worked out
 * as one ("a 31-day month gets about 38").
 */
export function checkInOfferOf(
  recommendation: PortalGoalRecommendation,
  measure: PortalGoalMeasure,
): PortalGoalOffer | null {
  const month = recommendation.months.current.key
  const rest = portalGoalOfferFor(recommendation, month, measure)
  if (rest === null || rest.soFar !== 0 || rest.rest?.daysLeft !== rest.days) return rest
  return portalGoalOfferFor(recommendation, month, measure, true) ?? rest
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
