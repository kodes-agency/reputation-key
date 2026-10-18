// The Monthly portal goal page's words (copy deck P-2, P-4…P-9, P-13…P-15): the
// line under the title, the tiles, what each Portal brought in and the quiet
// ones, the month strip and each month's popover, and how the goal counts. The
// read decides every state, day and number (PLAN E12); this only says them, in
// one place, so the page, its stories and its tests spell each line once. The
// running month itself is `portal-goal-running-view.ts`', and what changed is
// `portal-goal-changes-view.ts`'. Pure.
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type { GoalSubject } from '#/contexts/reporting/application/public-api'
import type {
  PortalGoalPageMonth,
  PortalGoalPageRows,
  PortalGoalPageTiles,
  PortalGoalQuietFact,
} from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import type { PortalGoalOfCard } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { formatNumber } from '#/lib/format'
import { goalFigure } from './goal-so-far'
import { runningWords } from './portal-goal-running-view'
import {
  dayWords,
  monthName,
  portalGoalCount,
  portalGoalUnit,
  timeZoneCity,
} from './portal-goal-words'

/** "Private ratings", "Scans": a measure's unit at the start of a sentence. */
function unitTitle(measure: PortalGoalMeasure): string {
  const unit = portalGoalUnit(measure, 2)
  return `${unit.charAt(0).toUpperCase()}${unit.slice(1)}`
}

/**
 * P-2: what the goal counts, from where, under the page's title: "Private
 * ratings from all 3 portals at Seaview Hotel."
 */
export function pageBodyLine(
  measure: PortalGoalMeasure,
  portals: readonly string[],
  propertyName: string,
): string {
  const [only] = portals
  const from =
    portals.length > 1
      ? `all ${formatNumber(portals.length)} portals`
      : (only ?? 'your portals')
  return `${unitTitle(measure)} from ${from} at ${propertyName}.`
}

export type PortalGoalTileWords = Readonly<{
  key: string
  label: string
  /** The figure; null prints the detail alone. */
  value: string | null
  detail: string | null
}>

/** The month the goal counts now, as the first tile says it. */
function thisMonthTile(goal: PortalGoalOfCard, today: string): PortalGoalTileWords {
  if (goal.month !== null) {
    const words = runningWords(goal.month)
    const label = monthName(goal.month.key)
    return words.kind === 'unreadable'
      ? { key: 'this', label, value: null, detail: words.line }
      : { key: 'this', label, value: words.figure, detail: words.line }
  }
  if (goal.status === 'scheduled' && goal.startsOn !== null) {
    return {
      key: 'this',
      label: monthName(goal.startsOn.slice(0, 7)),
      value: portalGoalCount(goal.measure, goal.target),
      detail: `Starts on ${dayWords(goal.startsOn)}`,
    }
  }
  const counting = goal.countingMonth ?? {
    key: today.slice(0, 7),
    measure: goal.measure,
    target: goal.target,
  }
  return {
    key: 'this',
    label: monthName(counting.key),
    value: portalGoalCount(counting.measure, counting.target),
    detail: null,
  }
}

/** What a month's result is called after its figure. */
const OUTCOME_WORDS: Readonly<Record<PortalGoalPageMonth['outcome'], string>> = {
  running: 'running',
  updating: 'being checked',
  met: 'met',
  not_met: 'not met',
  unavailable: 'no usable result',
}

/** P-4: the month counting, the month before, and the usual. */
export function portalGoalTiles(
  goal: PortalGoalOfCard,
  tiles: PortalGoalPageTiles,
  today: string,
): readonly PortalGoalTileWords[] {
  const { lastMonth, usual } = tiles
  const before: PortalGoalTileWords =
    lastMonth.outcome === 'no_goal'
      ? {
          key: 'last',
          label: monthName(lastMonth.key),
          value: 'No goal yet',
          detail: null,
        }
      : {
          key: 'last',
          label: monthName(lastMonth.key),
          value:
            lastMonth.value === null
              ? null
              : `${formatNumber(lastMonth.value)} of ${formatNumber(lastMonth.target)}`,
          detail: OUTCOME_WORDS[lastMonth.outcome],
        }
  return [
    thisMonthTile(goal, today),
    before,
    ...(usual === null
      ? []
      : [
          {
            key: 'usual',
            label: 'Your usual',
            value: `About ${formatNumber(usual.about)} a month`,
            detail: `last ${usual.weeks} weeks`,
          },
        ]),
  ]
}

/** P-5: the month's first and last day under its bar. */
export function monthAxis(
  month: Readonly<{ key: string; totalDays: number }>,
): Readonly<{ from: string; to: string }> {
  return {
    from: dayWords(`${month.key}-01`),
    to: dayWords(`${month.key}-${String(month.totalDays).padStart(2, '0')}`),
  }
}

/** P-5: "November so far". */
export const monthSoFarHeading = (monthKey: string): string =>
  `${monthName(monthKey)} so far`

export type PortalGoalQuietWords = Readonly<{
  portalId: string
  text: string
  open: string
}>

/** P-6 and P-7: each Portal's count, what the rest brought in, the total and the quiet ones. */
export function fromPortalsWords(
  rows: PortalGoalPageRows | null,
  facts: Readonly<Record<string, PortalGoalQuietFact>>,
  portals: readonly Readonly<{ portalId: string; name: string }>[],
): Readonly<{
  rows: readonly Readonly<{ key: string; name: string; count: string }>[] | null
  total: string | null
  truncated: string | null
  quiet: readonly PortalGoalQuietWords[]
}> {
  const quiet = portals.flatMap(({ portalId, name }) => {
    const fact = facts[portalId]
    return fact === undefined
      ? []
      : [
          {
            portalId,
            text: `${name}: no scans since ${dayWords(fact.noScansSince)}. It usually gets about ${formatNumber(fact.usualPerWeek)} a week.`,
            open: `Open ${name}`,
          },
        ]
  })
  if (rows === null) return { rows: null, total: null, truncated: null, quiet }
  const listed = rows.portals.map(({ portalId, name, count }) => ({
    key: portalId,
    name,
    count: formatNumber(count),
  }))
  return {
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
    total: formatNumber(rows.total),
    truncated: rows.truncated ? 'Showing the first 100 portals by name.' : null,
    quiet,
  }
}

/** " 2025" after a month outside this year; nothing in this year. */
const yearAfter = (key: string, today: string): string =>
  key.slice(0, 4) === today.slice(0, 4) ? '' : ` ${key.slice(0, 4)}`

export type PortalGoalStripChip = Readonly<{
  key: string
  /** "Nov 36/40" */
  text: string
  /** "running" or "being checked" after the figure; null once closed. */
  suffix: string | null
  /** The chip's name: "November: 36 of 40 private ratings, not met". */
  label: string
  met: boolean
  /** Still counting or being read: a dashed chip. */
  open: boolean
  /** The month and its popover's lines. */
  title: string
  lines: readonly string[]
}>

/** A month's figure or number: a count grouped, the average to a tenth ("4.6"). */
const figureOf = (month: PortalGoalPageMonth, value: number): string =>
  goalFigure(month.measure, value)

/** A figure against the month's number: "36 of 40", the average's "4.6 · goal 4.5". */
function againstWords(month: PortalGoalPageMonth, value: number): string {
  return month.measure === 'portal_rating_average'
    ? `${figureOf(month, value)} · goal ${figureOf(month, month.target)}`
    : `${formatNumber(value)} of ${formatNumber(month.target)}`
}

/**
 * "36 of 40 private ratings", or "40 private ratings" with no figure; the
 * average's "4.6 · goal 4.5", or "goal 4.5".
 */
function monthFigure(month: PortalGoalPageMonth): string {
  const { measure, value, target } = month
  if (measure === 'portal_rating_average') {
    return value === null ? `goal ${figureOf(month, target)}` : againstWords(month, value)
  }
  return value === null
    ? portalGoalCount(measure, target)
    : `${againstWords(month, value)} ${portalGoalUnit(measure, target)}`
}

/** P-9: the correction, and what the month is now. */
function correctionWords(month: PortalGoalPageMonth): string | null {
  const { correction } = month
  if (correction === null) return null
  const on = `Corrected on ${dayWords(correction.on)}`
  if (correction.outcome === 'unavailable' || correction.value === null) {
    return `${on}: no usable result.`
  }
  const now = correction.outcome === 'met' ? 'now met' : 'now not met'
  return `${on}: ${againstWords(month, correction.value)}, ${now}.`
}

/**
 * P-8 and P-9: each month as a chip, newest first, met with a check, not met
 * neutral, still counting or read dashed; its popover the figure and result,
 * the day its figure is final, its own number, and any correction.
 */
export function stripChips(
  months: readonly PortalGoalPageMonth[],
  today: string,
): readonly PortalGoalStripChip[] {
  return months.map((month) => {
    const name = monthName(month.key)
    const year = yearAfter(month.key, today)
    const title = `${name}${year}`
    const outcome = OUTCOME_WORDS[month.outcome]
    const open = month.outcome === 'running' || month.outcome === 'updating'
    const figure = month.value === null ? '–' : figureOf(month, month.value)
    return {
      key: month.key,
      text: `${name.slice(0, 3)}${year} ${figure}/${figureOf(month, month.target)}`,
      suffix: open ? outcome : null,
      label: `${title}: ${monthFigure(month)}, ${outcome}`,
      met: month.outcome === 'met',
      open,
      title,
      lines: [
        `${monthFigure(month)} · ${outcome}`,
        ...(month.finalOn === null ? [] : [`Final on ${dayWords(month.finalOn)}`]),
        `Number in ${name}: ${figureOf(month, month.target)}`,
        ...[correctionWords(month)].filter((line): line is string => line !== null),
      ],
    }
  })
}

/**
 * P-13 and P-14: how the goal counts, in what it counts now; the ratings
 * where it counts them: any of the Property's portals, or a goal's own Portal
 * or group (PLAN PG-21: "at Reception").
 */
export function howItCountsWords(
  measure: PortalGoalMeasure,
  timezone: string,
  where = 'any of your portals',
): string {
  const months = `Months follow ${timeZoneCity(timezone)} time, from the 1st to the last day. A month’s result arrives about a day after it ends.`
  return measure === 'qualified_scans'
    ? `Counts guests who open a portal from its code. The same visit counts once per portal in any 24 hours. Bots don’t count. ${months}`
    : `Counts the 1–5 star private ratings guests give at ${where}. Low and high ratings count the same. ${months} If a guest corrects or withdraws a rating, the month updates.`
}

/**
 * An other Portal goal's subject by name, from the names the read gave: the
 * Property, a Portal or a Portal Group (as the Goals list names them).
 */
export function extrasSubjectName(
  subject: GoalSubject,
  propertyName: string,
  names: Readonly<Record<string, string>>,
): string {
  switch (subject.kind) {
    case 'property':
      return propertyName
    case 'portal':
      return names[`portal:${subject.portalId}`] ?? 'Portal'
    case 'portal_group':
      return names[`portal_group:${subject.portalGroupId}`] ?? 'Group'
  }
}

/** P-13: the disclosure's title. */
export const HOW_IT_COUNTS_TITLE = 'How this goal counts'
