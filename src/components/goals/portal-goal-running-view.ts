// The running Monthly portal goal's words (copy deck G-21…G-27, G-29…G-32,
// ADR 0068 amended 2026-10-19): the headline that says what is left to the
// month's number, the days left in the month, the meter's caption, figure and
// foot, the bar's tick and what a screen reader hears for it, what each Portal
// brought in, a stop, and the month before. The read decides every state, day
// and number (PLAN E12): the pace (P-6 included), the first quiet days, whether
// the counts add up, and what each month counts (its own version's measure, not
// the goal's latest). This only says them, in one place, so the card, its
// stories and its tests spell each line once. The pace is not said in a word
// here: the pill says it (`portal-goal-status-view.ts`). Pure.
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type {
  PortalGoalLastMonth,
  PortalGoalOfCard,
  PortalGoalRows,
  PortalGoalRunningMonth,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { formatNumber } from '#/lib/format'
import { daysLeftWords } from './goal-live-view'
import {
  dayWords,
  monthName,
  monthNumberWords,
  monthSoFarHeading,
  portalGoalUnit,
} from './portal-goal-words'

/** The bar under the figure, with the words a screen reader hears for it. */
export type PortalGoalBarWords = Readonly<{
  value: number
  max: number
  /** Where a steady month would be today, as a share of the bar; null for none. */
  tick: number | null
  label: string
  valueText: string
}>

/** What the card and the page lead with: what is left, or that the number is passed. */
export type PortalGoalHeadlineWords =
  | Readonly<{
      kind: 'left'
      /** "17" */
      count: string
      /** "private ratings to" */
      words: string
      /** "40" */
      target: string
    }>
  | Readonly<{ kind: 'passed'; text: string }>

export type PortalGoalRunningWords =
  | Readonly<{
      kind: 'figure'
      /** "23 of 40" */
      figure: string
      /** "17 to go · 9 days left", or "Goal passed · 4 days left". The detail page's first tile reads it. */
      line: string
      passed: boolean
      /** U-C2, U-C3: "17 private ratings to 40", or "Goal passed: 43 private ratings". */
      headline: PortalGoalHeadlineWords
      /** U-C4: "9 days left in November", or "Last day of November". */
      daysLine: string
      /** U-C5: "November so far", the meter's caption. */
      caption: string
      /** U-C7: "It’s Nov 22", the meter's foot. */
      foot: string
      bar: PortalGoalBarWords
    }>
  | Readonly<{
      kind: 'unreadable'
      /** "November · 45 private ratings": the month and its number, with no figure. */
      heading: string
      line: string
    }>

/** G-25: a month whose figure cannot be read, never a zero. */
export const MONTH_FIGURE_UNREADABLE = 'This month’s figure can’t be read right now.'

/** G-32: "Private ratings in November", "Scans in November". */
function barLabel(measure: PortalGoalMeasure, monthKey: string): string {
  const unit = portalGoalUnit(measure, 2)
  return `${unit.charAt(0).toUpperCase()}${unit.slice(1)} in ${monthName(monthKey)}`
}

/**
 * U-C4: how long the month has to run, in its own name. "last day" is what
 * `daysLeftWords` calls the day with nothing after it.
 */
function daysLine(month: PortalGoalRunningMonth): string {
  const name = monthName(month.key)
  return month.daysAfterToday < 1
    ? `Last day of ${name}`
    : `${daysLeftWords(month.daysAfterToday)} in ${name}`
}

/** U-C7: today's date, from the month's key and the days that have begun. */
function todayFoot(month: PortalGoalRunningMonth): string {
  const day = String(month.elapsedDays).padStart(2, '0')
  return `It’s ${dayWords(`${month.key}-${day}`)}`
}

/**
 * U-C2 and U-C3: what is left to the number, in the unit of what is left
 * ("1 private rating to 40"), or that the number is passed ("Goal passed: 43
 * private ratings").
 */
function headlineWords(
  measure: PortalGoalMeasure,
  value: number,
  target: number,
): PortalGoalHeadlineWords {
  if (value >= target) {
    return {
      kind: 'passed',
      text: `Goal passed: ${formatNumber(value)} ${portalGoalUnit(measure, value)}`,
    }
  }
  const left = target - value
  return {
    kind: 'left',
    count: formatNumber(left),
    words: `${portalGoalUnit(measure, left)} to`,
    target: formatNumber(target),
  }
}

/**
 * G-21…G-25 and G-32: the month so far, in the measure it counts. The tick
 * marks where a steady month would be today; it is not drawn in the first
 * quiet days, once the goal has passed, or with no figure. A figure that cannot
 * be read says so and is never a zero. The bar's sentence leaves the pace word
 * to the pill (Q-5).
 */
export function runningWords(month: PortalGoalRunningMonth): PortalGoalRunningWords {
  const { value, target, measure } = month
  if (value === null) {
    return {
      kind: 'unreadable',
      heading: monthNumberWords(measure, month.key, target),
      line: MONTH_FIGURE_UNREADABLE,
    }
  }
  const figure = `${formatNumber(value)} of ${formatNumber(target)}`
  const unit = portalGoalUnit(measure, target)
  const left = daysLeftWords(month.daysAfterToday)
  const passed = value >= target
  return {
    kind: 'figure',
    figure,
    line: passed
      ? `Goal passed · ${left}`
      : `${formatNumber(target - value)} to go · ${left}`,
    passed,
    headline: headlineWords(measure, value, target),
    daysLine: daysLine(month),
    caption: monthSoFarHeading(month.key),
    foot: todayFoot(month),
    bar: {
      value,
      max: target,
      tick: passed || month.quietDays ? null : month.elapsedDays / month.totalDays,
      label: barLabel(measure, month.key),
      valueText: [`${figure} ${unit}`, passed ? 'goal passed' : null, left]
        .filter((part): part is string => part !== null)
        .join(', '),
    },
  }
}

export type PortalGoalCountRow = Readonly<{ key: string; name: string; count: string }>

export type PortalGoalCountsWords =
  | Readonly<{
      kind: 'rows'
      /** G-26 */
      heading: string
      /** Each published Portal in the read's name order, then "Other portals". */
      rows: readonly PortalGoalCountRow[]
    }>
  | Readonly<{
      kind: 'sentence'
      text: string
      /** "See each", to every Portal's count on the goal's page; null when all are named. */
      seeEach: string | null
    }>

/**
 * G-26 and G-27: what each Portal brought in, plain counts in the read's name
 * order (P-1), never sorted and with no bars; "Other portals" only when
 * something came from them. One Portal that brought in all of it is named, and
 * from 5 Portals the card says how many, with "See each" to the goal's page.
 */
export function portalCountsWords(rows: PortalGoalRows): PortalGoalCountsWords {
  if (rows.kind === 'one') {
    return { kind: 'sentence', text: `All from ${rows.name}.`, seeEach: null }
  }
  if (rows.kind === 'many') {
    return {
      kind: 'sentence',
      text: `From ${formatNumber(rows.count)} portals`,
      seeEach: 'See each',
    }
  }
  const listed: PortalGoalCountRow[] = rows.portals.map(({ portalId, name, count }) => ({
    key: portalId,
    name,
    count: formatNumber(count),
  }))
  return {
    kind: 'rows',
    heading: 'From your portals',
    rows:
      rows.elsewhere > 0
        ? [
            ...listed,
            {
              key: 'elsewhere',
              name: 'Other portals',
              count: formatNumber(rows.elsewhere),
            },
          ]
        : listed,
  }
}

/**
 * O-2: each Portal's count in one line, in the read's name order, with "Other
 * portals" when something came from them: what a card too narrow for the list
 * says instead. One Portal that brought in all of it, or from 5 Portals how
 * many, is the card's own sentence (G-27): null here.
 */
export function countsLine(rows: PortalGoalRows): string | null {
  const words = portalCountsWords(rows)
  if (words.kind === 'sentence') return null
  return words.rows.map(({ name, count }) => `${name} ${count}`).join(' · ')
}

/** G-29: a stopped goal still counts to the end of its month. */
export function stoppedWords(
  stopped: NonNullable<PortalGoalOfCard['stopped']>,
  monthKey: string,
): string {
  const when = stopped.on === null ? 'Stopped.' : `Stopped on ${dayWords(stopped.on)}.`
  return `${when} ${monthName(monthKey)} still counts to ${dayWords(stopped.monthEnd)}.`
}

/** What the last readings are called while a month is read: "ratings", "scans". */
const LAST_READINGS: Readonly<Record<PortalGoalMeasure, string>> = {
  portal_rating_count: 'ratings',
  qualified_scans: 'scans',
}

/**
 * G-30 and G-31: the month before, in what it counted, while its last readings
 * are counted (with the day its final figure is due, until that day has gone),
 * then met (with a check) or not met (neutral, never red). A month with no
 * usable result says nothing here.
 */
export function lastMonthWords(
  lastMonth: PortalGoalLastMonth,
): Readonly<{ text: string; met: boolean }> | null {
  const name = monthName(lastMonth.key)
  if (lastMonth.outcome === 'updating') {
    const counting = `${name}: counting the last ${LAST_READINGS[lastMonth.measure]}.`
    return {
      text:
        lastMonth.finalOn === null
          ? counting
          : `${counting} Final figure on ${dayWords(lastMonth.finalOn)}.`,
      met: false,
    }
  }
  if (lastMonth.outcome === 'unavailable' || lastMonth.value === null) return null
  const result = `${formatNumber(lastMonth.value)} of ${formatNumber(lastMonth.target)}`
  return lastMonth.outcome === 'met'
    ? { text: `${name} met: ${result}`, met: true }
    : { text: `${name}: ${result} · not met`, met: false }
}
