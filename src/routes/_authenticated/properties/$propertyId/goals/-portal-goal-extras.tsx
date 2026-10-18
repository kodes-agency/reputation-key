// The Portal goals other than the Monthly portal goal's card, under it: each
// goal's row with its measure, its target, whom it counts and, while a month
// runs, the month so far. The goals not ended only, on both of the Google
// section's views; the ended ones are on the Portal goal results page. The
// table is the one the Goals page always had; the card above it is now the
// Portal goals' first state, so no goals draw nothing here, and the goal the
// card shows is not listed again.
import { Link } from '@tanstack/react-router'
import type { GoalListProgress } from '#/contexts/reporting/application/public-api'
import type { GoalSubject } from '#/contexts/reporting/application/public-api'
import { monthTargetPlan } from '#/contexts/reporting/application/goal-month-target-plan'
import type { listGoalPrograms } from '#/contexts/reporting/server/goal-programs'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '#/components/ui/data-table'
import { ROW_NAME_LINK } from '#/components/ui/row-link'
import { SectionTitle } from '#/components/ui/section-title'
import { StatusBadge } from '#/components/ui/status-badge'
import { GOAL_STATUS } from '#/components/goals/goal-status'
import { goalMetricLabel } from '#/components/goals/goal-metric-label'
import { goalListSubjectText } from '#/components/goals/goal-assignment-subject-label'
import { goalListTarget } from '#/components/goals/goal-month-target-view'
import { GoalLiveLine, GoalLiveLinePending } from '#/components/goals/goal-live-line'
import { goalListSummary, goalLiveShape } from '#/components/goals/goal-live-view'
import { formatShortDate } from '#/lib/format'
import { cn } from '#/lib/utils'

type ListedGoal = Awaited<ReturnType<typeof listGoalPrograms>>['programs'][number]

type Props = Readonly<{
  propertyId: string
  /** The Property's time zone, which a month's target is read in. */
  timezone: string
  /** The goals not ended. */
  goals: readonly ListedGoal[]
  /** The Program the card shows as the Monthly portal goal; null when it shows none. */
  monthlyGoalId: string | null
  /** The month so far of the active goals, read apart from the list. */
  live: Readonly<{
    byProgram: ReadonlyMap<string, GoalListProgress>
    loading: boolean
    failed: boolean
  }>
  subjectName: (subject: GoalSubject) => string
  now: Date
  /**
   * Its own "More portal goals" title; off where the page titles the part it
   * sits in (the Monthly portal goal's page).
   */
  titled?: boolean
}>

function GoalRow({
  goal,
  propertyId,
  timezone,
  live,
  subjectName,
  now,
}: Readonly<{ goal: ListedGoal }> & Omit<Props, 'goals' | 'monthlyGoalId' | 'titled'>) {
  const { program, version, assignments } = goal
  const currentSubjects = assignments
    .filter((assignment) => assignment.programVersionId === version.id)
    .map((assignment) => assignment.subject)
  // This month's target while a month runs, with its marker when it was
  // changed; "set on" ends the row only where the target's own text does not
  // already say when.
  const calendar = { timezone: version.propertyTimezone, now }
  const target = goalListTarget(goal, monthTargetPlan(goal, now, timezone), calendar)
  const setOn =
    target.setAt === null
      ? null
      : `set on ${formatShortDate(target.setAt, calendar.timezone, now) ?? 'an unknown date'}`
  const liveGoal = live.byProgram.get(program.id)
  // While the month is first being read, keep the room its line will take, so
  // the rows below do not jump when it arrives.
  const pendingShape = live.loading
    ? goalLiveShape({
        status: program.status,
        metric: target.metric,
        subjectCount: currentSubjects.length,
      })
    : null
  return (
    <DataTableRow>
      <DataTableCell className="min-w-0 whitespace-normal">
        <Link
          className={cn('font-medium', ROW_NAME_LINK)}
          to="/properties/$propertyId/goals/$goalId"
          params={{ propertyId, goalId: program.id }}
        >
          {program.name}
        </Link>
        <p className="text-sm text-muted-foreground">
          {goalListSummary([
            goalMetricLabel(target.metric),
            target.text,
            goalListSubjectText(currentSubjects, subjectName),
            setOn,
          ])}
        </p>
        {liveGoal !== undefined ? (
          <GoalLiveLine goal={liveGoal} />
        ) : pendingShape !== null ? (
          <GoalLiveLinePending shape={pendingShape} />
        ) : null}
      </DataTableCell>
      <DataTableCell className="col-start-2 row-start-1 justify-self-end">
        <StatusBadge status={program.status} map={GOAL_STATUS} />
      </DataTableCell>
    </DataTableRow>
  )
}

export function PortalGoalExtras({
  goals: listed,
  monthlyGoalId,
  titled = true,
  ...rows
}: Props) {
  const goals = listed.filter(({ program }) => program.id !== monthlyGoalId)
  // The card is the Portal goals' state when there are no others.
  if (goals.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      {titled ? <SectionTitle level={3}>More portal goals</SectionTitle> : null}
      {rows.live.failed ? (
        <p className="text-sm text-muted-foreground">
          This month’s figures can’t be read right now.
        </p>
      ) : null}
      <DataTable label="Active goals" from="3xl">
        <DataTableHeader>
          <DataTableHead>Goal</DataTableHead>
          <DataTableHead className="w-40">Status</DataTableHead>
        </DataTableHeader>
        <DataTableBody>
          {goals.map((goal) => (
            <GoalRow key={goal.program.id} goal={goal} {...rows} />
          ))}
        </DataTableBody>
      </DataTable>
    </div>
  )
}
