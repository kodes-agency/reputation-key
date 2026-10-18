// The running Monthly portal goal's words (copy deck G-21…G-27, G-29…G-32):
// the month's figure against its number, what is left to go with the days
// left, the pace word, the bar's tick and what a screen reader hears for it,
// what each Portal brought in, a stop, and the month before. The read decides
// every state, day and number (PLAN E12): the pace (P-6 included), the first
// quiet days, whether the counts add up, and what each month counts (its own
// version's measure, not the goal's latest). This only says them, in one place,
// so the card, its stories and its tests spell each line once. "below pace" is
// the one judgement, in quiet amber, and never "on pace". Pure.
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

export type PortalGoalRunningWords =
  | Readonly<{
      kind: 'figure'
      /** "23 of 40" */
      figure: string
      /** "private ratings", by the month's number: "0 of 1 private rating". */
      unit: string
      /** "17 to go · 9 days left", or "Goal passed · 4 days left". */
      line: string
      /** "below pace", in quiet amber; null when it is not behind or not judged. */
      pace: string | null
      passed: boolean
      bar: PortalGoalBarWords
    }>
  | Readonly<{
      kind: 'unreadable'
      /** "November · 45 private ratings": the month and its number, with no figure. */
      heading: string
      line: string
    }>

const BELOW_PACE = 'below pace'

/** G-32: "Private ratings in November", "Scans in November". */
function barLabel(measure: PortalGoalMeasure, monthKey: string): string {
  const unit = portalGoalUnit(measure, 2)
  return `${unit.charAt(0).toUpperCase()}${unit.slice(1)} in ${monthName(monthKey)}`
}

/**
 * G-21…G-25 and G-32: the month so far, in the measure it counts. The tick
 * marks where a steady month would be today; it is not drawn in the first
 * quiet days, once the goal has passed, or with no figure. A figure that cannot
 * be read says so and is never a zero.
 */
export function runningWords(month: PortalGoalRunningMonth): PortalGoalRunningWords {
  const { value, target, measure } = month
  if (value === null) {
    return {
      kind: 'unreadable',
      heading: monthNumberWords(measure, month.key, target),
      line: 'This month’s figure can’t be read right now.',
    }
  }
  const figure = `${formatNumber(value)} of ${formatNumber(target)}`
  const unit = portalGoalUnit(measure, target)
  const left = daysLeftWords(month.daysAfterToday)
  const passed = value >= target
  const pace = month.belowPace === true ? BELOW_PACE : null
  const progress = passed ? 'goal passed' : null
  return {
    kind: 'figure',
    figure,
    unit,
    line: passed
      ? `Goal passed · ${left}`
      : `${formatNumber(target - value)} to go · ${left}`,
    pace,
    passed,
    bar: {
      value,
      max: target,
      tick: passed || month.quietDays ? null : month.elapsedDays / month.totalDays,
      label: barLabel(measure, month.key),
      valueText: [`${figure} ${unit}`, progress, left, pace]
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
