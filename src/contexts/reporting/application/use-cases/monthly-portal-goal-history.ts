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
//
// A goal with a page of its own on `$goalId` (PLAN PG-21) has the same months
// and changes, of itself alone: a Portal's or a group's count goal in its
// counts, and the average private rating in its averages (`averageMeasureOf`).
import type { PortalGoalRecommendation } from '../dto/goal-recommendation.types'
import type {
  PortalGoalChange,
  PortalGoalPageMeasure,
  PortalGoalPageMonth,
} from '../dto/monthly-portal-goal-page.types'
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
  subjectOf,
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

/** A month a read already has the governed figure of. */
type ShownMonth = Readonly<{
  key: string
  measure: PortalGoalPageMeasure
  value: number | null
}>

/** What the card read (or the average's own read) already knows of the months it shows. */
export type ShownMonths = Readonly<{
  month: ShownMonth | null
  lastMonth: ShownMonth | null
}>

/**
 * What a version's months count on a page: a count (an average a Property goal
 * was changed from is no month of the Monthly portal goal's), or, on the
 * average's own page, the average alone.
 */
export type PageMeasureOf = (version: GoalProgramVersion) => PortalGoalPageMeasure | null

/** The average private rating's page: only its versions that count the average. */
export const averageMeasureOf: PageMeasureOf = (version) =>
  version.metric === 'portal_rating_average' ? 'portal_rating_average' : null

/** The clock and the reader the months are read with. */
export type GoalMonthsContext = Readonly<{
  now: Date
  /** Today, the Property's local day. */
  today: string
  actor: GoalActor
}>

/** One month of the line of succession: the goal whose month it is, and its result. */
type Picked = Readonly<{
  bundle: GoalProgramBundle
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
  shown: ShownMonth | null,
  actor: GoalActor,
): Promise<number | null> {
  const { bundle, result, version, base } = picked
  if (shown?.key === base.key && shown.measure === base.measure) return shown.value
  // The subject the month was opened for: the Property, or a goal's one Portal or group.
  const assignment = bundle.assignments.find(({ id }) => id === result.assignmentId)
  const reading = await readSubjectMonth(
    deps,
    version,
    assignment?.subject ?? subjectOf(bundle),
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
function pickMonths(
  succession: readonly GoalProgramBundle[],
  pageMeasureOf: PageMeasureOf,
): readonly Picked[] {
  const byKey = new Map<string, Picked>()
  for (const bundle of succession) {
    for (const result of bundle.results) {
      const version = versionOf(bundle, result.programVersionId)
      const measure = pageMeasureOf(version)
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
  succession: readonly GoalProgramBundle[],
  shown: ShownMonths,
  context: GoalMonthsContext,
  pageMeasureOf: PageMeasureOf = measureOf,
): Promise<readonly PortalGoalPageMonth[]> {
  return Promise.all(
    pickMonths(succession, pageMeasureOf).map((picked) =>
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
function versionChanges(
  bundle: GoalProgramBundle,
  timezone: string,
  pageMeasureOf: PageMeasureOf,
): Dated[] {
  const following = new Set(
    (bundle.targetChanges ?? []).flatMap(({ followingVersionId }) =>
      followingVersionId === null ? [] : [followingVersionId],
    ),
  )
  const versions = [...bundle.versions].sort((a, b) => a.version - b.version)
  return versions.flatMap((version, index) => {
    const before = versions[index - 1]
    const measure = pageMeasureOf(version)
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
function monthChanges(
  bundle: GoalProgramBundle,
  timezone: string,
  pageMeasureOf: PageMeasureOf,
): Dated[] {
  return (bundle.targetChanges ?? []).flatMap((change) => {
    const result = bundle.results.find(({ id }) => id === change.monthlyResultId)
    if (!result) return []
    const measure = pageMeasureOf(versionOf(bundle, result.programVersionId))
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
function stopChange(bundle: GoalProgramBundle, timezone: string): Dated[] {
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
function goLives(recommendation: Pick<PortalGoalRecommendation, 'portals'>): Dated[] {
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
 * go-lives of the Portals the recommendation lists (none listed, none said);
 * nothing before the Property's first goal.
 */
export function goalChangesOf(
  succession: readonly GoalProgramBundle[],
  recommendation: Pick<PortalGoalRecommendation, 'timezone' | 'portals'>,
  pageMeasureOf: PageMeasureOf = measureOf,
): readonly PortalGoalChange[] {
  if (succession.length === 0) return []
  const { timezone } = recommendation
  const dated = [
    ...succession.flatMap((bundle) => [
      ...versionChanges(bundle, timezone, pageMeasureOf),
      ...monthChanges(bundle, timezone, pageMeasureOf),
      ...stopChange(bundle, timezone),
    ]),
    ...goLives(recommendation),
  ]
  return dated
    .sort((a, b) => b.change.on.localeCompare(a.change.on) || b.at - a.at)
    .map(({ change }) => change)
}
