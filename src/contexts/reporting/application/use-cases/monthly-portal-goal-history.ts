// Reporting — the Monthly portal goal's months and what changed, for its page
// (ADR 0068, PLAN PG-13).
//
// A Property keeps one Monthly portal goal at a time, but a stopped goal is
// followed by a new one, so the page reads the line of succession: the goal
// itself, then every earlier Property count goal of the Property that has
// ended, newest end first. Its months are theirs together, one per month (the
// goal's own first), newest first: the running month with its governed figure,
// a month still being read with its figure so far, and each closed month with
// its result after any correction. Its changes are dated facts: a number set
// from a month (where it came from, and a note), one month's own number set,
// the goal stopped, and each published Portal going live. The server decides
// every one; the page only words them. Pure.
import type { PortalGoalRecommendation } from '../dto/goal-recommendation.types'
import type {
  PortalGoalChange,
  PortalGoalPageMonth,
} from '../dto/monthly-portal-goal-page.types'
import type {
  PortalGoalLastMonth,
  PortalGoalRunningMonth,
} from '../dto/monthly-portal-goal.types'
import { localDateOf } from '../../domain/local-days'
import { effectiveMonthTarget } from '../goal-effective-month-target'
import {
  isPropertyCountGoal,
  type PropertyCountGoal,
} from '../monthly-portal-goal-identity'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
} from '../ports/goal-program.repository'
import {
  finalFigureOn,
  measureOf,
  monthKeyOf,
  outcomeOf,
  versionOf,
} from './monthly-portal-goal-running'

/** The most months "Month by month" shows. */
const MAX_MONTHS = 24

/** A version's change reason that a command wrote, not a note a manager typed. */
const SYSTEM_REASONS: ReadonlySet<string> = new Set([
  'created',
  'revised',
  'subjects_changed',
  'target_changed',
  'metric_correction_reconciliation',
])

/** The goal, then the Property count goals it took over from, newest end first. */
export function successionOf(
  programs: readonly GoalProgramBundle[],
  goal: PropertyCountGoal,
): readonly PropertyCountGoal[] {
  const earlier = programs
    .filter(isPropertyCountGoal)
    .filter(({ program }) => program.status === 'ended' && program.id !== goal.program.id)
    .sort(
      (a, b) =>
        b.program.updatedAt.getTime() - a.program.updatedAt.getTime() ||
        a.program.id.localeCompare(b.program.id),
    )
  return [goal, ...earlier]
}

/** What the card read already knows of the months it shows. */
export type ShownMonths = Readonly<{
  month: PortalGoalRunningMonth | null
  lastMonth: PortalGoalLastMonth | null
}>

/** A closed month: its result, the day it arrived, and the latest correction. */
function closedMonth(
  result: GoalMonthlyResult,
  base: Pick<PortalGoalPageMonth, 'key' | 'measure' | 'target'>,
): PortalGoalPageMonth {
  const timezone = result.propertyTimezone
  const outcome = outcomeOf(result)
  const value = result.evaluation.value
  return {
    ...base,
    value,
    outcome,
    finalOn: result.closedAt ? localDateOf(result.closedAt, timezone) : null,
    correction: result.revision
      ? { on: localDateOf(result.revision.createdAt, timezone), value, outcome }
      : null,
  }
}

/**
 * A month still counting or being read: the governed figure the card read, for
 * the month it shows; otherwise no figure, never a zero.
 */
function openMonth(
  result: GoalMonthlyResult,
  base: Pick<PortalGoalPageMonth, 'key' | 'measure' | 'target'>,
  shown: ShownMonths,
  now: Date,
): PortalGoalPageMonth {
  const running = result.periodEnd.getTime() > now.getTime()
  const { month, lastMonth } = shown
  const finalOn = finalFigureOn(result)
  if (running) {
    const value = month?.key === base.key ? month.value : null
    return { ...base, value, outcome: 'running', finalOn, correction: null }
  }
  const read = lastMonth?.key === base.key ? lastMonth : null
  return {
    ...base,
    value: read?.value ?? null,
    outcome: 'updating',
    finalOn: read ? read.finalOn : finalOn,
    correction: null,
  }
}

function pageMonthOf(
  bundle: PropertyCountGoal,
  result: GoalMonthlyResult,
  shown: ShownMonths,
  now: Date,
): PortalGoalPageMonth | null {
  const version = versionOf(bundle, result.programVersionId)
  const measure = measureOf(version)
  if (measure === null) return null
  const base = {
    key: monthKeyOf(result.periodStart, result.propertyTimezone),
    measure,
    target: effectiveMonthTarget(result, version),
  }
  return result.status === 'closed'
    ? closedMonth(result, base)
    : openMonth(result, base, shown, now)
}

/** Each month of the line of succession once, the goal's own first, newest first. */
export function goalMonthsOf(
  succession: readonly PropertyCountGoal[],
  shown: ShownMonths,
  now: Date,
): readonly PortalGoalPageMonth[] {
  const byKey = new Map<string, PortalGoalPageMonth>()
  for (const bundle of succession) {
    for (const result of bundle.results) {
      const month = pageMonthOf(bundle, result, shown, now)
      if (month !== null && !byKey.has(month.key)) byKey.set(month.key, month)
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.key.localeCompare(a.key))
    .slice(0, MAX_MONTHS)
}

/** A change, with the instant it was made for ordering a day's changes. */
type Dated = Readonly<{ at: number; change: PortalGoalChange }>

const noteOfReason = (reason: string): string | null =>
  SYSTEM_REASONS.has(reason) ? null : reason

/**
 * The number set from a month: the first version, and each later one with a
 * new number or measure. A version a month's change wrote for the months after
 * it is that change's, and a version that only changed subjects is no change of
 * number.
 */
function versionChanges(bundle: PropertyCountGoal, timezone: string): Dated[] {
  const following = new Set(
    (bundle.targetChanges ?? []).flatMap(({ followingVersionId }) =>
      followingVersionId === null ? [] : [followingVersionId],
    ),
  )
  const versions = [...bundle.versions].sort((a, b) => a.version - b.version)
  return versions.flatMap((version, index) => {
    const before = versions[index - 1]
    const measure = measureOf(version)
    if (measure === null || following.has(version.id)) return []
    if (
      before !== undefined &&
      before.metric === version.metric &&
      before.targetValue === version.targetValue
    ) {
      return []
    }
    return [
      {
        at: version.createdAt.getTime(),
        change: {
          kind: 'set_from',
          on: localDateOf(version.createdAt, timezone),
          by: version.createdBy,
          fromMonth: monthKeyOf(version.effectiveFrom, version.propertyTimezone),
          target: version.targetValue,
          measure,
          switched: before !== undefined && before.metric !== version.metric,
          source: version.targetSource ?? null,
          note: noteOfReason(version.changeReason),
        },
      },
    ]
  })
}

/** One month's own number, set while it ran. */
function monthChanges(bundle: PropertyCountGoal, timezone: string): Dated[] {
  return (bundle.targetChanges ?? []).flatMap((change) => {
    const result = bundle.results.find(({ id }) => id === change.monthlyResultId)
    if (!result) return []
    const measure = measureOf(versionOf(bundle, result.programVersionId))
    if (measure === null) return []
    return [
      {
        at: change.createdAt.getTime(),
        change: {
          kind: 'set_month',
          on: localDateOf(change.createdAt, timezone),
          by: change.createdBy,
          month: monthKeyOf(result.periodStart, result.propertyTimezone),
          target: change.newTargetValue,
          measure,
          source: change.targetSource ?? null,
          note: change.note,
        },
      },
    ]
  })
}

/** The stop, when who and when were recorded (none before migration 0062). */
function stopChange(bundle: PropertyCountGoal, timezone: string): Dated[] {
  const { status, endedAt, endedBy } = bundle.program
  if (status !== 'ended' || !endedAt || !endedBy) return []
  return [
    {
      at: endedAt.getTime(),
      change: { kind: 'stopped', on: localDateOf(endedAt, timezone), by: endedBy },
    },
  ]
}

/** Each day published Portals began their current live run, the Portals in name order. */
function goLives(recommendation: PortalGoalRecommendation): Dated[] {
  const byDay = new Map<string, string[]>()
  for (const { publicationState, liveSince, name } of recommendation.portals) {
    if (publicationState !== 'published' || liveSince === null) continue
    byDay.set(liveSince, [...(byDay.get(liveSince) ?? []), name])
  }
  // A day's go-lives follow the changes made that day (each made after 1970).
  return [...byDay].map(([on, portals]) => ({
    at: 0,
    change: { kind: 'went_live', on, portals },
  }))
}

/** What changed, newest first: the line of succession's changes and the go-lives. */
export function goalChangesOf(
  succession: readonly PropertyCountGoal[],
  recommendation: PortalGoalRecommendation,
): readonly PortalGoalChange[] {
  const { timezone } = recommendation
  const dated = [
    ...succession.flatMap((bundle) => [
      ...versionChanges(bundle, timezone),
      ...monthChanges(bundle, timezone),
      ...stopChange(bundle, timezone),
    ]),
    ...goLives(recommendation),
  ]
  return dated
    .sort((a, b) => b.change.on.localeCompare(a.change.on) || b.at - a.at)
    .map(({ change }) => change)
}
