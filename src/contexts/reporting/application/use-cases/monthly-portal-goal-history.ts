// Reporting — the Monthly portal goal's months and what changed, for its page
// (ADR 0068, PLAN PG-13).
//
// A Property keeps one Monthly portal goal at a time, but a stopped goal is
// followed by a new one, so the page reads the line of succession: the goal
// itself, then every earlier Property count goal of the Property that has
// ended, newest end first. With no goal now (a stopped goal whose last month
// has closed) it is those ended goals alone, so a notice or a link about one
// of them still lands on their months. Its months are theirs together, one per
// month (the goal's own first), newest first: the running month with its
// governed figure, a month still being read with its figure so far, and each
// closed month with its result after any correction. The card's read already
// has the governed figure of the months it shows; any other month still
// counting or being read (a stopped goal's November while the next goal waits
// for December) is read the same governed way, never left without a figure.
// Its changes are dated facts: a number set from a month (where it came from,
// and a note), one month's own number set, the goal stopped, and each published
// Portal going live. The server decides every one; the page only words them.
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
import { versionNoteOf } from '../goal-version-reasons'
import {
  isPropertyCountGoal,
  type PropertyCountGoal,
} from '../monthly-portal-goal-identity'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramVersion,
} from '../ports/goal-program.repository'
import type { GoalActor } from './goal-programs'
import { readSubjectMonth } from './goal-progress'
import {
  finalFigureOn,
  measureOf,
  monthKeyOf,
  outcomeOf,
  versionOf,
  type MonthlyPortalGoalOnCardDeps,
} from './monthly-portal-goal-running'

/** The most months "Month by month" shows. */
const MAX_MONTHS = 24

/**
 * The goal, then the Property count goals it took over from, newest end first;
 * with no goal now, those ended goals alone.
 */
export function successionOf(
  programs: readonly GoalProgramBundle[],
  goal: PropertyCountGoal | null,
): readonly PropertyCountGoal[] {
  const earlier = programs
    .filter(isPropertyCountGoal)
    .filter(
      ({ program }) => program.status === 'ended' && program.id !== goal?.program.id,
    )
    .sort(
      (a, b) =>
        b.program.updatedAt.getTime() - a.program.updatedAt.getTime() ||
        a.program.id.localeCompare(b.program.id),
    )
  return goal === null ? earlier : [goal, ...earlier]
}

/** What the card read already knows of the months it shows. */
export type ShownMonths = Readonly<{
  month: PortalGoalRunningMonth | null
  lastMonth: PortalGoalLastMonth | null
}>

/** The clock and the reader the months are read with. */
export type GoalMonthsContext = Readonly<{
  now: Date
  /** Today, the Property's local day. */
  today: string
  actor: GoalActor
}>

/** One month of the line of succession: the goal whose month it is, and its result. */
type Picked = Readonly<{
  bundle: PropertyCountGoal
  result: GoalMonthlyResult
  version: GoalProgramVersion
  base: Pick<PortalGoalPageMonth, 'key' | 'measure' | 'target'>
}>

/** A closed month: its result, the day it arrived, and the latest correction. */
function closedMonth({ result, base }: Picked): PortalGoalPageMonth {
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
 * The governed figure so far of a month still counting or being read: the
 * card's, for a month it shows in the same measure; otherwise read the same
 * way (`readSubjectMonth`). Null when it cannot be read, never a zero.
 */
async function figureSoFar(
  deps: MonthlyPortalGoalOnCardDeps,
  picked: Picked,
  shown: PortalGoalRunningMonth | PortalGoalLastMonth | null,
  actor: GoalActor,
): Promise<number | null> {
  const { bundle, result, version, base } = picked
  if (shown?.key === base.key && shown.measure === base.measure) return shown.value
  const reading = await readSubjectMonth(
    deps,
    version,
    { kind: 'property', propertyId: bundle.program.propertyId },
    { start: result.periodStart, end: result.periodEnd },
    actor,
  )
  return reading.kind === 'live' ? reading.value : null
}

/**
 * A month still counting or being read: its figure so far, and the day its
 * final figure is due, but no day once that day has gone.
 */
async function openMonth(
  deps: MonthlyPortalGoalOnCardDeps,
  picked: Picked,
  shown: ShownMonths,
  context: GoalMonthsContext,
): Promise<PortalGoalPageMonth> {
  const { result, base } = picked
  const running = result.periodEnd.getTime() > context.now.getTime()
  const due = finalFigureOn(result)
  const value = await figureSoFar(
    deps,
    picked,
    running ? shown.month : shown.lastMonth,
    context.actor,
  )
  return {
    ...base,
    value,
    outcome: running ? 'running' : 'updating',
    finalOn: due < context.today ? null : due,
    correction: null,
  }
}

/** Each month of the line of succession once, the goal's own first, newest first. */
function pickMonths(succession: readonly PropertyCountGoal[]): readonly Picked[] {
  const byKey = new Map<string, Picked>()
  for (const bundle of succession) {
    for (const result of bundle.results) {
      const version = versionOf(bundle, result.programVersionId)
      const measure = measureOf(version)
      const key = monthKeyOf(result.periodStart, result.propertyTimezone)
      if (measure === null || byKey.has(key)) continue
      const target = effectiveMonthTarget(result, version)
      byKey.set(key, { bundle, result, version, base: { key, measure, target } })
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.base.key.localeCompare(a.base.key))
    .slice(0, MAX_MONTHS)
}

/**
 * "Month by month": each month of the line of succession, newest first, up to
 * 24. Only a month still counting or being read that the card does not show
 * is read again: a stopped goal's last month, at most one or two.
 */
export function goalMonthsOf(
  deps: MonthlyPortalGoalOnCardDeps,
  succession: readonly PropertyCountGoal[],
  shown: ShownMonths,
  context: GoalMonthsContext,
): Promise<readonly PortalGoalPageMonth[]> {
  return Promise.all(
    pickMonths(succession).map((picked) =>
      picked.result.status === 'closed'
        ? closedMonth(picked)
        : openMonth(deps, picked, shown, context),
    ),
  )
}

/** A change, with the instant it was made for ordering a day's changes. */
type Dated = Readonly<{ at: number; change: PortalGoalChange }>

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
          note: versionNoteOf(version.changeReason),
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

/**
 * What changed, newest first: the line of succession's changes and the
 * go-lives; nothing before the Property's first goal.
 */
export function goalChangesOf(
  succession: readonly PropertyCountGoal[],
  recommendation: PortalGoalRecommendation,
): readonly PortalGoalChange[] {
  if (succession.length === 0) return []
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
