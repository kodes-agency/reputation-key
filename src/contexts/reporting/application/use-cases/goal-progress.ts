// Reporting — how far a subject is through its goals this month.
//
// A live month-to-date read for the goal card on a Portal Group's page. It is
// never the monthly result: that is evaluated, reconciled and closed by the
// Program's own schedule, and keeps its own evidence. This read asks the same
// governed metric the result will use, for the whole calendar month in the
// Program's time zone, and prints what has counted so far. The month is not over,
// so nothing here says "achieved" or "missed"; the page words it as "so far".
//
// Who may read is the Program list's: it authorizes `goal.read` and scopes the
// Programs to what the actor may see, exactly as the Goals page does.

import { calendarPeriodRange } from '#/shared/domain/period-range'
import {
  organizationId as toOrganizationId,
  portalGroupId as toPortalGroupId,
  portalId as toPortalId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import {
  goalSubjectIdentity,
  type GoalMetric,
  type GoalProgramStatus,
  type GoalSubject,
} from '../../domain/goal-program'
import type {
  GoalProgramBundle,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../ports/goal-program.repository'
import type {
  GoalActor,
  GoalExecutionPolicy,
  GoalMetricReadPort,
  GoalProgramService,
} from './goal-programs'
import type {
  GovernedGoalMetricQuery,
  GovernedGoalMetricResult,
} from './query-goal-metric'

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
  targetValue: number
  /** The person who set the target now in force. */
  setBy: string
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
  reads: Pick<GoalProgramService, 'list'>
  metrics: Pick<GoalMetricReadPort, 'queryGoalMetric'>
  now: () => Date
}>

export type GoalProgressReader = (
  input: GoalProgressInput,
  actor: GoalActor,
) => Promise<readonly GoalProgress[]>

/** Request-facing: each invocation receives its scoped policy, like the Program commands. */
export type GoalProgressRequestApi = Readonly<{
  progress: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgressReader>
  ) => ReturnType<GoalProgressReader>
}>

type ShownStatus = GoalProgress['status']

const isShown = (status: GoalProgramStatus): status is ShownStatus => status !== 'ended'

function metricSubject(subject: GoalSubject): GovernedGoalMetricQuery['subject'] {
  switch (subject.kind) {
    case 'property':
      return { kind: 'property', propertyId: toPropertyId(subject.propertyId) }
    case 'portal_group':
      return {
        kind: 'portal_group',
        portalGroupId: toPortalGroupId(subject.portalGroupId),
      }
    case 'portal':
      return { kind: 'portal', portalId: toPortalId(subject.portalId) }
  }
}

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
        goalSubjectIdentity(assignment.subject) === identity &&
        (assignment.effectiveTo === null || assignment.effectiveTo > now),
    )
    .sort((left, right) => left.effectiveFrom.getTime() - right.effectiveFrom.getTime())
  const current = open.filter((assignment) => assignment.effectiveFrom <= now)
  return current.at(-1) ?? open[0] ?? null
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

function readingOf(
  version: GoalProgramVersion,
  result: GovernedGoalMetricResult,
): GoalProgressReading {
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

export function createGoalProgressReader(deps: GoalProgressDeps): GoalProgressReader {
  const progressOf = async (
    bundle: GoalProgramBundle,
    subject: GoalSubject,
    status: ShownStatus,
    now: Date,
    actor: GoalActor,
  ): Promise<GoalProgress | null> => {
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
    return {
      programId: bundle.program.id,
      name: bundle.program.name,
      metric: version.metric,
      targetValue: version.targetValue,
      setBy: version.createdBy,
      status,
      period,
      timezone: version.propertyTimezone,
      asOf: now,
      reading,
    }
  }

  return async (input, actor) => {
    const programs = await deps.reads.list(input.propertyId, actor)
    const now = deps.now()
    const goals = await Promise.all(
      programs.flatMap((bundle) =>
        isShown(bundle.program.status)
          ? [progressOf(bundle, input.subject, bundle.program.status, now, actor)]
          : [],
      ),
    )
    return goals.flatMap((goal) => (goal ? [goal] : []))
  }
}
