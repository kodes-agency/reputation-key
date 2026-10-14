// Reporting — the month so far of every active goal on the Goals list.
//
// One request for the page: the Property's goals are listed once (through the
// Program list's own authorisation and visibility) and each reads its month to
// date through the same governed read a goal's own page uses (`progressOf`).
// Nothing here is a result. It is never stored, and a figure that cannot be
// read is shown as such, never as a zero.
//
// The list needs less than the page of a goal, so it reads less:
//
// - one subject: its figure against the running month's target, and on a count
//   whether it is below pace (`goalPace`);
// - several subjects on a count: a figure for each, to say how many are below
//   pace (`goalPace`), up to the subjects a goal's page reads;
// - several subjects on an average, or more than that many: no figure, the
//   count of subjects alone. An average has no pace to be below.
//
// A scheduled, paused or ended goal has no month counting, so it is not here.
//
// Each figure is the governed read of the goal's own page, one per subject, so
// the list and the page can never disagree. That is one server call but several
// statements, a deliberate departure from a single set-based read: the
// set-based form of a count (`goal-running-months.ts`, for the Overview chip and
// the Properties list) leaves out the outbox completeness proof the page applies.
// So the page is bounded instead: it reads at most `MAX_GOAL_LIST_PROGRESS_READS`
// figures, `GOAL_LIST_PROGRESS_CONCURRENCY` at a time, and the goals past that
// carry no live line.

import { calendarPeriodRange } from '#/shared/domain/period-range'
import type { GoalMetric, GoalSubject } from '../../domain/goal-program'
import { goalMonthDays, goalPace } from '../../domain/goal-pace'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import {
  MAX_GOAL_PROGRAM_PROGRESS_SUBJECTS,
  progressOf,
  subjectsInForce,
  type GoalProgress,
  type GoalProgressDeps,
  type GoalProgressReading,
} from './goal-progress'
import type { GoalActor, GoalExecutionPolicy } from './goal-programs'

/** The most figures one Goals page reads; past it a goal carries no live line. */
export const MAX_GOAL_LIST_PROGRESS_READS = 60

/**
 * Governed reads in flight at once for one page. A read asks two queries at once,
 * each on its own pool connection, so three reads take six of the web pool's ten
 * and leave the rest for the page's other reads and for other requests.
 */
export const GOAL_LIST_PROGRESS_CONCURRENCY = 3

type CountingReading = Exclude<GoalProgressReading, Readonly<{ kind: 'not_started' }>>

/** What the Goals list prints under an active goal. */
export type GoalListProgress = Readonly<{
  programId: string
  metric: GoalMetric
  /** Subjects counting this month. */
  subjectCount: number
  /** Whole local days still to begin after today. */
  daysLeft: number
  /** The one subject's month so far; null for a goal with several subjects. */
  month: Readonly<{ reading: CountingReading; targetValue: number }> | null
  /**
   * Subjects below pace, for a count goal: how many of several, or 1 or 0 for
   * a goal with one subject. Null when nothing was judged: an average, a month
   * in its first days, subjects too many to read, or figures that cannot be
   * read.
   */
  belowPace: number | null
}>

export type GoalListProgressInput = Readonly<{ propertyId: string }>

export type GoalListProgressReader = (
  input: GoalListProgressInput,
  actor: GoalActor,
) => Promise<readonly GoalListProgress[]>

/** Request-facing: each invocation receives its scoped policy, like the Program commands. */
export type GoalListProgressRequestApi = Readonly<{
  listProgress: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalListProgressReader>
  ) => ReturnType<GoalListProgressReader>
}>

type Planned = Readonly<{
  bundle: GoalProgramBundle
  subjects: readonly GoalSubject[]
  /** The subjects to read a figure for; none for a goal that needs only their number. */
  reads: readonly GoalSubject[]
}>

function subjectsToRead(
  bundle: GoalProgramBundle,
  subjects: readonly GoalSubject[],
): readonly GoalSubject[] {
  if (subjects.length === 1) return subjects
  if (bundle.version.metric === 'portal_rating_average') return []
  return subjects.length <= MAX_GOAL_PROGRAM_PROGRESS_SUBJECTS ? subjects : []
}

/** The active goals that count a month, in list order, while the page can read them. */
function planPage(programs: readonly GoalProgramBundle[], now: Date): readonly Planned[] {
  const planned: Planned[] = []
  let used = 0
  for (const bundle of programs) {
    if (bundle.program.status !== 'active') continue
    const subjects = subjectsInForce(bundle, now)
    if (subjects.length === 0) continue
    const reads = subjectsToRead(bundle, subjects)
    if (used + reads.length > MAX_GOAL_LIST_PROGRESS_READS) continue
    used += reads.length
    planned.push({ bundle, subjects, reads })
  }
  return planned
}

/** `run` over `items` with at most `limit` in flight, results in the order of `items`. */
async function inParallel<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await run(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function isCounting(reading: GoalProgressReading): reading is CountingReading {
  return reading.kind !== 'not_started'
}

/** How many of a goal's subjects are below pace; null when none could be judged. */
function belowPaceOf(read: readonly GoalProgress[], now: Date): number | null {
  const states = read.flatMap((progress) =>
    progress.reading.kind === 'live'
      ? [
          goalPace({
            metric: progress.metric,
            value: progress.reading.value,
            target: progress.targetValue,
            period: progress.period,
            now,
            timezone: progress.timezone,
          }).state,
        ]
      : [],
  )
  const judged = states.filter((state) => state === 'behind' || state === 'on_pace')
  return judged.length === 0 ? null : judged.filter((state) => state === 'behind').length
}

function entryOf(
  plan: Planned,
  read: readonly GoalProgress[],
  now: Date,
): GoalListProgress | null {
  const { bundle, subjects } = plan
  const first = read[0]
  const period = first
    ? first.period
    : calendarPeriodRange(now, bundle.version.propertyTimezone, 'monthly')
  const timezone = first ? first.timezone : bundle.version.propertyTimezone
  const base = {
    programId: bundle.program.id,
    metric: first ? first.metric : bundle.version.metric,
    subjectCount: subjects.length,
    daysLeft: goalMonthDays(period, now, timezone).daysLeft,
  }
  if (subjects.length > 1) {
    return { ...base, month: null, belowPace: belowPaceOf(read, now) }
  }
  if (!first || !isCounting(first.reading)) return null
  return {
    ...base,
    month: { reading: first.reading, targetValue: first.targetValue },
    belowPace: belowPaceOf(read, now),
  }
}

/** The month so far of each active goal of a Property, for the Goals list. */
export function createGoalListProgressReader(
  deps: GoalProgressDeps,
): GoalListProgressReader {
  return async (input, actor) => {
    const programs = await deps.reads.list(input.propertyId, actor)
    const now = deps.now()
    const plans = planPage(programs, now)
    const requests = plans.flatMap((plan) =>
      plan.reads.map((subject) => ({ plan, subject })),
    )
    const figures = await inParallel(
      requests,
      GOAL_LIST_PROGRESS_CONCURRENCY,
      ({ plan, subject }) => progressOf(deps, plan.bundle, subject, 'active', now, actor),
    )
    return plans.flatMap((plan) => {
      const read = requests.flatMap(({ plan: owner }, index) => {
        const figure = figures[index]
        return owner === plan && figure ? [figure] : []
      })
      const entry = entryOf(plan, read, now)
      return entry ? [entry] : []
    })
  }
}
