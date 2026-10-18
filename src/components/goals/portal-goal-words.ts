// The Monthly portal goal card's words, before a goal (copy deck G-2, G-5…G-11,
// G-19) and for a goal with no month running (G-20); the running month's are
// `portal-goal-running-view.ts`. The read decides every state, day and number
// (PLAN E12); this only says them, in one place, so a card, its stories and
// its tests spell each line once. Days arrive as Property-local `YYYY-MM-DD`,
// months as `YYYY-MM`, and are printed as those days: no reader's zone can
// move them.
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type {
  PortalGoalCardView,
  PortalGoalOfCard,
  PortalGoalSoFar,
  PortalReadinessRow,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { formatLocalDate, formatMonthName, formatNumber } from '#/lib/format'
import { PORTAL_NO_SCAN_HINT } from './portal-goal-copy'

/** Each measure's unit, one and many. */
const UNITS: Readonly<Record<PortalGoalMeasure, readonly [string, string]>> = {
  portal_rating_count: ['private rating', 'private ratings'],
  qualified_scans: ['scan', 'scans'],
}

/** "private rating" or "scans": the measure's unit for a count of `n`. */
export function portalGoalUnit(measure: PortalGoalMeasure, n: number): string {
  const [one, many] = UNITS[measure]
  return n === 1 ? one : many
}

/** "Sofia" for Europe/Sofia: the city a Property's months follow. */
export function timeZoneCity(timezone: string): string {
  return (timezone.split('/').at(-1) ?? timezone).replaceAll('_', ' ')
}

/** "Spa", "Spa and Bar", "Reception, Restaurant and Spa". */
export function listOfNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** "October", for the month `2026-10`. */
export const monthName = (month: string): string =>
  formatMonthName(`${month}-15T12:00:00.000Z`) ?? month

/** "Oct 23", for the Property-local day `2026-10-23`. */
export const dayWords = (day: string): string =>
  formatLocalDate(day, { year: false }) ?? day

/** "40 private ratings", "1 scan". */
export const portalGoalCount = (measure: PortalGoalMeasure, n: number): string =>
  `${formatNumber(n)} ${portalGoalUnit(measure, n)}`

const RATINGS_SECTION_LINE = 'How many private ratings your portals bring in each month.'
const SCANS_SECTION_LINE = 'How many scans your portals get each month.'

/** G-2: what the goal counts, under the section's title. None at a gate (G-5 says it). */
export function portalGoalSectionLine(card: PortalGoalCardView): string | null {
  switch (card.state) {
    // At a gate the fact says it.
    case 'no_portal':
    case 'drafts_only':
      return null
    case 'scans_only':
      return SCANS_SECTION_LINE
    case 'goal':
      return card.goal.measure === 'qualified_scans'
        ? SCANS_SECTION_LINE
        : RATINGS_SECTION_LINE
    default:
      return RATINGS_SECTION_LINE
  }
}

export type PortalGoalGateAction =
  | Readonly<{ kind: 'open_portal'; portalId: string; label: string }>
  | Readonly<{ kind: 'open_portals'; label: string }>
  | Readonly<{ kind: 'create_portal'; label: string }>

/** The way to the Property's Portals (G-6, G-19). */
const OPEN_PORTALS: PortalGoalGateAction = { kind: 'open_portals', label: 'Open portals' }

/** G-5 and G-6: the gate, as a fact, and the one way on. */
export function gateWords(
  card: Extract<PortalGoalCardView, { state: 'no_portal' | 'drafts_only' }>,
  canCreatePortal: boolean,
): Readonly<{
  fact: string
  drafts: string | null
  action: PortalGoalGateAction | null
}> {
  const fact =
    'Counts the private ratings your portals bring in each month. It starts once a portal is live.'
  if (card.state === 'no_portal') {
    return {
      fact,
      drafts: null,
      action: canCreatePortal
        ? { kind: 'create_portal', label: 'Create a portal' }
        : null,
    }
  }
  const [only, ...others] = card.drafts
  if (only !== undefined && others.length === 0) {
    return {
      fact,
      drafts: `You have 1 draft portal: ${only.name}.`,
      action: {
        kind: 'open_portal',
        portalId: only.portalId,
        label: `Open ${only.name}`,
      },
    }
  }
  const names = listOfNames(card.drafts.map(({ name }) => name))
  return {
    fact,
    drafts: `You have ${card.drafts.length} draft portals: ${names}.`,
    action: OPEN_PORTALS,
  }
}

/** G-7: the first weeks' heading. */
export const GETTING_READY_WORDS = 'Getting your portals ready'

/** G-8 and G-10: a Portal's three steps, and the hint once its code has gone unscanned. */
export function readinessWords(row: PortalReadinessRow): Readonly<{
  steps: readonly Readonly<{ label: string; done: boolean }>[]
  hint: Readonly<{ text: string; open: string }> | null
}> {
  return {
    steps: [
      { label: 'Live', done: row.live },
      { label: 'Code made', done: row.codeMade },
      { label: 'First scan', done: row.firstScan },
    ],
    hint:
      row.noScanSinceCodeDays === null
        ? null
        : {
            text: `No scan in the ${row.noScanSinceCodeDays} days since its code was made. ${PORTAL_NO_SCAN_HINT}`,
            open: `Open ${row.name}`,
          },
  }
}

/** "8 private ratings", or "private ratings can’t be read right now". */
function soFarPart(measure: PortalGoalMeasure, count: number | null): string {
  if (count === null) return `${UNITS[measure][1]} can’t be read right now`
  return `${formatNumber(count)} ${portalGoalUnit(measure, count)}`
}

/** G-9: "So far in October: 8 private ratings · 47 scans". */
export function soFarWords(month: string, soFar: PortalGoalSoFar): string {
  return `So far in ${monthName(month)}: ${soFarPart('portal_rating_count', soFar.ratings)} · ${soFarPart('qualified_scans', soFar.scans)}`
}

/** G-11: when the recommended number is ready. */
export function readyOnWords(readyOn: string | null): string {
  return readyOn === null
    ? 'Your recommended number is ready 2 weeks after a portal goes live.'
    : `Your recommended number is ready on ${dayWords(readyOn)}, after 2 weeks live.`
}

/**
 * G-12: the way into the set sheet with a number of the manager's own, before
 * one is recommended: in the first weeks and while the recommendation cannot
 * be read, "Set my own number"; when nothing came in, "Set a number anyway".
 */
export function ownNumberDoorWords(
  state: 'getting_ready' | 'nothing_counted' | 'recommendation_unreadable',
): string {
  return state === 'nothing_counted' ? 'Set a number anyway' : 'Set my own number'
}

/** G-19: nothing came in over the basis, and the way to the codes. */
export function nothingCountedWords(weeks: number): Readonly<{
  text: string
  action: PortalGoalGateAction
}> {
  return {
    text: `No scans in the last ${weeks} weeks. Check that each code is where guests can see it.`,
    action: OPEN_PORTALS,
  }
}

/** G-19: the recommendation could not be read. */
export const RECOMMENDATION_UNREADABLE_WORDS =
  'Your recommended number can’t be read right now.'

/** "November · 40 private ratings": a month and the number it counts against. */
export const monthNumberWords = (
  measure: PortalGoalMeasure,
  month: string,
  target: number,
): string => `${monthName(month)} · ${portalGoalCount(measure, target)}`

/**
 * G-20: a goal with no month running, on its card. Scheduled: the first month
 * and its number, the day it starts and this month so far. Paused, or stopped
 * with no month counting now: the month it still counts and its number. A
 * running month is `runningWords`'.
 */
export function goalLines(goal: PortalGoalOfCard, today: string): readonly string[] {
  if (goal.status === 'scheduled' && goal.startsOn !== null) {
    const soFar =
      goal.currentMonthSoFar === null
        ? ''
        : ` · ${monthName(today.slice(0, 7))} so far: ${formatNumber(goal.currentMonthSoFar)}`
    return [
      monthNumberWords(goal.measure, goal.startsOn.slice(0, 7), goal.target),
      `Starts on ${dayWords(goal.startsOn)}${soFar}`,
    ]
  }
  // A paused or stopped goal names the month it still counts; else today's.
  const counting = goal.countingMonth ?? { key: today.slice(0, 7), target: goal.target }
  return [monthNumberWords(goal.measure, counting.key, counting.target)]
}
