// Reporting — the month so far for a subject, before a goal exists.
//
// A goal that starts this month counts from the first of the month, so the
// form shows what has already counted before the target is saved. This is one
// governed read of the current Property-local month for one subject and
// measure: the same read a goal's own month-to-date uses, and never a result.
//
// Who may read is whoever may set the goal: it authorizes `goal.create`.

import { calendarPeriodRange } from '#/shared/domain/period-range'
import {
  organizationId as toOrganizationId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import type { GoalMetric, GoalSubject } from '../../domain/goal-program'
import {
  GoalProgramError,
  metricSubject,
  resolveMetricVersion,
  type GoalActor,
  type GoalExecutionPolicy,
  type GoalProgramDependencies,
} from './goal-program-shared'
import { readingOf } from './goal-progress'

export type GoalMonthPreviewInput = Readonly<{
  propertyId: string
  metric: GoalMetric
  subject: GoalSubject
}>

export type GoalMonthPreview = Readonly<{
  metric: GoalMetric
  /** The calendar month the figure is for, in the Property's time zone. */
  period: Readonly<{ start: Date; end: Date }>
  timezone: string
  /** When the figure was read. */
  asOf: Date
  reading: ReturnType<typeof readingOf>
}>

export type GoalMonthPreviewDeps = Pick<
  GoalProgramDependencies,
  'policy' | 'subjects' | 'metrics' | 'now'
>

export async function readGoalMonthPreview(
  deps: GoalMonthPreviewDeps,
  input: GoalMonthPreviewInput,
  actor: GoalActor,
): Promise<GoalMonthPreview> {
  await deps.policy.authorize({
    actor,
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    action: 'goal.create',
  })
  const [timezone, governed, owned] = await Promise.all([
    deps.subjects.getTimezone(actor.organizationId, input.propertyId),
    resolveMetricVersion(deps, input.metric),
    deps.subjects.subjectBelongsToProperty(
      actor.organizationId,
      input.propertyId,
      input.subject,
    ),
  ])
  if (!timezone) throw new GoalProgramError('not_found')
  if (!owned) throw new GoalProgramError('invalid_subject')

  const now = deps.now()
  const period = calendarPeriodRange(now, timezone, 'monthly')
  const result = await deps.metrics.queryGoalMetric({
    organizationId: toOrganizationId(actor.organizationId),
    propertyId: toPropertyId(input.propertyId),
    definitionVersionId: governed.version.id,
    subject: metricSubject(input.subject),
    periodStart: period.start,
    periodEnd: period.end,
  })
  return {
    metric: input.metric,
    period,
    timezone,
    asOf: now,
    reading: readingOf(
      { metric: input.metric, metricMinimumSample: governed.version.minimumSample },
      result,
    ),
  }
}

/** Request-facing: each invocation receives its scoped policy, like the Program commands. */
export type GoalMonthPreviewRequestApi = Readonly<{
  monthPreview: (
    policy: GoalExecutionPolicy,
    input: GoalMonthPreviewInput,
    actor: GoalActor,
  ) => Promise<GoalMonthPreview>
}>
