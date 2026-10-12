// The Program card of a goal's page: the measure, the target, who the goal is
// for and from when it counts.
//
// While a month runs the target is two lines, "This month" and "From Nov 1":
// a running month can carry a target of its own, and a change that waits for
// the next month is not this month's target. The words are decided in
// goal-month-target-view.ts and goal-detail-view.ts.
import type { monthTargetPlan } from '#/contexts/reporting/application/goal-month-target-plan'
import { goalTargetProvenance } from '#/contexts/reporting/application/goal-target-provenance'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
  goalDay,
  goalPageMetricLabel,
  goalStartLine,
  goalStartMonthHint,
  statusReasonLabel,
} from './goal-detail-view'
import { goalTargetLines } from './goal-month-target-view'
import type { GoalMarkerFrame } from './goal-target-marker'

type Props = Readonly<{
  /** The goal as its page read it. */
  goal: Parameters<typeof monthTargetPlan>[0]
  /** The month that is running, or null while none is. */
  plan: ReturnType<typeof monthTargetPlan>
  /** How many subjects the goal's current plan covers. */
  subjectCount: number
  /** The reader may change the goal, so the card says how its start is moved. */
  canManage: boolean
  frame: GoalMarkerFrame
}>

export function GoalProgramCard({ goal, plan, subjectCount, canManage, frame }: Props) {
  const { program, version, results } = goal
  // The target the card speaks of first: the running month's while a month
  // runs, else the head version's.
  const provenance = goalTargetProvenance(goal, plan?.inForceVersion ?? version)
  const statusNote = statusReasonLabel(
    program.statusReason,
    goalDay(provenance.countsFrom, frame),
  )
  const startMonthHint = canManage
    ? goalStartMonthHint({ status: program.status, resultCount: results.length })
    : null
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Program</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm md:grid-cols-2">
        <p>
          <span className="text-muted-foreground">Metric:</span>{' '}
          {goalPageMetricLabel(version.metric)}
        </p>
        {goalTargetLines(goal, plan, frame).map((line) => (
          <p key={line.label}>
            <span className="text-muted-foreground">{line.label}:</span> {line.value}
            {line.notes.map((note) => (
              <span key={note} className="block text-muted-foreground">
                {note}
              </span>
            ))}
          </p>
        ))}
        <p>
          <span className="text-muted-foreground">Subjects:</span> {subjectCount}
        </p>
        <p>
          <span className="text-muted-foreground">Timezone:</span>{' '}
          {version.propertyTimezone}
        </p>
        <p>
          {goalStartLine({
            ended: program.status === 'ended',
            months: results,
            countsFrom: provenance.countsFrom,
            setAt: provenance.setAt,
            timezone: frame.timezone,
            now: frame.now,
          })}
        </p>
        {statusNote === null ? null : (
          <p className="md:col-span-2">
            <span className="text-muted-foreground">Status note:</span> {statusNote}
          </p>
        )}
        {startMonthHint === null ? null : (
          <p className="text-muted-foreground md:col-span-2">{startMonthHint}</p>
        )}
      </CardContent>
    </Card>
  )
}
