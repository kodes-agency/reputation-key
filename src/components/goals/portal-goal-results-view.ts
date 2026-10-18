// The Portal goal results page's own words (`/goals/portal-results`, PLAN
// PG-18): its title, and the ended Portal goals it lists, each with what it
// counted, its number (as the Goals list's History said it) and the day it
// ended. Every month's result is the matrix's own
// (`buildGoalResultsMatrix`), worked out by the route. The way here from the
// Portal goals section is `portal-goal-results-foot.ts`, on the Goals page.
//
// Pure.
import type {
  buildGoalResultsMatrix,
  GoalSubject,
} from '#/contexts/reporting/application/public-api'
import { monthTargetPlan } from '#/contexts/reporting/application/goal-month-target-plan'
import { formatShortDate } from '#/lib/format'
import { goalListSubjectText } from './goal-assignment-subject-label'
import { goalMetricLabel } from './goal-metric-label'
import { goalListTarget } from './goal-month-target-view'
import { GOAL_STATUS } from './goal-status'

/** A Portal goal as the Goals list reads it: its versions, subjects and months. */
type PortalGoal = Parameters<typeof buildGoalResultsMatrix>[0]['programs'][number]

/** The page's title, and the name its breadcrumb gives it. */
export const PORTAL_GOAL_RESULTS_TITLE = 'Portal goal results'

/** The ended goals' part of the page, and its anchor, where R-4 lands (`#ended`). */
export const ENDED_PORTAL_GOALS_TITLE = 'Ended portal goals'
export const ENDED_PORTAL_GOALS_ID = 'ended'

/** One ended Portal goal as the page lists it. */
export type EndedPortalGoal = Readonly<{
  programId: string
  name: string
  /** Its measure, its number and whom it counted: "Private ratings · target 40 · Seaview Hotel". */
  summary: string
  /** "Ended on Nov 12"; "Ended" for a goal ended before that day was kept (0062). */
  ended: string
}>

type Frame = Readonly<{
  /** The instant the page was opened, which decides whether a day prints its year. */
  now: Date
  subjectName: (subject: GoalSubject) => string
}>

/** When the goal ended, or, for one ended before that was kept, its last change. */
const endOf = ({ program }: PortalGoal) => program.endedAt ?? program.updatedAt

function endedGoalOf(goal: PortalGoal, { now, subjectName }: Frame): EndedPortalGoal {
  const { program, version, assignments } = goal
  const timezone = version.propertyTimezone
  const subjects = assignments
    .filter((assignment) => assignment.programVersionId === version.id)
    .map((assignment) => assignment.subject)
  // The target as the Goals list's row says it: a stopped goal's month that
  // still counts says its own.
  const target = goalListTarget(goal, monthTargetPlan(goal, now, timezone), {
    timezone,
    now,
  })
  const day =
    program.endedAt === undefined ? null : formatShortDate(program.endedAt, timezone, now)
  return {
    programId: program.id,
    name: program.name,
    // Joined as the Goals list joins a row's facts (`goalListSummary`).
    summary: [
      goalMetricLabel(target.metric),
      target.text,
      goalListSubjectText(subjects, subjectName),
    ]
      .filter((part): part is string => part !== null)
      .join(' · '),
    ended: day === null ? GOAL_STATUS.ended.label : `Ended on ${day}`,
  }
}

/**
 * Whether the page has a part to draw: a month of a Portal goal (the running
 * one included) or a goal that has ended. The ways here appear only once it
 * has; an address typed or kept from before goes back to the Portal goals.
 */
export const hasPortalGoalResults = ({
  matrix,
  ended,
}: Readonly<{
  matrix: Readonly<{ months: readonly unknown[] }>
  ended: readonly EndedPortalGoal[]
}>): boolean => matrix.months.length > 0 || ended.length > 0

/** The ended Portal goals, the most recently ended first. */
export function endedPortalGoals(
  programs: readonly PortalGoal[],
  frame: Frame,
): EndedPortalGoal[] {
  // `filter` makes the copy that is sorted: the list read is never reordered.
  return programs
    .filter(({ program }) => program.status === 'ended')
    .sort((left, right) => endOf(right).getTime() - endOf(left).getTime())
    .map((goal) => endedGoalOf(goal, frame))
}
