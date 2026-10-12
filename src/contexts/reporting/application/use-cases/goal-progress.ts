// fallow-ignore-file code-duplication
// r4 s38: parallel dialog forms, server-function shells and ledger rows share intentional boilerplate.
// Reporting — how far a subject is through its goals this month.
//
// A live month-to-date read for the goal card on a Portal Group's page. It is
// never the monthly result: that is evaluated, reconciled and closed by the
// Program's own schedule, and keeps its own evidence. This read asks the same
// governed metric the result will use, for the whole calendar month in the
// Program's time zone, and prints what has counted so far. The month is not over,
// so nothing here says "achieved" or "missed"; the page words it as "so far".
//
// Who may read is the Program reads': they authorize `goal.read` and scope the
// Programs to what the actor may see, exactly as the Goals pages do.
//
// Two reads share it: the goals that target one subject (a Portal Group's
// card), and every current subject of one goal (the goal's own page).

import { calendarPeriodRange } from '#/shared/domain/period-range'
import {
  organizationId as toOrganizationId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import {
  goalSubjectIdentity,
  type GoalMetric,
  type GoalProgramStatus,
  type GoalSubject,
} from '../../domain/goal-program'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../ports/goal-program.repository'
import { effectiveMonthTarget } from '../goal-effective-month-target'
import {
  monthTargetMarker,
  type GoalMonthTargetMarker,
} from '../goal-month-target-marker'
import { goalTargetProvenance } from '../goal-target-provenance'
import { metricSubject } from './goal-program-shared'
import type {
  GoalActor,
  GoalExecutionPolicy,
  GoalMetricReadPort,
  GoalProgramService,
} from './goal-programs'
import type { GovernedGoalMetricResult } from './query-goal-metric'

/** What the month so far says about one goal. */
export type GoalProgressReading =
  /** The figure counted from the first of the month to now. */
  | Readonly<{ kind: 'live'; value: number; sampleCount: number }>
  /** An average the ratings so far are too few to support. */
  | Readonly<{ kind: 'too_few'; sampleCount: number; minimumSample: number }>
  /** The metric cannot be read safely right now; never shown as a zero. */
  | Readonly<{ kind: 'unavailable' }>
  /** The goal is scheduled or paused, so there is no month to count yet. */
  | Readonly<{ kind: 'not_started' }>

export type GoalProgress = Readonly<{
  programId: string
  name: string
  metric: GoalMetric
  /**
   * The target the running month is judged against: the month's own when it
   * has one, else its version's. The version's while no month is running.
   */
  targetValue: number
  /**
   * Who changed the running month's target last, when, what it started at and
   * how many times it changed. Null while the month is on the target it
   * started with, and while no month is running.
   */
  monthTarget: GoalMonthTargetMarker | null
  /** The person who set the goal's target: the version's, not a month's own. */
  setBy: string
  /** When that target was set. A later change of subjects alone does not move it. */
  setAt: Date
  status: Extract<GoalProgramStatus, 'scheduled' | 'active' | 'paused'>
  /** The calendar month the figure is for, in the Program's time zone. */
  period: Readonly<{ start: Date; end: Date }>
  timezone: string
  /** When the figure was read. */
  asOf: Date
  reading: GoalProgressReading
}>

export type GoalProgressInput = Readonly<{
  propertyId: string
  subject: GoalSubject
}>

export type GoalProgressDeps = Readonly<{
  reads: Pick<GoalProgramService, 'list' | 'get'>
  metrics: Pick<GoalMetricReadPort, 'queryGoalMetric'>
  now: () => Date
}>

export type GoalProgressReader = (
  input: GoalProgressInput,
  actor: GoalActor,
) => Promise<readonly GoalProgress[]>

/**
 * The most subjects one goal's page reads a live figure for. Each is its own
 * governed read; past this the page shows none rather than some.
 */
export const MAX_GOAL_PROGRAM_PROGRESS_SUBJECTS = 25

export type GoalProgramProgressInput = Readonly<{
  propertyId: string
  programId: string
}>

/** The month so far for one subject of a goal. */
export type GoalSubjectProgress = Readonly<{
  subject: GoalSubject
  progress: GoalProgress
}>

export type GoalProgramProgressReader = (
  input: GoalProgramProgressInput,
  actor: GoalActor,
) => Promise<readonly GoalSubjectProgress[]>

/** Request-facing: each invocation receives its scoped policy, like the Program commands. */
export type GoalProgressRequestApi = Readonly<{
  progress: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgressReader>
  ) => ReturnType<GoalProgressReader>
  programProgress: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramProgressReader>
  ) => ReturnType<GoalProgramProgressReader>
}>

type ShownStatus = GoalProgress['status']

const isShown = (status: GoalProgramStatus): status is ShownStatus => status !== 'ended'

/**
 * True while an assignment is in force or still to begin. One a later version
 * replaced has ended; one whose window ends where it starts (a plan replaced
 * or cancelled before it began) never held its subject at all.
 */
const isOpenAt = (assignment: GoalSubjectAssignment, now: Date): boolean =>
  assignment.effectiveTo === null ||
  (assignment.effectiveTo > now && assignment.effectiveTo > assignment.effectiveFrom)

/**
 * The assignment of this subject that is in force, else the next one to begin.
 * An assignment a later version replaced has an end date and is not offered.
 */
function assignmentFor(
  bundle: GoalProgramBundle,
  subject: GoalSubject,
  now: Date,
): GoalSubjectAssignment | null {
  const identity = goalSubjectIdentity(subject)
  const open = bundle.assignments
    .filter(
      (assignment) =>
        goalSubjectIdentity(assignment.subject) === identity && isOpenAt(assignment, now),
    )
    .sort((left, right) => left.effectiveFrom.getTime() - right.effectiveFrom.getTime())
  const current = open.filter((assignment) => assignment.effectiveFrom <= now)
  return current.at(-1) ?? open[0] ?? null
}

/** Every subject with an assignment in force or still to begin, once each. */
function currentSubjects(bundle: GoalProgramBundle, now: Date): readonly GoalSubject[] {
  const subjects = new Map<string, GoalSubject>()
  for (const assignment of bundle.assignments) {
    const identity = goalSubjectIdentity(assignment.subject)
    if (isOpenAt(assignment, now) && !subjects.has(identity)) {
      subjects.set(identity, assignment.subject)
    }
  }
  return [...subjects.values()]
}

function versionOf(
  bundle: GoalProgramBundle,
  assignment: GoalSubjectAssignment,
): GoalProgramVersion {
  return (
    bundle.versions.find((version) => version.id === assignment.programVersionId) ??
    bundle.version
  )
}

/** The subject's month that is running at `now`: open, begun and not yet over. */
function runningMonthOf(
  bundle: GoalProgramBundle,
  assignment: GoalSubjectAssignment,
  now: Date,
): GoalMonthlyResult | null {
  return (
    bundle.results.find(
      (result) =>
        result.assignmentId === assignment.id &&
        result.status === 'open' &&
        result.periodStart <= now &&
        now < result.periodEnd,
    ) ?? null
  )
}

/** What a governed read of a month still running says, in the card's terms. */
export function readingOf(
  version: Pick<GoalProgramVersion, 'metric' | 'metricMinimumSample'>,
  result: GovernedGoalMetricResult,
): Exclude<GoalProgressReading, Readonly<{ kind: 'not_started' }>> {
  if (result.state === 'unavailable' || result.state === 'quarantined') {
    return { kind: 'unavailable' }
  }
  if (
    version.metric === 'portal_rating_average' &&
    result.sampleCount < version.metricMinimumSample
  ) {
    return {
      kind: 'too_few',
      sampleCount: result.sampleCount,
      minimumSample: version.metricMinimumSample,
    }
  }
  if (result.exactValue === null || !Number.isFinite(result.exactValue)) {
    return { kind: 'unavailable' }
  }
  return { kind: 'live', value: result.exactValue, sampleCount: result.sampleCount }
}

async function progressOf(
  deps: GoalProgressDeps,
  bundle: GoalProgramBundle,
  subject: GoalSubject,
  status: ShownStatus,
  now: Date,
  actor: GoalActor,
): Promise<GoalProgress | null> {
  const assignment = assignmentFor(bundle, subject, now)
  if (!assignment) return null
  const version = versionOf(bundle, assignment)
  const started = status === 'active' && assignment.effectiveFrom <= now
  const period = calendarPeriodRange(
    started ? now : assignment.effectiveFrom,
    version.propertyTimezone,
    'monthly',
  )
  const reading: GoalProgressReading = started
    ? readingOf(
        version,
        await deps.metrics.queryGoalMetric({
          organizationId: toOrganizationId(actor.organizationId),
          propertyId: toPropertyId(bundle.program.propertyId),
          definitionVersionId: version.metricDefinitionVersionId,
          subject: metricSubject(subject),
          periodStart: period.start,
          periodEnd: period.end,
        }),
      )
    : { kind: 'not_started' }
  const { setAt, setBy } = goalTargetProvenance(bundle, version)
  // A month opens under the assignment's own version, so that is the version
  // its target falls back to.
  const month = runningMonthOf(bundle, assignment, now)
  return {
    programId: bundle.program.id,
    name: bundle.program.name,
    metric: version.metric,
    targetValue: month ? effectiveMonthTarget(month, version) : version.targetValue,
    monthTarget: month ? monthTargetMarker(bundle, month, version) : null,
    setBy,
    setAt,
    status,
    period,
    timezone: version.propertyTimezone,
    asOf: now,
    reading,
  }
}

/** The goals that target one subject, each with its month so far. */
export function createGoalProgressReader(deps: GoalProgressDeps): GoalProgressReader {
  return async (input, actor) => {
    const programs = await deps.reads.list(input.propertyId, actor)
    const now = deps.now()
    const goals = await Promise.all(
      programs.flatMap((bundle) =>
        isShown(bundle.program.status)
          ? [progressOf(deps, bundle, input.subject, bundle.program.status, now, actor)]
          : [],
      ),
    )
    return goals.flatMap((goal) => (goal ? [goal] : []))
  }
}

/**
 * One goal, with the month so far for each of its current subjects. A goal
 * with more subjects than the page reads figures for returns none, and so does
 * an ended goal.
 */
export function createGoalProgramProgressReader(
  deps: GoalProgressDeps,
): GoalProgramProgressReader {
  return async (input, actor) => {
    const bundle = await deps.reads.get(input, actor)
    const { status } = bundle.program
    if (!isShown(status)) return []
    const now = deps.now()
    const subjects = currentSubjects(bundle, now)
    if (subjects.length > MAX_GOAL_PROGRAM_PROGRESS_SUBJECTS) return []
    const read = await Promise.all(
      subjects.map(async (subject) => {
        const progress = await progressOf(deps, bundle, subject, status, now, actor)
        return progress ? [{ subject, progress }] : []
      }),
    )
    return read.flat()
  }
}
