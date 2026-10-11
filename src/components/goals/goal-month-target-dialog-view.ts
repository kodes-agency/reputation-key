// What the "Change this month's target" dialog says.
//
// Pure. Everything about the months after is read from the plan the command
// itself works from (`monthTargetPlan`), so the dialog shows what the save will
// write: the day a version for the months after would start, a change that is
// already scheduled for them, a month that would be left without a result, and
// the case where they cannot take the target at all. It also says whether the
// form asks for any change yet: there is nothing to save until it does. What
// the dialog says after the save is in goal-month-target-receipt.ts.
import type { monthTargetPlan } from '#/contexts/reporting/application/goal-month-target-plan'
import type {
  GoalMetric,
  GoalProgressReading,
} from '#/contexts/reporting/application/public-api'
import { formatMonthName } from '#/lib/format'
import { goalDay } from './goal-detail-view'
import { goalFigure, goalSoFarLine } from './goal-so-far'

/** The running month, as the plan describes it. */
type Plan = NonNullable<ReturnType<typeof monthTargetPlan>>
/** The Property's own zone, where a version for the months after is cut. */
type Frame = Readonly<{
  timezone: string
  now: Date
  /** The goal is paused: it opens no month until it is resumed. */
  paused?: boolean
}>

/**
 * What the dialog says when it is opened on a goal with no month running: the
 * page was left open over the end of the month it showed.
 */
const NO_RUNNING_MONTH =
  'No month of this goal is running right now, so there is no target to change. Reload the page to see where the goal stands.'

const monthName = (at: Date, timezone: string): string =>
  formatMonthName(at, timezone) ?? 'This month'

export type GoalMonthTargetWords = Readonly<{
  /** "October": the running month, on the calendar it was cut in. */
  month: string
  /** "November": the month a version for the months after would start with. */
  followingMonth: string
  /** "Target for October". */
  fieldLabel: string
  following: Readonly<{
    /** "Also use this target from Nov 1": the real first day, never "next month". */
    label: string
    /**
     * Ticked unless ticking would do more than carry the target on: replace a
     * change that is already scheduled, or leave a month without a result.
     */
    defaultChecked: boolean
    /** False when the months after cannot take the target at all. */
    available: boolean
  }>
}>

export function goalMonthTargetWords(plan: Plan, frame: Frame): GoalMonthTargetWords {
  const [running] = plan.runningRows
  const month = monthName(plan.period.start, running?.propertyTimezone ?? frame.timezone)
  return {
    month,
    followingMonth: monthName(plan.followingStart, frame.timezone),
    fieldLabel: `Target for ${month}`,
    following: {
      label: `Also use this target from ${goalDay(plan.followingStart, frame)}`,
      defaultChecked:
        plan.canApplyFollowing && plan.pendingHead === null && !plan.skipsMonth,
      available: plan.canApplyFollowing,
    },
  }
}

/** What the dialog says under its title; `words` is null when no month is running. */
export function goalMonthTargetDescription(words: GoalMonthTargetWords | null): string {
  return words === null
    ? NO_RUNNING_MONTH
    : `${words.month} is judged against the new target. The goal keeps showing who changed it and what it started at.`
}

/** "November is already set to 500. Replace it with 300?" */
function scheduledChangeQuestion(
  pending: NonNullable<Plan['pendingHead']>,
  target: number,
): string {
  const month = monthName(pending.effectiveFrom, pending.propertyTimezone)
  const already = `${month} is already set to ${goalFigure(pending.metric, pending.targetValue)}.`
  return Number.isFinite(target) && target !== pending.targetValue
    ? `${already} Replace it with ${goalFigure(pending.metric, target)}?`
    : already
}

/**
 * Why the months after cannot take the target, one sentence per reason the
 * plan can give. Typed by the reasons, so a new one has no sentence until it
 * is written here.
 */
const FOLLOWING_BLOCKED: Readonly<
  Record<
    NonNullable<Plan['followingBlockedReason']>,
    (words: GoalMonthTargetWords) => string
  >
> = {
  scheduled_change_has_other_measure: (words) =>
    `${words.followingMonth} already has its own change scheduled, so only ${words.month} will change.`,
}

/** A paused goal has a day for its months after, and no month to open on it yet. */
const PAUSED = 'This goal is paused. No month opens until it is resumed.'

/**
 * The line under the checkbox, for the target the field holds now: why the box
 * is unavailable, the question a scheduled change raises, the warning that a
 * month would be left out, and that a paused goal opens no month for now. Null
 * when ticking it only carries the target on.
 */
export function goalFollowingHelp(
  plan: Plan,
  target: number,
  frame: Frame,
): string | null {
  const words = goalMonthTargetWords(plan, frame)
  if (plan.followingBlockedReason !== null) {
    return FOLLOWING_BLOCKED[plan.followingBlockedReason](words)
  }
  const question =
    plan.pendingHead === null ? null : scheduledChangeQuestion(plan.pendingHead, target)
  // The month before the start is the last local month no version would cover.
  const skipped = plan.skipsMonth
    ? `${monthName(new Date(plan.followingStart.getTime() - 1), frame.timezone)} would have no goal result.`
    : null
  const lines = [question, skipped, frame.paused ? PAUSED : null].filter(
    (line): line is string => line !== null,
  )
  return lines.length === 0 ? null : lines.join(' ')
}

/** The version that governs the months after: the change waiting for its month, else the one in force. */
const governingAfter = (plan: Plan) => plan.pendingHead ?? plan.inForceVersion

/** What the months after are set to: "November", at "500". */
export type GoalFollowingStanding = Readonly<{
  month: string
  figure: string
  targetValue: number
}>

/**
 * The target the months after have as the dialog opens, and the month they
 * begin with: the change that waits for its month, else the version in force,
 * which goes on into the month after the running one. The receipt says it when
 * a save leaves them there.
 */
export function goalFollowingStanding(plan: Plan, frame: Frame): GoalFollowingStanding {
  const governing = governingAfter(plan)
  const [running] = plan.runningRows
  return {
    month:
      plan.pendingHead === null
        ? monthName(plan.period.end, running?.propertyTimezone ?? frame.timezone)
        : monthName(plan.pendingHead.effectiveFrom, plan.pendingHead.propertyTimezone),
    figure: goalFigure(governing.metric, governing.targetValue),
    targetValue: governing.targetValue,
  }
}

/**
 * Whether saving would change anything: the month's target, or, with the box
 * ticked, the target of the months after. The command decides the same way
 * (`followingIntent`). A form that asks for neither has nothing to save, and a
 * note is stored only with a change. An empty field counts as a change, so the
 * form gets to name it.
 */
export function goalMonthTargetAsksForChange(
  plan: Plan,
  target: number,
  applyToFollowing: boolean,
): boolean {
  if (target !== plan.effectiveTarget) return true
  return (
    applyToFollowing &&
    plan.canApplyFollowing &&
    governingAfter(plan).targetValue !== target
  )
}

/** One subject's month to date, named as the page names it. */
export type GoalMonthSoFar = Readonly<{ name: string; reading: GoalProgressReading }>

function soFarOf(metric: GoalMetric, reading: GoalProgressReading): string | null {
  if (reading.kind === 'not_started') return null
  return reading.kind === 'live'
    ? `${goalFigure(metric, reading.value)} so far this month`
    : goalSoFarLine(metric, reading)
}

/**
 * "412 so far this month" for a goal with one subject, "Lobby: 412 so far this
 * month" for each subject of a goal with several. The live month to date,
 * never the month's result; a figure that cannot be read says so.
 */
export function goalMonthSoFarLines(
  metric: GoalMetric,
  subjects: readonly GoalMonthSoFar[],
): readonly string[] {
  const read = subjects.flatMap(({ name, reading }) => {
    const line = soFarOf(metric, reading)
    return line === null ? [] : [{ name, line }]
  })
  // A goal with one subject needs no name on its only figure; with several,
  // a figure always says whose it is, also when only one could be read.
  return subjects.length === 1
    ? read.map(({ line }) => line)
    : read.map(({ name, line }) => `${name}: ${line}`)
}
