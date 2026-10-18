// The Monthly portal goal card's words when the number is ready (copy deck
// G-13…G-18, W-1…W-5): what is recommended and for which month, what it stands
// on, the Portals that join later, the Use button and its toast, and "How we
// worked this out". The set sheet says its month and its toast in the same
// words. The read decides every number, month and day (PLAN E12); this only
// says them. Days arrive as Property-local `YYYY-MM-DD`, months as `YYYY-MM`,
// and are printed as those days.
import type {
  PortalGoalNewPortal,
  PortalGoalOffer,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import { formatNumber } from '#/lib/format'
import {
  dayWords,
  listOfNames,
  monthName,
  portalGoalCount,
  portalGoalUnit,
  timeZoneCity,
} from './portal-goal-words'

const countOf = (offer: PortalGoalOffer, n: number): string =>
  portalGoalCount(offer.measure, n)

/** "12 already count", "1 already counts". */
const alreadyCount = (n: number): string =>
  `${formatNumber(n)} already ${n === 1 ? 'counts' : 'count'}`

const plural = (n: number, one: string, many: string): string =>
  `${formatNumber(n)} ${n === 1 ? one : many}`

/**
 * G-17 and S-2: this month counts from its first day, with what already counts
 * ("Counts from Oct 1 · 12 already count."); without the count when it cannot
 * be read.
 */
export const countsFromWords = (month: string, soFar: number | null): string =>
  `Counts from ${dayWords(`${month}-01`)}${soFar === null ? '' : ` · ${alreadyCount(soFar)}`}.`

/** G-17: "November goal set: 40 private ratings", after Use or the sheet's Set. */
export const goalSetToast = (month: string, measure: PortalGoalMeasure, n: number) =>
  `${monthName(month)} goal set: ${portalGoalCount(measure, n)}`

/** The measure as a new Portal's sentence says it: "Its ratings count from day one". */
const READINGS: Readonly<Record<PortalGoalOffer['measure'], string>> = {
  portal_rating_count: 'ratings',
  qualified_scans: 'scans',
}

/** G-15: the live Portals that join the number once they have 2 weeks. */
function newPortalsWords(offer: PortalGoalOffer): string | null {
  const names = offer.newPortals.map(({ name }) => name)
  const readings = READINGS[offer.measure]
  if (names.length === 0) return null
  if (names.length === 1) {
    return `${names[0]} is new. Its ${readings} count from day one, and it joins the number once it has 2 weeks.`
  }
  return `${listOfNames(names)} are new. Their ${readings} count from day one, and they join the number once they have 2 weeks.`
}

export type PortalGoalOfferWords = Readonly<{
  /** G-13 and G-17: "Recommended for November"; none with scans first. */
  heading: string | null
  /** The figure and its unit beneath the heading; none with scans first. */
  figure: Readonly<{ value: string; unit: string }> | null
  /** G-14, or with scans first G-18: what the number stands on. */
  lead: string
  /** G-17: this month counts from its first day, with what already counts. */
  countsFrom: string | null
  newPortals: string | null
  /** G-16 goes only with private ratings. */
  asksEveryGuest: boolean
  /** "Use 40", "Use 55 scans". */
  use: string
  /** G-17: "November goal set: 40 private ratings". */
  setToast: string
  /**
   * The way into the set sheet, on the measure it opens on: G-17's "Change"; with
   * scans first, G-18's "Set a private ratings number".
   */
  door: Readonly<{ label: string; measure: PortalGoalMeasure }>
}>

/** The ready card's words for its offer. */
export function offerWords(offer: PortalGoalOffer): PortalGoalOfferWords {
  const { aBitMore } = offer.choices
  const month = monthName(offer.month)
  const ratings = offer.measure === 'portal_rating_count'
  const portals = plural(offer.basis.portals.length, 'portal', 'portals')
  return {
    heading: ratings ? `Recommended for ${month}` : null,
    figure: ratings
      ? { value: formatNumber(aBitMore), unit: portalGoalUnit(offer.measure, aBitMore) }
      : null,
    lead: ratings
      ? `A bit above your usual: about ${formatNumber(offer.usualAbout)} a month, from the last ${offer.basis.weeks} weeks at ${portals}.`
      : `Your portals had ${countOf(offer, offer.basis.count)} but no private ratings in the last ${offer.basis.weeks} weeks. Start by counting scans: ${countOf(offer, aBitMore)} in ${month}.`,
    countsFrom: offer.current ? countsFromWords(offer.month, offer.soFar) : null,
    newPortals: newPortalsWords(offer),
    asksEveryGuest: ratings,
    use: ratings ? `Use ${formatNumber(aBitMore)}` : `Use ${countOf(offer, aBitMore)}`,
    setToast: goalSetToast(offer.month, offer.measure, aBitMore),
    door: ratings
      ? { label: 'Change', measure: offer.measure }
      : { label: 'Set a private ratings number', measure: 'portal_rating_count' },
  }
}

/** W-1: the popover's title, and the words that open it. */
export const WORKED_OUT_TITLE = 'How we worked this out'

/** W-3: a new Portal's row. */
const newPortalRow = ({ name, liveDays }: PortalGoalNewPortal): string =>
  `${name} · live ${plural(liveDays, 'day', 'days')}, joins once it has 2 weeks`

/** W-4: how the measure counts, and whose months it follows. */
function workedOutFoot(offer: PortalGoalOffer): string {
  const months = `Months follow ${timeZoneCity(offer.timezone)} time.`
  return offer.measure === 'portal_rating_count'
    ? `Low and high ratings count the same. Withdrawn ratings don’t count. ${months}`
    : `The same visit counts once per portal in any 24 hours. Bots don’t count. ${months}`
}

/** W-5: the rest of this month, on top of what already counts. */
function restOfMonth(offer: PortalGoalOffer): string {
  const rest = offer.rest
  const counted = offer.soFar === null ? '' : `${alreadyCount(offer.soFar)} this month. `
  const added =
    rest === null
      ? ''
      : `At your usual, the ${plural(rest.daysLeft, 'day', 'days')} left add about ${formatNumber(rest.about)}. `
  return `${counted}${added}A bit more, rounded up: ${formatNumber(offer.choices.aBitMore)}.`
}

/** W-2, W-3 and W-4 (W-5 for this month): the sums behind the number. */
export function workedOutWords(offer: PortalGoalOffer): Readonly<{
  paragraphs: readonly string[]
  rows: readonly string[]
  foot: string
}> {
  const { basis } = offer
  const span = basis.days >= 28 ? '4 weeks' : `${basis.days} days`
  const names = listOfNames(basis.portals.map(({ name }) => name))
  const brought = `${names} brought in ${countOf(offer, basis.count)} in the ${span} to ${dayWords(basis.lastDay)}.`
  const wholeMonth = `At that pace, a ${offer.days}-day month gets about ${formatNumber(offer.usualAbout)}: your usual. The recommendation is a bit more, rounded up: ${formatNumber(offer.choices.aBitMore)}.`
  return {
    paragraphs: [brought, offer.current ? restOfMonth(offer) : wholeMonth],
    rows: [
      ...basis.portals.map(
        ({ name, count, liveDays }) =>
          `${name} · ${formatNumber(count)} in ${plural(liveDays, 'day', 'days')}`,
      ),
      ...offer.newPortals.map(newPortalRow),
    ],
    foot: workedOutFoot(offer),
  }
}
