// The Monthly portal goal card's words when the number is ready (copy deck
// G-13…G-18, W-1…W-5, F-3): what is recommended and for which month, what it
// stands on, the Portals that join later, the Use button and its toast, and
// "How we worked this out". The read decides every number, month and day
// (PLAN E12); this only says them. Days arrive as Property-local `YYYY-MM-DD`,
// months as `YYYY-MM`, and are printed as those days.
import type {
  PortalGoalNewPortal,
  PortalGoalOffer,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { formatLocalDate, formatMonthName, formatNumber } from '#/lib/format'
import type { GoalRefusalSentences } from './goal-refusal'
import { listOfNames, portalGoalUnit, timeZoneCity } from './portal-goal-words'

/** "October", for the month `2026-10`. */
const monthName = (month: string): string =>
  formatMonthName(`${month}-15T12:00:00.000Z`) ?? month

/** "Oct 22", for the Property-local day `2026-10-22`. */
const dayWords = (day: string): string => formatLocalDate(day, { year: false }) ?? day

/** "40 private ratings", "1 scan". */
const countOf = (offer: PortalGoalOffer, n: number): string =>
  `${formatNumber(n)} ${portalGoalUnit(offer.measure, n)}`

/** "12 already count", "1 already counts". */
const alreadyCount = (n: number): string =>
  `${formatNumber(n)} already ${n === 1 ? 'counts' : 'count'}`

const plural = (n: number, one: string, many: string): string =>
  `${formatNumber(n)} ${n === 1 ? one : many}`

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
    countsFrom: offer.current
      ? `Counts from ${dayWords(`${offer.month}-01`)}${offer.soFar === null ? '' : ` · ${alreadyCount(offer.soFar)}`}.`
      : null,
    newPortals: newPortalsWords(offer),
    asksEveryGuest: ratings,
    use: ratings ? `Use ${formatNumber(aBitMore)}` : `Use ${countOf(offer, aBitMore)}`,
    setToast: `${month} goal set: ${countOf(offer, aBitMore)}`,
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

/**
 * F-3: a set the server refused because a goal was set a moment ago; the card
 * is read again with it. Every other refusal keeps the goal commands' sentence.
 */
export const PORTAL_SET_REFUSALS: GoalRefusalSentences = {
  subject_has_goal: 'A monthly portal goal was set a moment ago. Here is the latest.',
}
