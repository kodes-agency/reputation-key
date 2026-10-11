// A goal's "Target changes", as its page prints them: newest first, each with
// who changed what, when, from which value to which, and the note they left.
//
// Pure. Two records feed it:
// - the log of changes to a running month's own target, one line per command
//   (a goal with several subjects logs one row per subject under one change);
// - the goal's versions, where a version's measure or target differs from the
//   plan in force before it.
//
// A month change that also set the months after wrote a version in the same
// write. That version is part of the change, so it is told on the change's line
// and never listed again on its own. A version replaced before its first month
// keeps a window that ends where it starts (reporting CONTEXT.md, invariant 2):
// it never applied to a month, so it is not a change of its own, the change
// after it is read against the plan before it, and a month change that wrote
// one says its months after never took effect.
import type { GoalMetric } from '#/contexts/reporting/application/public-api'
import type { monthTargetPlan } from '#/contexts/reporting/application/goal-month-target-plan'
import { formatMonthName } from '#/lib/format'
import { goalDay, goalPageMetricLabel } from './goal-detail-view'
import { goalFigure } from './goal-so-far'
import type { GoalMarkerFrame } from './goal-target-marker'

/** The goal as its page read it. */
type Goal = Parameters<typeof monthTargetPlan>[0]
type Version = Goal['versions'][number]
type MonthChange = NonNullable<Goal['targetChanges']>[number]

export type GoalTargetChangeEntry = Readonly<{
  id: string
  /** "Marco Rossi changed October’s target from 400 to 300". */
  text: string
  /** What became of the months after, or when the change applies from. */
  detail: string | null
  /** The note the manager left, as written. */
  note: string | null
  /** "Oct 20", with its year once it is another one. */
  dateLabel: string
  /** For `<time dateTime>`. */
  occurredAt: string
}>

/** What a version records when its author left no note. */
const DEFAULT_REASONS: ReadonlySet<string> = new Set([
  'created',
  'revised',
  'subjects_changed',
  'target_changed',
])

/** A plan replaced or ended before any month opened under it. */
const neverInForce = (version: Version): boolean =>
  version.effectiveTo !== null && version.effectiveTo <= version.effectiveFrom

const sentenceCase = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1)

/** "Marco changed X" with a name, "X was changed" without one. */
function told(name: string | null, thing: string, change: string): string {
  return name === null
    ? sentenceCase(`${thing} was changed ${change}`)
    : sentenceCase(`${name} changed ${thing} ${change}`)
}

const NOT_APPLIED_REASONS: Readonly<
  Record<NonNullable<MonthChange['followingReason']>, string>
> = {
  subject_unavailable: 'a subject of the goal was no longer available',
  metric_unavailable: 'the measure was not available',
}

/** What a month change did for the months after it. */
function followingDetail(
  change: MonthChange,
  month: string,
  versions: readonly Version[],
  frame: GoalMarkerFrame,
): string {
  const written = versions.find((version) => version.id === change.followingVersionId)
  const from = written ? goalDay(written.effectiveFrom, frame) : null
  switch (change.followingOutcome) {
    case 'not_requested':
      return `Only ${month} changed.`
    case 'kept_scheduled_change':
      return 'The months after kept the change already scheduled for them.'
    case 'not_applied':
      return `The months after were not changed: ${
        NOT_APPLIED_REASONS[change.followingReason ?? 'metric_unavailable']
      }.`
    case 'applied':
    case 'replaced_scheduled_change':
      if (!written || from === null) return 'The months after already had this target.'
      if (neverInForce(written)) {
        return `Was also set from ${from}, but that never took effect.`
      }
      return change.followingOutcome === 'applied'
        ? `Also applies from ${from}.`
        : `Also applies from ${from}, in place of the change that was scheduled.`
  }
}

type Dated = Readonly<{ at: Date; entry: GoalTargetChangeEntry }>

function monthChanges(goal: Goal, frame: GoalMarkerFrame): readonly Dated[] {
  // One command changes every running month of the goal together and logs a
  // row for each: the first row of a change stands for all of them.
  const commands = new Map<string, MonthChange>()
  for (const change of goal.targetChanges ?? []) {
    if (!commands.has(change.changeId)) commands.set(change.changeId, change)
  }
  return [...commands.values()].map((change) => {
    const result = goal.results.find(
      (candidate) => candidate.id === change.monthlyResultId,
    )
    const version = goal.versions.find(
      (candidate) => candidate.id === result?.programVersionId,
    )
    const metric: GoalMetric = version?.metric ?? goal.version.metric
    const month =
      (result ? formatMonthName(result.periodStart, result.propertyTimezone) : null) ??
      'A month'
    return {
      at: change.createdAt,
      entry: {
        id: `month:${change.changeId}`,
        text: told(
          frame.personName(change.createdBy),
          `${month}’s target`,
          `from ${goalFigure(metric, change.previousTargetValue)} to ${goalFigure(metric, change.newTargetValue)}`,
        ),
        detail: followingDetail(change, month, goal.versions, frame),
        note: change.note,
        dateLabel: goalDay(change.createdAt, frame),
        occurredAt: change.createdAt.toISOString(),
      },
    }
  })
}

function versionEntry(
  before: Version,
  version: Version,
  frame: GoalMarkerFrame,
): GoalTargetChangeEntry {
  const name = frame.personName(version.createdBy)
  const target = goalFigure(version.metric, version.targetValue)
  const reason = version.changeReason.trim()
  return {
    id: `version:${version.id}`,
    text:
      before.metric === version.metric
        ? told(
            name,
            'the target',
            `from ${goalFigure(before.metric, before.targetValue)} to ${target}`,
          )
        : told(
            name,
            'the measure',
            `to ${goalPageMetricLabel(version.metric)}, with a target of ${target}`,
          ),
    detail: `Applies from ${goalDay(version.effectiveFrom, frame)}.`,
    note: reason === '' || DEFAULT_REASONS.has(reason) ? null : reason,
    dateLabel: goalDay(version.createdAt, frame),
    occurredAt: version.createdAt.toISOString(),
  }
}

function versionChanges(goal: Goal, frame: GoalMarkerFrame): readonly Dated[] {
  const writtenByMonthChange = new Set(
    (goal.targetChanges ?? []).map((change) => change.followingVersionId),
  )
  const plans = [...goal.versions]
    .sort((left, right) => left.version - right.version)
    .filter((version) => !neverInForce(version))
  return plans.flatMap((version, index) => {
    const before = plans[index - 1]
    const unchanged =
      before?.metric === version.metric && before.targetValue === version.targetValue
    if (!before || unchanged || writtenByMonthChange.has(version.id)) return []
    return [{ at: version.createdAt, entry: versionEntry(before, version, frame) }]
  })
}

/** Every change to the goal's target, newest first. */
export function buildGoalTargetChanges(
  goal: Goal,
  frame: GoalMarkerFrame,
): readonly GoalTargetChangeEntry[] {
  return [...monthChanges(goal, frame), ...versionChanges(goal, frame)]
    .sort(
      (left, right) =>
        right.at.getTime() - left.at.getTime() ||
        left.entry.id.localeCompare(right.entry.id),
    )
    .map(({ entry }) => entry)
}
