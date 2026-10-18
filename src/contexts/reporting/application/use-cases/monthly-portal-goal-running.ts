// Reporting — the Monthly portal goal on its card once there is one (ADR 0068,
// PLAN PG-12).
//
// While it waits for its first month: the day it starts and this month so far.
// While it runs: the month it is counting, with the governed figure
// (`progressOf`) against that month's own number, its days, and whether it is
// behind pace (`goalPace`, P-6 included). A goal that was stopped still counts
// to the end of the month it was stopped in, so that month is read the same way
// (`readSubjectMonth`) and the card says when it was stopped. With a month, each
// published Portal's count of it, from the recommendation's one set read, but
// only when those counts and what the other Portals bring in add up to the
// governed figure: a race or a pending fact draws no rows rather than rows that
// disagree with the headline. And the month before, while its result is being
// read (with its governed figure so far) and, once closed, through the 7th.
// Each month is worded in the measure of the version it opened under: a change
// from a coming month ("Count scans instead") leaves the month already counting
// as it was. Everything here is decided by the server; the card only words it.
import { GOAL_RECONCILIATION_DELAY_MS } from '#/shared/domain/metric-governance'
import { calendarPeriodRange } from '#/shared/domain/period-range'
import { goalMonthDays, goalPace } from '../../domain/goal-pace'
import type { PortalGoalMeasure } from '../../domain/goal-recommendation-types'
import { addLocalDays, localDateOf } from '../../domain/local-days'
import type { PortalGoalRecommendation } from '../dto/goal-recommendation.types'
import type {
  PortalGoalLastMonth,
  PortalGoalOfCard,
  PortalGoalPortalCount,
  PortalGoalRows,
  PortalGoalRunningMonth,
} from '../dto/monthly-portal-goal.types'
import { effectiveMonthTarget } from '../goal-effective-month-target'
import {
  isPortalGoalMeasure,
  type PropertyCountGoal,
} from '../monthly-portal-goal-identity'
import type {
  GoalMonthlyResult,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../ports/goal-program.repository'
import type { GoalActor, GoalMetricReadPort } from './goal-programs'
import { progressOf, readSubjectMonth } from './goal-progress'
import { changeFactsOf, newGoalFromOf } from './monthly-portal-goal-change-facts'

export type MonthlyPortalGoalOnCardDeps = Readonly<{
  /** The governed read of a month so far. */
  metrics: Pick<GoalMetricReadPort, 'queryGoalMetric'>
}>

export type MonthlyPortalGoalOnCardContext = Readonly<{
  recommendation: PortalGoalRecommendation
  now: Date
  actor: GoalActor
}>

type Period = Readonly<{ start: Date; end: Date }>

/** From this many published Portals the card says how many, not each one. */
const MANY_PORTALS = 5
/** The month before is shown, once closed, through this local day of the month. */
const LAST_MONTH_SHOWN_THROUGH_DAY = 7
/** A closed month's final figure is due this long after its reconciliation window. */
const FINAL_FIGURE_MARGIN_MS = 60 * 60 * 1_000

const propertySubject = (bundle: PropertyCountGoal) =>
  ({ kind: 'property', propertyId: bundle.program.propertyId }) as const

export const versionOf = (
  bundle: PropertyCountGoal,
  versionId: string,
): GoalProgramVersion =>
  bundle.versions.find(({ id }) => id === versionId) ?? bundle.version

/**
 * What a month counts, from the version it opened under; null for a version
 * that is not a count (an average a Property goal was changed from).
 */
export const measureOf = (version: GoalProgramVersion): PortalGoalMeasure | null =>
  isPortalGoalMeasure(version.metric) ? version.metric : null

/** `YYYY-MM` of the local month a period begins. */
export const monthKeyOf = (instant: Date, timezone: string): string =>
  localDateOf(instant, timezone).slice(0, 7)

/** The month's days and pace, as the server judges them, for the card to word. */
function runningMonth(
  measure: PortalGoalMeasure,
  month: Readonly<{ period: Period; timezone: string; target: number }>,
  value: number | null,
  now: Date,
): PortalGoalRunningMonth {
  const { period, timezone, target } = month
  const days = goalMonthDays(period, now, timezone)
  // The day-based states (the first days, too few expected) do not depend on
  // the figure, so a month with none still says whether it is in its first days.
  const { state } = goalPace({
    metric: measure,
    value: value ?? 0,
    target,
    period,
    now,
    timezone,
  })
  const judged = value !== null && (state === 'behind' || state === 'on_pace')
  return {
    key: monthKeyOf(period.start, timezone),
    measure,
    target,
    value,
    elapsedDays: days.elapsedDays,
    totalDays: days.totalDays,
    daysAfterToday: days.daysLeft,
    belowPace: judged ? state === 'behind' : null,
    quietDays: state === 'too_early',
  }
}

/**
 * Each published Portal's count of the running month, in name order, in the
 * month's own measure, with what the rest brought in (draft, disabled,
 * archived and deleted Portals and readings with no Portal) and the governed
 * figure they make up: only when they add up to it. A month the set read
 * cannot read whole, or not this month, has none. The card and the goal's page
 * both draw these.
 */
export function monthCountsOf(
  recommendation: PortalGoalRecommendation,
  month: PortalGoalRunningMonth,
): Readonly<{
  portals: readonly PortalGoalPortalCount[]
  elsewhere: number
  total: number
}> | null {
  const { measure, value } = month
  if (
    value === null ||
    recommendation.monthToDate[measure] === null ||
    month.key !== recommendation.months.current.key
  ) {
    return null
  }
  const portals = recommendation.portals
    .filter(({ publicationState }) => publicationState === 'published')
    .map(({ portalId, name, monthToDate }) => ({
      portalId,
      name,
      count: monthToDate[measure],
    }))
  const elsewhere = recommendation.elsewhere[measure]
  const listed = portals.reduce((sum, { count }) => sum + count, 0)
  return listed + elsewhere === value ? { portals, elsewhere, total: value } : null
}

/**
 * The card's counts of the running month (`monthCountsOf`). One Portal that
 * brought in all of it is named, but not while the month has nothing in: 0 is
 * no Portal's doing, so it is a row. From 5 Portals the card says how many. A
 * list cut at 100 Portals, or no published Portal, draws none.
 */
function rowsOf(
  recommendation: PortalGoalRecommendation,
  month: PortalGoalRunningMonth,
): PortalGoalRows | null {
  const counts = recommendation.truncated ? null : monthCountsOf(recommendation, month)
  if (counts === null || counts.portals.length === 0) return null
  const { portals, elsewhere, total } = counts
  if (portals.length >= MANY_PORTALS) return { kind: 'many', count: portals.length }
  const [only] = portals
  if (only && portals.length === 1 && elsewhere === 0 && total > 0) {
    return { kind: 'one', name: only.name }
  }
  return { kind: 'rows', portals, elsewhere }
}

/**
 * A paused or stopped goal's month: the latest of its months still open or
 * being read, with that month's own target. On Dec 1 and 2 a goal stopped in
 * November still counts November, whatever today's month is.
 */
function countingMonthOf(bundle: PropertyCountGoal): PortalGoalOfCard['countingMonth'] {
  const [latest] = bundle.results
    .filter(({ status }) => status === 'open' || status === 'reconciling')
    .sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime())
  if (!latest) return null
  const version = versionOf(bundle, latest.programVersionId)
  const measure = measureOf(version)
  if (measure === null) return null
  return {
    key: monthKeyOf(latest.periodStart, latest.propertyTimezone),
    measure,
    target: effectiveMonthTarget(latest, version),
  }
}

/** The stopped goal's subject window that holds now, when one still does. */
const windowAt = (bundle: PropertyCountGoal, now: Date): GoalSubjectAssignment | null =>
  bundle.assignments.find(
    ({ effectiveFrom, effectiveTo }) =>
      effectiveFrom <= now && (effectiveTo === null || effectiveTo > now),
  ) ?? null

/**
 * A stopped goal's stop, while its month still counts: the local day it was
 * stopped (none for an end before migration 0062 recorded one) and the
 * month's last day.
 */
function stopOf(
  bundle: PropertyCountGoal,
  period: Period,
  timezone: string,
): PortalGoalOfCard['stopped'] {
  const { status, endedAt } = bundle.program
  if (status !== 'ended') return null
  return {
    on: endedAt ? localDateOf(endedAt, timezone) : null,
    monthEnd: localDateOf(new Date(period.end.getTime() - 1), timezone),
  }
}

/**
 * A stopped goal's month while it still counts: its window holds now, so this
 * month is read the governed way, against its own number.
 */
async function stoppedMonthOf(
  deps: MonthlyPortalGoalOnCardDeps,
  bundle: PropertyCountGoal,
  context: MonthlyPortalGoalOnCardContext,
): Promise<Readonly<{ month: PortalGoalRunningMonth; period: Period }> | null> {
  const { now, actor } = context
  const assignment = windowAt(bundle, now)
  if (!assignment) return null
  const version = versionOf(bundle, assignment.programVersionId)
  const measure = measureOf(version)
  if (measure === null) return null
  const timezone = version.propertyTimezone
  const period = calendarPeriodRange(now, timezone, 'monthly')
  const result = bundle.results.find(
    ({ assignmentId, periodStart }) =>
      assignmentId === assignment.id && periodStart.getTime() === period.start.getTime(),
  )
  const target = result ? effectiveMonthTarget(result, version) : version.targetValue
  const reading = await readSubjectMonth(
    deps,
    version,
    propertySubject(bundle),
    period,
    actor,
  )
  const value = reading.kind === 'live' ? reading.value : null
  return {
    month: runningMonth(measure, { period, timezone, target }, value, now),
    period,
  }
}

/** The local day a month's final figure is due: a day and an hour after it ends. */
export function finalFigureOn(
  result: Pick<GoalMonthlyResult, 'periodEnd' | 'propertyTimezone'>,
): string {
  const finalAt = new Date(
    result.periodEnd.getTime() + GOAL_RECONCILIATION_DELAY_MS + FINAL_FIGURE_MARGIN_MS,
  )
  return localDateOf(finalAt, result.propertyTimezone)
}

/** How a closed month came out: met or not, or no usable result. */
export function outcomeOf(
  result: Pick<GoalMonthlyResult, 'evaluation'>,
): 'met' | 'not_met' | 'unavailable' {
  const { evaluation } = result
  if (evaluation.state !== 'eligible') return 'unavailable'
  return evaluation.achieved ? 'met' : 'not_met'
}

/**
 * The month before this one: while its result is read, its governed figure so
 * far; once closed, its result, through the 7th. Its final figure is due a day
 * and an hour after it ends; while it is still read after that day, no day is
 * named.
 */
async function lastMonthOf(
  deps: MonthlyPortalGoalOnCardDeps,
  bundle: PropertyCountGoal,
  context: MonthlyPortalGoalOnCardContext,
): Promise<PortalGoalLastMonth | null> {
  const { recommendation, now, actor } = context
  const today = localDateOf(now, recommendation.timezone)
  const previousKey = addLocalDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)
  const result = bundle.results.find(
    ({ periodStart, propertyTimezone }) =>
      monthKeyOf(periodStart, propertyTimezone) === previousKey,
  )
  if (!result) return null
  const version = versionOf(bundle, result.programVersionId)
  const measure = measureOf(version)
  if (measure === null) return null
  const finalOn = finalFigureOn(result)
  const base = {
    key: previousKey,
    measure,
    target: effectiveMonthTarget(result, version),
    finalOn,
  }
  if (result.status !== 'closed') {
    const reading = await readSubjectMonth(
      deps,
      version,
      propertySubject(bundle),
      { start: result.periodStart, end: result.periodEnd },
      actor,
    )
    return {
      ...base,
      finalOn: finalOn < today ? null : finalOn,
      value: reading.kind === 'live' ? reading.value : null,
      outcome: 'updating',
    }
  }
  if (Number(today.slice(8, 10)) > LAST_MONTH_SHOWN_THROUGH_DAY) return null
  return { ...base, value: result.evaluation.value, outcome: outcomeOf(result) }
}

/** The month the goal is counting now: an active goal's, or a stopped goal's last one. */
async function countingNow(
  deps: MonthlyPortalGoalOnCardDeps,
  bundle: PropertyCountGoal,
  context: MonthlyPortalGoalOnCardContext,
): Promise<Readonly<{ month: PortalGoalRunningMonth; period: Period }> | null> {
  const { now, actor } = context
  if (bundle.program.status === 'ended') return stoppedMonthOf(deps, bundle, context)
  const progress = await progressOf(
    deps,
    bundle,
    propertySubject(bundle),
    'active',
    now,
    actor,
  )
  if (progress === null || !isPortalGoalMeasure(progress.metric)) return null
  const { metric, period, timezone, reading, targetValue } = progress
  const value = reading.kind === 'live' ? reading.value : null
  return {
    month: runningMonth(metric, { period, timezone, target: targetValue }, value, now),
    period,
  }
}

/** The goal as its card shows it. */
export async function monthlyPortalGoalOnCard(
  deps: MonthlyPortalGoalOnCardDeps,
  bundle: PropertyCountGoal,
  context: MonthlyPortalGoalOnCardContext,
): Promise<PortalGoalOfCard> {
  const { program, version } = bundle
  const { recommendation, now } = context
  const measure = version.metric
  const goal = {
    programId: program.id,
    version: version.version,
    measure,
    status: program.status,
    target: version.targetValue,
    startsOn: null,
    month: null,
    rows: null,
    stopped: null,
    lastMonth: null,
    currentMonthSoFar: null,
    countingMonth: null,
    change: changeFactsOf(bundle, now, recommendation.timezone),
    newGoalFrom: null,
  } satisfies PortalGoalOfCard
  if (program.status === 'scheduled') {
    return {
      ...goal,
      startsOn: localDateOf(version.effectiveFrom, version.propertyTimezone),
      currentMonthSoFar: recommendation.monthToDate[measure],
    }
  }
  const [counting, lastMonth] = await Promise.all([
    program.status === 'paused' ? null : countingNow(deps, bundle, context),
    lastMonthOf(deps, bundle, context),
  ])
  if (counting === null) {
    const countingMonth = countingMonthOf(bundle)
    return {
      ...goal,
      lastMonth,
      countingMonth,
      newGoalFrom: newGoalFromOf(bundle, recommendation.timezone, recommendation.months),
    }
  }
  const { month, period } = counting
  return {
    ...goal,
    month,
    rows: rowsOf(recommendation, month),
    stopped: stopOf(bundle, period, recommendation.timezone),
    lastMonth,
    newGoalFrom: newGoalFromOf(bundle, recommendation.timezone, recommendation.months),
  }
}
